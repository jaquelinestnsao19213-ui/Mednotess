// Converte a escrita à mão do PDF (traços da caneta) em texto digitado, usando o MESMO reconhecedor do caderno
// (components/editor/ink-recognize + /api/handwriting). Os traços do PDF são guardados em fração da largura (x) e da
// altura (y); o reconhecedor trabalha com tudo em unidades de largura, então o y é multiplicado por altura/largura.
import { recognizeInk, type Anchor } from "../editor/ink-recognize";
import { textFromLine, textWidth } from "../editor/ink-text";
import type { InkItem, Item, PageAnn, PdfText } from "./types";

// Mesmas fontes do caderno.
export const PDF_FONTS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Sem serifa", v: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { name: "Com serifa", v: 'Georgia, "Times New Roman", serif' },
  { name: "Mono", v: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { name: "Caveat", v: 'Caveat, "Segoe Print", "Bradley Hand", cursive' },
  { name: "Patrick Hand", v: '"Patrick Hand", "Segoe Print", "Bradley Hand", cursive' },
  { name: "Kalam", v: 'Kalam, "Segoe Print", "Bradley Hand", cursive' },
];

// Largura "virtual" fixa: o resultado não depende do zoom da tela.
const VW = 900;

export type ConvertResult = { removed: Item[]; added: PdfText[]; failed: number; skipped: number };

export async function convertPageInk(ann: PageAnn, ratio: number, font: string | null): Promise<ConvertResult> {
  const pens = ann.items.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen");
  if (!pens.length) return { removed: [], added: [], failed: 0, skipped: 0 };

  // y em unidades de largura
  const work: InkItem[] = pens.map((it) => ({ ...it, pts: it.pts.map((v, i) => (i % 2 ? v * ratio : v)) }));

  // Textos que já existem contam como vizinhos (hífen entre palavras etc.)
  const anchors: Anchor[] = (ann.texts ?? []).map((t) => {
    const px = Math.max(1, t.size * VW);
    const w = textWidth(t.text, px, t.font);
    const cy = t.y * ratio * VW;
    return { left: t.x * VW, right: t.x * VW + w, top: cy - px * 0.6, bottom: cy + px * 0.6 };
  });

  const { lines, failed } = await recognizeInk(work, VW, anchors);
  const gone = new Set(lines.flatMap((l) => l.ids));
  const added: PdfText[] = lines.map((l) => {
    const t = textFromLine(l, VW, font);
    return { id: t.id, kind: "text", x: Math.round(t.x * 10000) / 10000, y: Math.round((t.y / ratio) * 10000) / 10000, text: t.text, size: Math.round(t.size * 100000) / 100000, font: t.font, color: t.color };
  });
  const removed = ann.items.filter((it) => gone.has(it.id));
  return { removed, added, failed, skipped: pens.length - removed.length };
}
