import type { JSONContent } from "@tiptap/core";

// Aceita o formato antigo (texto simples) e o novo (documento do editor).
export function toDoc(content: unknown): JSONContent {
  if (content && !Array.isArray(content) && (content as JSONContent).type === "doc") {
    return content as JSONContent;
  }
  const text = Array.isArray(content) ? ((content[0] as { text?: string })?.text ?? "") : "";
  if (!text) return { type: "doc", content: [{ type: "paragraph" }] };
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

const section = (title: string): JSONContent[] => [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] },
  { type: "paragraph" },
];

// Molde de página de aula, igual ao do seu Notion.
export const LESSON_TEMPLATE: JSONContent = {
  type: "doc",
  content: [
    ...section("Tema e objetivos"),
    ...section("Transcrição"),
    ...section("Resumo da aula"),
    ...section("Dúvidas para revisar"),
    ...section("Materiais e referências"),
  ],
};

/** Texto simples de um documento do editor (usado para montar o material que a IA lê). */
export function docToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "fileCard") return `[PDF anexado: ${String(n.attrs?.name ?? "arquivo")}]\n`;
  if (n.type === "webEmbed") return `[Site incorporado: ${String(n.attrs?.title || n.attrs?.url || "")}]\n`;
  // Áudios e vídeos: só o título/descrição entram como texto. O conteúdo do áudio nunca é transcrito nem enviado.
  if (n.type === "audioNote") {
    const description = n.attrs?.description ? ` — ${String(n.attrs.description)}` : "";
    return `[Áudio: ${String(n.attrs?.title || "sem título")}${description}]\n`;
  }
  if (n.type === "videoNote") {
    const subject = n.attrs?.subject ? ` (${String(n.attrs.subject)})` : "";
    return `[Vídeo: ${String(n.attrs?.title || n.attrs?.url || "sem título")}${subject}]\n`;
  }
  const inner = (n.content ?? []).map(docToText);
  const text = n.type === "tableRow" ? inner.join(" | ") : inner.join("");
  const blocks = ["paragraph", "heading", "listItem", "taskItem", "tableRow", "blockquote", "codeBlock"];
  return n.type && blocks.includes(n.type) ? text + "\n" : text;
}

/** Endereços dos PDFs anexados numa página (nós "fileCard"). */
export function docPdfUrls(node: unknown, found: { url: string; name: string }[] = []) {
  if (!node || typeof node !== "object") return found;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "fileCard" && typeof n.attrs?.url === "string") found.push({ url: n.attrs.url, name: String(n.attrs.name ?? "arquivo") });
  for (const child of n.content ?? []) docPdfUrls(child, found);
  return found;
}
