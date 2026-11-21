import { uid, type InkItem } from "../pdf/types";

// Marca-texto alinhado ao texto: em vez de guardar o traço torto, pinta uma faixa reta sobre cada linha de texto
// entre o começo e o fim do traço. Só funciona com texto da página (DOM); sem texto embaixo, devolve null.

type Caret = { node: Node; offset: number };

function caretAt(x: number, y: number): Caret | null {
  const d = document as unknown as {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  return null;
}

function caretInText(x: number, y: number, root: Element): Caret | null {
  for (const dy of [0, -8, 8, -16, 16]) {
    const c = caretAt(x, y + dy);
    if (c && c.node.nodeType === Node.TEXT_NODE && root.contains(c.node)) return c;
  }
  return null;
}

type Line = { left: number; right: number; top: number; bottom: number };

function textLines(range: Range): Line[] {
  const rects: DOMRect[] = [];
  const add = (node: Text) => {
    if (!range.intersectsNode(node)) return;
    const tr = document.createRange();
    tr.selectNodeContents(node);
    if (node === range.startContainer) tr.setStart(node, range.startOffset);
    if (node === range.endContainer) tr.setEnd(node, range.endOffset);
    if (tr.collapsed || !tr.toString().trim()) return;
    for (const r of Array.from(tr.getClientRects())) if (r.width > 1 && r.height > 1) rects.push(r);
  };
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) add(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) add(n as Text);
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const r of rects) {
    const cy = (r.top + r.bottom) / 2;
    const g = lines[lines.length - 1];
    if (g && Math.abs(cy - (g.top + g.bottom) / 2) < (g.bottom - g.top) * 0.5) {
      g.left = Math.min(g.left, r.left);
      g.right = Math.max(g.right, r.right);
      g.top = Math.min(g.top, r.top);
      g.bottom = Math.max(g.bottom, r.bottom);
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  return lines;
}

// start/end em coordenadas da tela (clientX/Y). Devolve uma faixa (marca-texto) por linha de texto, ou null.
export function highlightLines(opts: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  canvas: HTMLCanvasElement;
  color: string;
}): InkItem[] | null {
  const { canvas, start, end, color } = opts;
  if (typeof document === "undefined") return null;
  const root = canvas.parentElement?.querySelector(".ProseMirror") ?? document.querySelector(".ProseMirror");
  if (!root) return null;
  const prev = canvas.style.pointerEvents;
  canvas.style.pointerEvents = "none";
  let a: Caret | null;
  let b: Caret | null;
  try {
    a = caretInText(start.x, start.y, root);
    b = caretInText(end.x, end.y, root);
  } finally {
    canvas.style.pointerEvents = prev;
  }
  if (!a || !b) return null;
  const before =
    a.node === b.node ? a.offset <= b.offset : !!(a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING);
  const [s, e] = before ? [a, b] : [b, a];
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  const lines = textLines(range);
  if (!lines.length || lines.length > 30) return null;
  // Os dois pontos do traço precisam estar perto de uma linha: marcar em área vazia não pega texto distante.
  const near = (p: { y: number }) => lines.some((l) => p.y >= l.top - (l.bottom - l.top) * 0.7 && p.y <= l.bottom + (l.bottom - l.top) * 0.7);
  if (!near(start) || !near(end)) return null;
  const cr = canvas.getBoundingClientRect();
  if (!cr.width) return null;
  return lines.map((l) => ({
    id: uid(),
    kind: "ink" as const,
    tool: "highlighter" as const,
    color,
    width: ((l.bottom - l.top) * 0.92) / cr.width,
    pts: [(l.left - cr.left) / cr.width, ((l.top + l.bottom) / 2 - cr.top) / cr.width, (l.right - cr.left) / cr.width, ((l.top + l.bottom) / 2 - cr.top) / cr.width],
    shape: true,
  }));
}
