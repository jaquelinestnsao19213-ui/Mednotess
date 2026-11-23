// Conector MCP do Mednotes: deixa o Claude (claude.ai / app) ler e alterar o planejamento e ler páginas.
// Endereço: /api/mcp/<MCP_SECRET>  (o segredo vai no próprio link, porque o Claude não envia cabeçalhos personalizados).
// Variáveis na Vercel: MCP_SECRET, MCP_EMAIL, MCP_PASSWORD (login da usuária; as regras de segurança do Supabase continuam valendo).
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { TOOLS, runTool, type ToolContext } from "@/lib/server/chat-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROTOCOL = "2025-03-26";
const READ_LIMIT = 30_000;

/* ---------- segurança ---------- */

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// entra como a usuária (RLS continua valendo) e guarda a sessão em memória até perto de expirar
let cached: { db: SupabaseClient; expires: number } | null = null;
async function getDb(): Promise<SupabaseClient | null> {
  if (cached && cached.expires > Date.now()) return cached.db;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.MCP_EMAIL;
  const password = process.env.MCP_PASSWORD;
  if (!url || !anon || !email || !password) return null;
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  const { data, error } = await createClient(url, anon, options).auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  const db = createClient(url, anon, { ...options, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
  cached = { db, expires: Date.now() + Math.max(60, (data.session.expires_in ?? 3600) - 300) * 1000 };
  return db;
}

/* ---------- ferramentas extras (leitura de páginas) ---------- */

type Json = Record<string, unknown>;

function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(plainText) : [];
  const block = ["paragraph", "heading", "listItem", "taskItem", "tableRow", "blockquote", "codeBlock"].includes(n.type ?? "");
  return inner.join(n.type === "tableRow" ? " | " : "") + (block ? "\n" : "");
}

const EXTRA_TOOLS = [
  {
    name: "list_pages",
    description: "Lista páginas, cadernos e aulas do Mednotes (id, título, tipo, pai), as mais recentes primeiro. Use 'query' para filtrar pelo título.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Parte do título (opcional)" }, limit: { type: "number", description: "Máximo de itens, padrão 50, até 100" } } },
  },
  {
    name: "read_page",
    description: "Lê o texto de uma página pelo id (de list_pages). Imagens, PDFs e escrita à mão não vêm no texto.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

async function runExtra(name: string, args: Json, db: SupabaseClient): Promise<string | null> {
  const fail = (message: string) => JSON.stringify({ erro: message });
  if (name === "list_pages") {
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    let q = db.from("pages").select("id,title,type,parent_id,updated_at").order("updated_at", { ascending: false }).limit(limit);
    if (typeof args.query === "string" && args.query.trim()) q = q.ilike("title", `%${args.query.trim().replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) return fail("Não consegui listar as páginas.");
    return JSON.stringify({ paginas: data ?? [] });
  }
  if (name === "read_page") {
    if (typeof args.id !== "string" || !/^[0-9a-f-]{36}$/i.test(args.id)) return fail("id inválido.");
    const { data, error } = await db.from("pages").select("id,title,type,content").eq("id", args.id).maybeSingle();
    if (error) return fail("Não consegui ler a página.");
    if (!data) return fail("Página não encontrada.");
    const text = plainText(data.content).replace(/\n{3,}/g, "\n\n").trim();
    return JSON.stringify({ id: data.id, titulo: data.title, tipo: data.type, texto: text.slice(0, READ_LIMIT), cortado: text.length > READ_LIMIT });
  }
  return null;
}

/* ---------- protocolo MCP (JSON-RPC sobre HTTP) ---------- */

const todayBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function handle(msg: { id?: unknown; method?: string; params?: Json }, db: SupabaseClient | null) {
  const { id, method } = msg;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return null; // notificação: não tem resposta

  if (method === "initialize") {
    const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL;
    return reply({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: "mednotes", version: "1.0.0" } });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    const own = TOOLS.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.input_schema }));
    return reply({ tools: [...own, ...EXTRA_TOOLS] });
  }
  if (method === "tools/call") {
    const name = String(msg.params?.name ?? "");
    const args = (msg.params?.arguments ?? {}) as Json;
    if (!db) return reply({ isError: true, content: [{ type: "text", text: "Não consegui entrar no Mednotes. Confira MCP_EMAIL e MCP_PASSWORD na Vercel." }] });
    let output = await runExtra(name, args, db);
    if (output === null) {
      if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Ferramenta desconhecida: ${name}`);
      const ctx: ToolContext = { db, today: todayBR(), changed: false, actions: [], log: () => {} };
      output = await runTool(name, args, ctx);
    }
    return reply({ isError: output.startsWith('{"erro"'), content: [{ type: "text", text: output }] });
  }
  return error(-32601, "Método não suportado");
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = process.env.MCP_SECRET;
  if (!secret || secret.length < 24) return NextResponse.json({ error: "Conector não configurado." }, { status: 503 });
  if (!sameSecret(token, secret)) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, { status: 400 });
  }
  const messages = (Array.isArray(body) ? body : [body]) as { id?: unknown; method?: string; params?: Json }[];
  const needsDb = messages.some((m) => m?.method === "tools/call");
  const db = needsDb ? await getDb() : null;
  const out = (await Promise.all(messages.map((m) => handle(m ?? {}, db)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
