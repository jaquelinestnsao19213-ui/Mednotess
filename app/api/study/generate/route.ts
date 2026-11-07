import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MAX_TEXT = 26_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function sanitizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function fallbackGenerate({ type, title, text }: { type: "flashcard" | "question"; title: string; text: string }) {
  const excerpts = sanitizeText(text).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 8);
  const baseTitle = title || "Material";
  if (!excerpts.length) return [];

  if (type === "flashcard") {
    return excerpts.map((sentence, index) => ({
      title: `${baseTitle} • Flashcard ${index + 1}`,
      prompt: sentence.length > 180 ? sentence.slice(0, 180) + "…" : sentence,
      answer: "Use a ideia principal deste trecho para explicar o conceito em suas próprias palavras e conecte com o tema central.",
      explanation: "Esse item reforça a compreensão do conceito principal e a capacidade de explicar o assunto com linguagem própria.",
    }));
  }

  return excerpts.map((sentence, index) => ({
    title: `${baseTitle} • Questão ${index + 1}`,
    question: sentence.length > 180 ? sentence.slice(0, 180) + "…" : sentence,
    options: ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
    correct_option: "Alternativa A",
    answer: "Revise o princípio central do trecho e escolha a alternativa que melhor conecta com o tema abordado.",
    explanation: "Essa questão estimula a memorização do conceito principal e a aplicação no contexto de estudo.",
  }));
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) return jsonError("Faça login para gerar materiais de estudo.", 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return jsonError("A autenticação do servidor não está configurada.", 500);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: { user }, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !user) return jsonError("Sessão inválida ou expirada.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Formato de solicitação inválido.", 400);
  }

  const body = payload as {
    type?: unknown;
    title?: unknown;
    text?: unknown;
    pageId?: unknown;
    subjectId?: unknown;
    subjectName?: unknown;
    prompt?: unknown;
  };

  const type = body.type === "question" ? "question" : "flashcard";
  const title = typeof body.title === "string" ? body.title.slice(0, 200) : "Material";
  const text = typeof body.text === "string" ? sanitizeText(body.text) : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 500) : "Crie itens de revisão úteis e objetivos.";

  if (!text) return jsonError("Não há conteúdo suficiente para gerar materiais de estudo.", 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ items: fallbackGenerate({ type, title, text }) }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1_400,
      system: `Você é um especialista em aprendizagem ativa. Gere apenas JSON válido em português brasileiro. Crie materiais revisáveis, objetivos e bem estruturados.`,
      messages: [
        {
          role: "user",
          content: `Crie ${type === "flashcard" ? "5 flashcards" : "5 questões de múltipla escolha"} com base no seguinte material. Responda em JSON puro, sem markdown e sem texto extra. Estrutura esperada: { "items": [ ... ] }. Para flashcards, cada item deve ter: title, prompt, answer, explanation. Para questões, cada item deve ter: title, question, options, correct_option, answer, explanation. Contexto: ${title}\n\n${prompt}\n\nTexto do material:\n${text}`,
        },
      ],
    });

    const textResponse = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!textResponse) throw new Error("Resposta vazia da IA.");

    const parsed = JSON.parse(textResponse) as { items?: Array<Record<string, unknown>> };
    const items = Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : fallbackGenerate({ type, title, text });

    return NextResponse.json({ items }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ items: fallbackGenerate({ type, title, text }) }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
