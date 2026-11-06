import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const tokenMatch = (request.headers.get("authorization") ?? "").match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) return errorResponse("Faça login para usar a transcrição.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return errorResponse("A autenticação do servidor não está configurada.", 500);

  const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data: { user }, error } = await auth.auth.getUser(tokenMatch[1]);
  if (error || !user) return errorResponse("Sessão inválida ou expirada. Entre novamente.", 401);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return errorResponse("Configure OPENAI_API_KEY no ambiente do servidor.", 503);

  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || !audio.size) return errorResponse("Envie um bloco de áudio válido.", 400);
    if (audio.size > MAX_AUDIO_BYTES) return errorResponse("O bloco ultrapassa 20 MB.", 413);
    if (!audio.type.startsWith("audio/")) return errorResponse("Formato de áudio não reconhecido.", 400);

    const transcription = new FormData();
    transcription.append("file", audio, audio.name || "bloco.webm");
    transcription.append("model", "whisper-1");
    transcription.append("language", "pt");
    transcription.append("response_format", "json");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcription,
      signal: AbortSignal.timeout(50_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("OpenAI transcription error:", response.status);
      return errorResponse(response.status === 429 ? "Limite de transcrição atingido. Aguarde e tente novamente." : "A OpenAI não conseguiu transcrever este bloco.", response.status === 429 ? 429 : 502);
    }
    const result = await response.json() as { text?: string };
    if (!result.text?.trim()) return errorResponse("Nenhuma fala foi identificada neste bloco.", 422);
    return NextResponse.json({ transcript: result.text.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Audio chunk transcription failed:", cause instanceof Error ? cause.name : "unknown");
    return errorResponse("Falha temporária ao transcrever o bloco. Tente novamente.", 502);
  }
}
