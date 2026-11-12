// Peças do servidor para ler os arquivos que a usuária anexou (PDF, imagem e texto extraído de Word/PowerPoint/etc.).
// Só aceita endereços da pasta da própria usuária no Storage e nunca descarta arquivo em silêncio:
// o que ficar de fora volta numa lista de avisos para ser mostrada na tela.
import type Anthropic from "@anthropic-ai/sdk";

export type FileKind = "pdf" | "image" | "text";
export type FileRef = { url: string; name: string; kind: FileKind };

export const FILE_LIMITS = {
  pdfs: 5,
  images: 8,
  texts: 10,
  textPerFile: 60_000, // caracteres de cada arquivo de texto
  textTotal: 150_000, // caracteres somados de todos os arquivos de texto
  textBytes: 2_000_000, // tamanho máximo baixado de cada arquivo de texto
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json)$/i;

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Descobre o tipo pelo campo "kind" ou, nas atividades antigas (só PDFs), pelo final do endereço. */
export function inferKind(url: string, kind?: unknown): FileKind {
  if (kind === "pdf" || kind === "image" || kind === "text") return kind;
  const path = url.split("?")[0];
  if (IMAGE_EXT.test(path)) return "image";
  if (TEXT_EXT.test(path)) return "text";
  return "pdf";
}

export type ParsedRefs = { refs: FileRef[]; notes: string[] };

/**
 * Valida a lista enviada pelo navegador. `allowedPrefix` é a pasta da usuária no Storage.
 * Respeita os limites de cada tipo e devolve um aviso para cada arquivo que ficou de fora.
 */
export function parseFileRefs(raw: unknown, allowedPrefix: string, seed: FileRef[] = [], limits = FILE_LIMITS): ParsedRefs {
  const refs: FileRef[] = [...seed];
  const notes: string[] = [];
  const count = (kind: FileKind) => refs.filter((r) => r.kind === kind).length;
  const cap: Record<FileKind, number> = { pdf: limits.pdfs, image: limits.images, text: limits.texts };
  const plural: Record<FileKind, string> = { pdf: "PDFs", image: "imagens", text: "documentos de texto" };

  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = (item ?? {}) as { url?: unknown; name?: unknown; kind?: unknown };
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!url || url.length > 600 || !url.startsWith(allowedPrefix)) continue; // só arquivos da própria usuária
    if (refs.some((r) => r.url === url)) continue;
    const kind = inferKind(url, entry.kind);
    const name = clean(entry.name, 120) || (kind === "pdf" ? "arquivo.pdf" : "arquivo");
    if (count(kind) >= cap[kind]) {
      notes.push(`“${name}” ficou de fora: o limite é de ${cap[kind]} ${plural[kind]} por geração.`);
      continue;
    }
    refs.push({ url, name, kind });
  }
  return { refs, notes };
}

/**
 * Reparte o limite total de caracteres entre os arquivos de forma justa: arquivos curtos entram inteiros
 * e o que sobra vai para os longos. Assim nenhum arquivo é ignorado só por vir depois dos outros.
 */
export function allocateBudget(lengths: number[], total: number, perFile: number): number[] {
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  const out = new Array<number>(lengths.length).fill(0);
  let remaining = total;
  order.forEach((entry, position) => {
    const fair = Math.floor(remaining / (order.length - position));
    const give = Math.max(0, Math.min(entry.length, perFile, fair));
    out[entry.index] = give;
    remaining -= give;
  });
  return out;
}

/** Corta o texto perto de um fim de parágrafo, para não terminar no meio de uma frase. */
export function cutText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const breakAt = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"), head.lastIndexOf(". "));
  return (breakAt > limit * 0.8 ? head.slice(0, breakAt + 1) : head).trimEnd();
}

export type TextDoc = { name: string; text: string; truncated: boolean };

/** Baixa os arquivos de texto do Storage e aplica o limite justo. Falhas viram avisos, nunca erro geral. */
export async function loadTextDocs(
  refs: FileRef[],
  signal: AbortSignal,
  limits = FILE_LIMITS,
  fetchImpl: typeof fetch = fetch
): Promise<{ docs: TextDoc[]; notes: string[] }> {
  const notes: string[] = [];
  const loaded = await Promise.all(
    refs.map(async (ref) => {
      try {
        const response = await fetchImpl(ref.url, { signal });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > limits.textBytes * 2) throw new Error("grande demais");
        const text = (await response.text()).replace(/\r\n/g, "\n").trim();
        if (!text) throw new Error("vazio");
        return { name: ref.name, text };
      } catch {
        notes.push(`Não consegui ler “${ref.name}” (o arquivo está indisponível ou vazio).`);
        return null;
      }
    })
  );
  const ready = loaded.filter((item): item is { name: string; text: string } => item !== null);
  const budget = allocateBudget(ready.map((d) => d.text.length), limits.textTotal, limits.textPerFile);
  const docs = ready.map((doc, index) => {
    const text = cutText(doc.text, budget[index]);
    const truncated = text.length < doc.text.length;
    if (truncated) notes.push(`“${doc.name}” é longo: a IA leu os primeiros ${text.length.toLocaleString("pt-BR")} de ${doc.text.length.toLocaleString("pt-BR")} caracteres.`);
    return { name: doc.name, text, truncated };
  });
  return { docs, notes };
}

export const textDocsToMaterial = (docs: TextDoc[]) => docs.map((d) => `### Arquivo: ${d.name}\n${d.text}`).join("\n\n");

/* ---------- blocos para a API da IA ---------- */

export const docBlock = (url: string, title?: string) =>
  ({ type: "document", source: { type: "url", url }, ...(title ? { title: title.slice(0, 120) } : {}) }) as unknown as Anthropic.ContentBlockParam;

export const imageBlock = (url: string) => ({ type: "image", source: { type: "url", url } }) as unknown as Anthropic.ContentBlockParam;

/** PDFs e imagens viram blocos; o texto dos outros arquivos vai dentro do prompt (ver loadTextDocs). */
export function visualBlocks(refs: FileRef[]): Anthropic.ContentBlockParam[] {
  return refs.filter((r) => r.kind !== "text").map((r) => (r.kind === "image" ? imageBlock(r.url) : docBlock(r.url, r.name)));
}
