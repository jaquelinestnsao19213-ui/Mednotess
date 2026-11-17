import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { docPdfUrls, docToText } from "@/lib/doc";
import { pathLabel, TYPE_LABEL, type TreePage } from "@/lib/page-tree";
import type { PageRow } from "@/lib/types";

export const maxDuration = 60;

const MODEL = process.env.SEARCH_MODEL || process.env.CHAT_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const MAX_PAGES = 2000; // páginas mais recentes que entram na busca
const MAX_HITS = 20;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Sem acento e em minúsculas, mantendo o MESMO tamanho do texto original (para achar o trecho certo).
function fold(text: string): string {
  let out = "";
  for (const c of Array.from(text)) {
    const d = c.normalize("NFD");
    const base = d.length > 1 && c.length === 1 ? d[0] : c;
    const lower = base.toLowerCase();
    out += lower.length === c.length ? lower : c;
  }
  return out;
}

type Term = { raw: string; folded: string; weight: number };

function cleanTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length >= 2 && text.length <= 60 ? text : null;
}

// Pede à IA os assuntos relacionados à pergunta (sinônimos, siglas, mecanismos, moléculas, doenças ligadas).
async function expandQuery(query: string): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const anthropic = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system:
        'Você ajuda a buscar anotações de uma estudante de Medicina. Receba uma busca e devolva SOMENTE um JSON {"termos":[...]} com até 24 termos curtos (1 a 3 palavras cada) que apareceriam em anotações sobre o assunto: sinônimos, siglas e nomes em inglês, mecanismos, genes, moléculas, fármacos, estruturas anatômicas, doenças e conceitos diretamente relacionados. Use português (e a sigla ou o termo em inglês quando for comum). Não repita a busca inteira, não explique nada e não use Markdown.',
      messages: [{ role: "user", content: query }],
    });
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(raw) as { termos?: unknown };
    if (!Array.isArray(parsed.termos)) return null;
    return parsed.termos.map(cleanTerm).filter((t): t is string => !!t).slice(0, 24);
  } catch {
    return null; // sem IA a busca continua funcionando, só pelas palavras digitadas
  }
}

export async function POST(request: Request) {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return json({ error: "Faça login para buscar." }, 401);
  const token = match[1];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ error: "A autenticação do servidor não está configurada." }, 500);

  // age COMO a usuária: só enxerga as páginas dela
  const db = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401);

  let body: { query?: unknown; pageId?: unknown } | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Formato de solicitação inválido." }, 400);
  }
  const query = typeof body?.query === "string" ? body.query.replace(/\s+/g, " ").trim() : "";
  if (query.length < 2 || query.length > 300) return json({ error: "Digite uma busca com 2 a 300 caracteres." }, 400);
  const pageId = typeof body?.pageId === "string" && /^[0-9a-f-]{36}$/i.test(body.pageId) ? body.pageId : null;

  // 1) termos: o que ela digitou (peso maior) + o que a IA diz que está relacionado (peso menor)
  const related = await expandQuery(query);
  const terms: Term[] = [];
  const seen = new Set<string>();
  const add = (raw: string, weight: number) => {
    const folded = fold(raw);
    if (folded.length < 2 || seen.has(folded)) return;
    seen.add(folded);
    terms.push({ raw, folded, weight });
  };
  add(query, 4);
  for (const word of query.split(" ")) if (word.length >= 4 || /^[A-Z0-9]{2,}$/.test(word)) add(word, 2.5);
  for (const term of related ?? []) add(term, 1);

  // 2) páginas da usuária (ou só a página atual, na busca contextual)
  const select = "id,parent_id,type,title,icon,content,updated_at";
  const result = pageId
    ? await db.from("pages").select(select).eq("id", pageId).limit(1)
    : await db.from("pages").select(select).order("updated_at", { ascending: false }).limit(MAX_PAGES);
  if (result.error) return json({ error: "Não foi possível ler as páginas agora. Tente de novo." }, 502);
  const rows = (result.data ?? []) as Pick<PageRow, "id" | "parent_id" | "type" | "title" | "icon" | "content">[];

  const tree: TreePage[] = rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, type: r.type, parent_id: r.parent_id }));

  // 3) pontua cada página pelos termos encontrados (título vale mais; achar vários termos diferentes vale mais)
  const hits = [];
  for (const row of rows) {
    const text = docToText(row.content).replace(/[ \t]+/g, " ");
    const pdfs = docPdfUrls(row.content).map((p) => p.name);
    const bodyFold = fold(text);
    const titleFold = fold(`${row.title ?? ""} ${pdfs.join(" ")}`);

    let score = 0;
    let distinct = 0;
    const matched: Term[] = [];
    for (const term of terms) {
      let count = 0;
      for (let at = bodyFold.indexOf(term.folded); at >= 0 && count < 6; at = bodyFold.indexOf(term.folded, at + term.folded.length)) count++;
      const inTitle = titleFold.includes(term.folded);
      if (!count && !inTitle) continue;
      distinct++;
      matched.push(term);
      score += term.weight * Math.min(count, 5) + (inTitle ? term.weight * 6 : 0);
    }
    if (!distinct) continue;
    score += distinct * 2;

    // trecho: em volta do melhor termo encontrado no texto
    const best = [...matched].sort((a, b) => b.weight - a.weight).find((t) => bodyFold.includes(t.folded));
    let snippet = "";
    if (best) {
      const at = bodyFold.indexOf(best.folded);
      const from = Math.max(0, at - 110);
      const to = Math.min(text.length, at + best.folded.length + 170);
      snippet = `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s*\n+\s*/g, " ").trim()}${to < text.length ? "…" : ""}`;
    }

    hits.push({
      score,
      id: row.id,
      title: row.title || "Sem título",
      icon: row.icon,
      type: row.type,
      typeLabel: TYPE_LABEL[row.type] ?? "Página",
      path: pathLabel(tree, row.id),
      snippet,
      matched: matched.slice(0, 6).map((t) => t.raw),
      pdfs: pdfs.slice(0, 3),
    });
  }
  hits.sort((a, b) => b.score - a.score);

  return json({
    expanded: related !== null,
    terms: terms.map((t) => t.raw).slice(0, 30),
    scanned: rows.length,
    hits: hits.slice(0, MAX_HITS).map(({ score: _score, ...hit }) => hit),
  });
}
