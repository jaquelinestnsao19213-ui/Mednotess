// Indexa o texto dos PDFs anexados (página por página) para a busca inteligente achar o trecho e a página.
// Tudo roda no navegador, com o pdf.js, sem custo de IA. O texto fica na tabela pdf_chunks (schema20.sql).
import { supabase } from "@/lib/supabase";
import { loadPdfjs } from "@/lib/pdfjs";
import { docPdfUrls } from "@/lib/doc";

export type PdfRef = { url: string; name: string; pageId: string };

// sem acento e em minúsculas, com o MESMO tamanho do texto (igual ao que o servidor usa)
export function fold(text: string): string {
  let out = "";
  for (const c of Array.from(text)) {
    const d = c.normalize("NFD");
    const base = d.length > 1 && c.length === 1 ? d[0] : c;
    const lower = base.toLowerCase();
    out += lower.length === c.length ? lower : c;
  }
  return out;
}

export const isMissingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42P01" || error.code === "PGRST205" || /pdf_chunks/i.test(error.message ?? ""));

/** Todos os PDFs anexados nas páginas da conta (sem repetir o mesmo arquivo). */
export async function listAttachedPdfs(): Promise<PdfRef[]> {
  const found = new Map<string, PdfRef>();
  const size = 100;
  for (let from = 0; from < 5000; from += size) {
    const { data, error } = await supabase.from("pages").select("id,content").range(from, from + size - 1);
    if (error) throw new Error("Não foi possível ler as suas páginas.");
    for (const row of (data ?? []) as { id: string; content: unknown }[]) {
      for (const pdf of docPdfUrls(row.content)) if (!found.has(pdf.url)) found.set(pdf.url, { url: pdf.url, name: pdf.name, pageId: row.id });
    }
    if (!data || data.length < size) break;
  }
  return [...found.values()];
}

/** Endereços de PDFs que já foram indexados. */
export async function indexedUrls(): Promise<Set<string>> {
  const done = new Set<string>();
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await supabase.from("pdf_chunks").select("file_url").eq("page_number", 1).range(from, from + size - 1);
    if (error) throw error;
    for (const row of (data ?? []) as { file_url: string }[]) done.add(row.file_url);
    if (!data || data.length < size) break;
  }
  return done;
}

/** Lê o PDF e grava o texto de cada página. Devolve quantas páginas tinham texto e quantas estavam vazias (PDF escaneado). */
export async function indexPdf(ref: PdfRef, onProgress?: (done: number, total: number) => void): Promise<{ pages: number; withText: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Entre novamente para indexar.");

  const response = await fetch(ref.url);
  if (!response.ok) throw new Error(`Não consegui abrir ${ref.name}.`);
  const buffer = await response.arrayBuffer();

  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const total = doc.numPages;
    let withText = 0;
    let batch: Record<string, unknown>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const { error } = await supabase.from("pdf_chunks").upsert(batch, { onConflict: "user_id,file_url,page_number" });
      if (error) throw error;
      batch = [];
    };
    for (let number = 1; number <= total; number++) {
      const page = await doc.getPage(number);
      const text = await page.getTextContent();
      const content = (text.items as { str?: string }[])
        .map((item) => item.str ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20_000);
      page.cleanup();
      if (content) withText++;
      batch.push({ user_id: userId, page_id: ref.pageId, file_url: ref.url, file_name: ref.name.slice(0, 200), page_number: number, content, content_fold: fold(content) });
      if (batch.length >= 25) await flush();
      onProgress?.(number, total);
    }
    await flush();
    return { pages: total, withText };
  } finally {
    await doc.destroy();
  }
}
