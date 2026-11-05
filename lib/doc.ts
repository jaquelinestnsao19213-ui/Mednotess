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
