import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = { role: "user" | "assistant"; content: string };
const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TOTAL_LENGTH = 12_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) return jsonError("Faça login para usar a assistente.", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError("A autenticação do servidor não está configurada.", 500);
  }

  // Validate the user's access token with Supabase Auth. No service-role key is used.
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !user) return jsonError("Sessão inválida ou expirada. Entre novamente.", 401);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return jsonError("A conversa enviada é muito longa.", 413);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("Não foi possível ler a mensagem.", 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonError("A conversa enviada é muito longa.", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError("Formato de solicitação inválido.", 400);
  }

  const candidateMessages = (payload as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(candidateMessages) || candidateMessages.length === 0 || candidateMessages.length > MAX_MESSAGES) {
    return jsonError("Envie entre 1 e 12 mensagens de conversa.", 400);
  }

  const messages: ChatMessage[] = [];
  let totalLength = 0;
  for (const candidate of candidateMessages) {
    if (!candidate || typeof candidate !== "object") return jsonError("Mensagem inválida.", 400);
    const { role, content } = candidate as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return jsonError("Mensagem inválida.", 400);
    }
    const text = content.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return jsonError("Cada mensagem deve ter até 4.000 caracteres.", 400);
    totalLength += text.length;
    messages.push({ role, content: text });
  }
  if (totalLength > MAX_TOTAL_LENGTH || messages[messages.length - 1]?.role !== "user") {
    return jsonError("Conversa inválida ou longa demais.", 400);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonError("A assistente ainda não está configurada. Adicione ANTHROPIC_API_KEY ao ambiente do servidor.", 503);

  try {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1_024,
      system: "Você é a assistente de estudos do Mednotes. Responda em português brasileiro, com clareza, cordialidade e foco em produtividade e aprendizagem. Nesta etapa você só conversa: não afirme que criou, editou ou consultou dados do aplicativo, pois ainda não tem acesso às ferramentas nem ao contexto do usuário. Quando solicitado a executar uma ação no app, explique que pode ajudar a planejar, mas a execução integrada ainda não está disponível.",
      messages,
    });
    const answer = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!answer) return jsonError("A assistente não retornou uma resposta. Tente novamente.", 502);
    return NextResponse.json({ message: answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Avoid returning provider details or credentials to the browser.
    console.error("Anthropic chat request failed", error instanceof Error ? error.name : "unknown error");
    return jsonError("Não foi possível obter uma resposta agora. Tente novamente em instantes.", 502);
  }
}
