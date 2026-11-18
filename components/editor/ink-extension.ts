import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InkBlockView from "./InkBlockView";

// Bloco de caneta: uma área para escrever à mão (S Pen) entre os textos da página.
// Os traços ficam guardados no próprio documento da página (coordenadas normalizadas pela largura),
// então não precisa mexer no Supabase e o desenho acompanha qualquer tamanho de tela.
export const InkBlock = Node.create({
  name: "inkBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      items: {
        default: [],
        rendered: false,
        parseHTML: (el: HTMLElement) => {
          try {
            const parsed = JSON.parse(el.getAttribute("data-items") ?? "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
      },
      // altura do bloco como fração da largura
      ratio: {
        default: 0.6,
        rendered: false,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-ratio")) || 0.6,
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-ink-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-ink-block": "",
        "data-items": JSON.stringify(node.attrs.items ?? []),
        "data-ratio": String(node.attrs.ratio ?? 0.6),
      }),
      "✍ Escrita à mão",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InkBlockView, { stopEvent: () => true });
  },
});
