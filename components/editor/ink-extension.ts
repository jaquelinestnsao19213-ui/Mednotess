import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InkBlockView from "./InkBlockView";
import { drawItem } from "../pdf/draw";
import type { Item } from "../pdf/types";
import { smoothItemCached } from "./ink-smooth";

// Desenha os traços numa imagem PNG para a exportação em PDF e para copiar a página.
function inkToDataUrl(items: Item[], ratio: number, smooth: number): string | null {
  if (typeof document === "undefined" || !items.length) return null;
  try {
    const W = 1000;
    const H = Math.max(1, Math.round(W * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    for (const it of items) drawItem(ctx, smoothItemCached(it, smooth), W, W);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function smoothOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.35;
}

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
      // tipo de papel: dots (pontilhado), grid (quadriculado), ruled (pautado) ou blank (liso)
      paper: {
        default: "dots",
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-paper") ?? "dots",
      },
      // aperfeiçoamento da escrita (0 a 1): suaviza os traços só na exibição; o original fica guardado
      smooth: {
        default: 0.35,
        rendered: false,
        parseHTML: (el: HTMLElement) => smoothOf(el.getAttribute("data-smooth")),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-ink-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const items = (Array.isArray(node.attrs.items) ? node.attrs.items : []) as Item[];
    const ratio = Number(node.attrs.ratio) || 0.6;
    const smooth = smoothOf(node.attrs.smooth);
    const url = inkToDataUrl(items, ratio, smooth);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-ink-block": "",
        "data-items": JSON.stringify(items),
        "data-ratio": String(ratio),
        "data-paper": String(node.attrs.paper ?? "dots"),
        "data-smooth": String(smooth),
        style: "border:1px solid #d5dbe3;border-radius:8px;background:#fff;overflow:hidden;margin:12px 0",
      }),
      url ? ["img", { src: url, alt: "Escrita à mão", style: "width:100%;display:block" }] : "✍ Escrita à mão",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InkBlockView, { stopEvent: () => true });
  },
});
