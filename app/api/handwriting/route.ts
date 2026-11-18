import { NextResponse } from "next/server";

// Reconhecimento de escrita à mão (grátis): repassa os traços ao reconhecedor do Google.
// Fica no servidor para não esbarrar em bloqueio de CORS do navegador.
export const runtime = "nodejs";
export const maxDuration = 30;

const ENDPOINT = "https://www.google.com/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8";

type Line = { w: number; h: number; ink: number[][][] };

function validLine(l: unknown): l is Line {
  const x = l as Line | null;
  if (!x || typeof x.w !== "number" || typeof x.h !== "number" || !Array.isArray(x.ink)) return false;
  return x.ink.every((s) => Array.isArray(s) && s.length === 3 && s.every((a) => Array.isArray(a)));
}

async function recognizeLine(line: Line, language: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        options: "enable_pre_space",
        requests: [
          {
            writing_guide: { writing_area_width: line.w, writing_area_height: line.h },
            ink: line.ink,
            language,
          },
        ],
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown as [string, [[string, string[]]]?];
    if (!Array.isArray(data) || data[0] !== "SUCCESS") return null;
    const best = data[1]?.[0]?.[1]?.[0];
    return typeof best === "string" && best.trim() ? best.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let body: { lines?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length || lines.length > 40 || !lines.every(validLine)) {
    return NextResponse.json({ error: "Nada para reconhecer (ou escrita grande demais de uma vez)." }, { status: 400 });
  }
  const language = typeof body.language === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.language) ? body.language : "pt";

  const out: (string | null)[] = [];
  for (let i = 0; i < lines.length; i += 6) {
    const batch = await Promise.all((lines as Line[]).slice(i, i + 6).map((l) => recognizeLine(l, language)));
    out.push(...batch);
  }
  return NextResponse.json({ lines: out });
}
