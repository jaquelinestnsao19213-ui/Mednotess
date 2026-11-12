// Anexos de estudo (parte pura, sem rede): quais formatos o app aceita e como descrevê-los na tela.

export type AttachmentKind = "pdf" | "image" | "text";
export type AttachmentOrigin = "device" | "drive";

export type Attachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  url: string;
  size: number;
  origin: AttachmentOrigin;
  /** Quantos caracteres de texto foram extraídos (só para Word, PowerPoint, Excel e texto). */
  chars?: number;
};

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // a imagem é reduzida antes de subir
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** Valor para o atributo accept do seletor de arquivos do aparelho. */
export const ATTACH_ACCEPT =
  "application/pdf,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.html,.htm,image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const TEXT_EXT = /\.(docx|pptx|xlsx|txt|md|markdown|csv|tsv|json|html?)$/i;
const LEGACY_EXT = /\.(doc|ppt|xls)$/i;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type Classified = { kind: AttachmentKind } | { error: string };

/** Diz qual é o tipo do arquivo, ou por que ele não pode ser lido (a mensagem já vem pronta para mostrar). */
export function classifyFile(file: { name: string; type?: string }): Classified {
  const name = file.name ?? "";
  const type = (file.type ?? "").toLowerCase();
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return { kind: "pdf" };
  if (IMAGE_TYPES.has(type) || IMAGE_EXT.test(name)) return { kind: "image" };
  if (type.startsWith("image/")) return { error: `“${name}” está num formato de imagem que a IA não lê. Salve como JPG ou PNG e envie de novo.` };
  if (LEGACY_EXT.test(name)) return { error: `“${name}” está no formato antigo do Office. Salve como .docx, .pptx ou .xlsx (ou como PDF) e envie de novo.` };
  if (TEXT_EXT.test(name) || type.startsWith("text/")) return { kind: "text" };
  return { error: `“${name}” não é um formato aceito. Envie PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), texto (.txt, .md, .csv) ou imagem (JPG, PNG, WebP).` };
}

export const extensionLabel = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toUpperCase().slice(0, 5) : "ARQ");

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const sameFile = (a: Attachment, b: { name: string; size: number }) => a.name === b.name && a.size === b.size;
export const isDuplicate = (list: Attachment[], file: { name: string; size: number }) => list.some((item) => sameFile(item, file));
