import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Texto dos PDFs para a assistente: extraído UMA vez, guardado no Storage do Supabase (pasta da própria usuária)
// e depois só as páginas relevantes para a pergunta seguem para a IA (em vez do PDF inteiro a cada mensagem).

const BUCKET = "files";
const CACHE_VERSION = 1;
const MAX_PDF_BYTES = 30_000_000;
const MAX_PAGES = 800;
const FETCH_TIMEOUT_MS = 25_000;
const EXTRACT_TIMEOUT_MS = 45_000;
const PAGE_CAP = 6_000; // caracteres por página enviados à IA
const MIN_TOTAL_CHARS = 200;
const MIN_AVG_CHARS_PER_PAGE = 120; // abaixo disso o PDF é visual (diagramas, escaneado): segue o PDF original

type TextItem = { str?: string; hasEOL?: boolean };

async function extractPages(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // usa o worker já embutido (sem procurar arquivo no disco do servidor)
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const n = Math.min(doc.numPages, MAX_PAGES);
    const pages: string[] = [];
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = (content.items as unknown as TextItem[])
        .map((i) => (typeof i.str === "string" ? i.str + (i.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

const cachePath = (userId: string, url: string) => `${userId}/pdf-text/${createHash("sha1").update(url).digest("hex")}.json`;

/** Texto por página (índice 0 = página 1). Lê do cache; se não houver, extrai e guarda. Em falha devolve null (a rota então envia o PDF como antes). */
export async function loadPdfPages(
  db: SupabaseClient,
  userId: string,
  url: string
): Promise<{ pages: string[]; cached: boolean } | null> {
  const path = cachePath(userId, url);
  try {
    const { data, error } = await db.storage.from(BUCKET).download(path);
    if (!error && data) {
      const parsed = JSON.parse(await data.text()) as { v?: number; pages?: unknown };
      if (parsed.v === CACHE_VERSION && Array.isArray(parsed.pages) && parsed.pages.every((p) => typeof p === "string")) {
        return { pages: parsed.pages as string[], cached: true };
      }
    }
  } catch {
    /* sem cache: extrai abaixo */
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return null;
    const pages = await Promise.race([
      extractPages(buf),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS)),
    ]);
    if (!pages) return null;
    try {
      await db.storage
        .from(BUCKET)
        .upload(path, new Blob([JSON.stringify({ v: CACHE_VERSION, pages })], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    } catch {
      /* o cache é opcional */
    }
    return { pages, cached: false };
  } catch {
    return null;
  }
}

/* ---------- escolha das páginas relevantes ---------- */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const STOP = new Set([
  "para", "como", "qual", "quais", "quando", "onde", "porque", "sobre", "entre", "esse", "essa", "isso", "este", "esta", "isto",
  "pelo", "pela", "pelos", "pelas", "mais", "menos", "muito", "fazer", "faca", "faz", "crie", "criar", "gere", "gerar", "resumo",
  "resuma", "resumir", "resumos", "flashcard", "flashcards", "questao", "questoes", "quiz", "simulado", "revisao", "pdf", "pdfs",
  "arquivo", "arquivos", "pagina", "paginas", "documento", "material", "texto", "conteudo", "explique", "explicar", "preciso",
  "quero", "pode", "voce", "seria", "dos", "das", "nos", "nas", "com", "uma", "uns", "umas", "que", "tem", "ter", "foi", "sua",
  "seu", "suas", "seus", "tudo", "todo", "toda", "todos", "todas", "principais", "principal", "importante", "importantes",
]);

function keywords(question: string): string[] {
  const set = new Set<string>();
  for (const w of norm(question).split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOP.has(w)) set.add(w.length > 6 ? w.slice(0, w.length - 2) : w);
  }
  return [...set].slice(0, 24);
}

function countOf(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1 && n < 5) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function ranges(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = cur;
    prev = cur;
  }
  return out.join(", ");
}

/**
 * Monta o texto que vai à IA: todas as páginas se o PDF for curto; senão, as páginas que mais combinam com a pergunta
 * (ou páginas espalhadas pelo documento quando o pedido é geral, como "resuma" ou "faça flashcards").
 * Devolve null quando o PDF é mais visual do que textual (diagramas, escaneado): aí o PDF original segue para a IA.
 */
export function buildPdfContext(name: string, pages: string[], question: string, budget: number): string | null {
  const total = pages.reduce((n, p) => n + p.length, 0);
  if (!pages.length || total < MIN_TOTAL_CHARS || total / pages.length < MIN_AVG_CHARS_PER_PAGE) return null;

  let chosen: number[] = [];
  const trimmed = pages.map((p) => (p.length > PAGE_CAP ? `${p.slice(0, PAGE_CAP)}…` : p));
  const sizes = trimmed.map((p) => p.length);

  if (sizes.reduce((a, b) => a + b, 0) <= budget) {
    chosen = pages.map((_, i) => i);
  } else {
    const words = keywords(question);
    const normalized = pages.map(norm);
    const df = words.map((w) => normalized.filter((t) => t.includes(w)).length);
    const scored = normalized
      .map((t, i) => {
        let score = 0;
        words.forEach((w, k) => {
          if (df[k]) score += Math.log(1 + pages.length / df[k]) * countOf(t, w);
        });
        return { i, score };
      })
      .filter((s) => s.score > 0 && sizes[s.i] > 0)
      .sort((a, b) => b.score - a.score);

    let used = 0;
    if (scored.length) {
      for (const s of scored) {
        if (used + sizes[s.i] > budget) continue;
        chosen.push(s.i);
        used += sizes[s.i];
      }
    } else {
      // pedido geral: páginas espalhadas pelo PDF todo
      const avg = Math.max(1, Math.round(sizes.reduce((a, b) => a + b, 0) / pages.length));
      const k = Math.max(1, Math.min(pages.length, Math.floor(budget / avg)));
      for (let n = 0; n < k; n++) {
        const i = Math.floor((n * pages.length) / k);
        if (!sizes[i] || chosen.includes(i)) continue;
        if (used + sizes[i] > budget) break;
        chosen.push(i);
        used += sizes[i];
      }
    }
    if (!chosen.length) return null;
  }

  chosen.sort((a, b) => a - b);
  const nums = chosen.map((i) => i + 1);
  const label = JSON.stringify(name);
  const header =
    chosen.length === pages.length
      ? `[PDF ${label}: texto extraído das ${pages.length} páginas]`
      : `[PDF ${label}: texto extraído, só das páginas mais relevantes para esta pergunta (${ranges(nums)}, de ${pages.length}). As demais páginas não foram enviadas.]`;
  const body = chosen.map((i) => `--- Página ${i + 1} ---\n${trimmed[i]}`).join("\n\n");
  return `${header}\n\n${body}`;
}
