import { boundsOf } from "./ink-geometry";
import { uid, type Item } from "../pdf/types";

// Texto digitado que substitui a escrita à mão (conversão automática), guardado na própria camada de escrita.
// x e y: início e centro vertical da linha; size: altura da letra. Tudo dividido pela LARGURA da página.
export type TextItem = { id: string; kind: "text"; x: number; y: number; text: string; size: number; font: string | null; color: string };
export type LayerItem = Item | TextItem;

export const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export const isInkLike = (it: LayerItem): it is Item => it.kind !== "text";

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

export function textWidth(text: string, px: number, font: string | null): number {
  const c = mctx();
  if (!c) return text.length * px * 0.5;
  c.font = `${px}px ${font ?? SANS}`;
  return c.measureText(text).width;
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextItem, w: number) {
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.font = `${Math.max(1, Math.round(t.size * w * 10) / 10)}px ${t.font ?? SANS}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(t.text, t.x * w, t.y * w);
  ctx.restore();
}

// [x0, y0, x1, y1] normalizado pela largura
export function textBounds(t: TextItem, w: number): [number, number, number, number] {
  const px = Math.max(1, t.size * w);
  const width = textWidth(t.text, px, t.font);
  const half = (px * 1.2) / 2;
  return [t.x, t.y - half / w, t.x + width / w, t.y + half / w];
}

export function hitText(t: TextItem, x: number, y: number, w: number, radiusPx: number): boolean {
  const [x0, y0, x1, y1] = textBounds(t, w);
  const r = radiusPx / w;
  return x >= x0 - r && x <= x1 + r && y >= y0 - r && y <= y1 + r;
}

function pointInPoly(poly: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i + 1 < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function textInPoly(t: TextItem, poly: number[], w: number): boolean {
  const [x0, y0, x1, y1] = textBounds(t, w);
  return pointInPoly(poly, (x0 + x1) / 2, (y0 + y1) / 2);
}

// Caixa que envolve os itens selecionados (traços e textos). null quando não há seleção.
export function unionBox(items: LayerItem[], sel: Set<string>, w: number): number[] | null {
  if (!sel.size) return null;
  const b = boundsOf(items.filter(isInkLike), sel);
  let box: number[] | null = b ? [b[0], b[1], b[2], b[3]] : null;
  for (const it of items) {
    if (it.kind !== "text" || !sel.has(it.id)) continue;
    const t = textBounds(it, w);
    box = box ? [Math.min(box[0], t[0]), Math.min(box[1], t[1]), Math.max(box[2], t[2]), Math.max(box[3], t[3])] : [t[0], t[1], t[2], t[3]];
  }
  return box;
}

// Cria o texto digitado a partir de uma linha reconhecida (mesma posição, altura e cor da escrita).
export function textFromLine(l: { text: string; left: number; top: number; bottom: number; color: string }, w: number, font: string | null): TextItem {
  const h = Math.max(1, l.bottom - l.top);
  let px = Math.max(16, Math.min(56, h * 0.95));
  const width = textWidth(l.text, px, font);
  const room = w * 0.97 - l.left;
  if (width > room && width > 0 && room > 20) px = Math.max(10, (px * room) / width);
  return { id: uid(), kind: "text", x: l.left / w, y: (l.top + l.bottom) / 2 / w, text: l.text, size: px / w, font, color: l.color };
}

// Fontes de letra manuscrita (Google Fonts). Se não carregarem, o navegador usa a fonte de reserva da lista.
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Kalam&family=Patrick+Hand&display=swap";
export function loadHandwritingFonts(onReady: () => void) {
  if (typeof document === "undefined") return;
  if (!document.getElementById("mednotes-hand-fonts")) {
    const link = document.createElement("link");
    link.id = "mednotes-hand-fonts";
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  Promise.all(["20px Caveat", "20px Kalam", '20px "Patrick Hand"'].map((f) => fonts.load(f)))
    .then(onReady)
    .catch(() => undefined);
}
