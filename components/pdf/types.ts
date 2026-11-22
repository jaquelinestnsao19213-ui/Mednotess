// Modelo das anotações. Tudo é guardado em coordenadas NORMALIZADAS (0 a 1)
// em relação à página, então o desenho acompanha qualquer zoom ou tamanho de tela.
import type { TextItem } from "../editor/ink-text";

export type Tool = "hand" | "pen" | "highlighter" | "circle" | "eraser" | "lasso" | "note" | "select" | "clip";

export type InkItem = {
  id: string;
  kind: "ink";
  tool: "pen" | "highlighter";
  color: string;
  width: number; // fração da largura da página
  pts: number[]; // [x0, y0, x1, y1, ...] normalizados
  keep?: boolean; // "Manter como desenho": nunca vira texto
  force?: boolean; // "Converter como texto": nunca é tratado como desenho
};

export type EllipseItem = {
  id: string;
  kind: "ellipse";
  color: string;
  width: number;
  cx: number;
  cy: number;
  rx: number; // fração da largura
  ry: number; // fração da altura
};

export type Item = InkItem | EllipseItem;

// text = texto simples (busca e comentário vazio); html = texto formatado; w/h = tamanho da caixa (px); fs = tamanho da letra (px)
// ro = comentário da dona do caderno (link publicado) visto por um visitante (só leitura; nunca é salvo)
export type Note = { id: string; x: number; y: number; text: string; color: string; html?: string; w?: number; h?: number; fs?: number; ro?: boolean };

// Comentário copiado (para colar em outro lugar do PDF)
export type NoteClip = Pick<Note, "text" | "html" | "color" | "w" | "h" | "fs">;

// texts = escrita à mão convertida em fonte. Mesmo formato do caderno: x, y e size divididos pela LARGURA da página.
export type PageAnn = { items: Item[]; notes: Note[]; texts?: TextItem[] };

export const EMPTY: PageAnn = { items: [], notes: [] };

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAnn(data: unknown): PageAnn {
  const d = (data ?? {}) as Partial<PageAnn>;
  return {
    items: Array.isArray(d.items) ? (d.items as Item[]) : [],
    notes: Array.isArray(d.notes) ? (d.notes as Note[]) : [],
    texts: Array.isArray(d.texts) ? (d.texts as TextItem[]) : [],
  };
}

// ---------- Histórico (desfazer / refazer) ----------
// Cada operação sabe se desfazer e se refazer sobre o estado ATUAL da página,
// então mexer num comentário depois de desenhar não atrapalha o "desfazer".
export type Op = {
  page: number;
  undo: (a: PageAnn) => PageAnn;
  redo: (a: PageAnn) => PageAnn;
};

export const opAddItem = (page: number, item: Item): Op => ({
  page,
  redo: (a) => ({ ...a, items: [...a.items, item] }),
  undo: (a) => ({ ...a, items: a.items.filter((i) => i.id !== item.id) }),
});

export const opRemoveItems = (page: number, items: Item[]): Op => {
  const ids = new Set(items.map((i) => i.id));
  return {
    page,
    redo: (a) => ({ ...a, items: a.items.filter((i) => !ids.has(i.id)) }),
    undo: (a) => ({ ...a, items: [...a.items, ...items] }),
  };
};

// Troca traços e textos de uma vez (conversão da escrita, correção de palavras, "manter como desenho", borracha).
export const opTextChange = (
  page: number,
  c: { rmItems: Item[]; addItems: Item[]; rmTexts: TextItem[]; addTexts: TextItem[] }
): Op => {
  const rmI = new Set(c.rmItems.map((i) => i.id));
  const addI = new Set(c.addItems.map((i) => i.id));
  const rmT = new Set(c.rmTexts.map((t) => t.id));
  const addT = new Set(c.addTexts.map((t) => t.id));
  return {
    page,
    redo: (a) => ({
      ...a,
      items: [...a.items.filter((i) => !rmI.has(i.id)), ...c.addItems],
      texts: [...(a.texts ?? []).filter((t) => !rmT.has(t.id)), ...c.addTexts],
    }),
    undo: (a) => ({
      ...a,
      items: [...a.items.filter((i) => !addI.has(i.id)), ...c.rmItems],
      texts: [...(a.texts ?? []).filter((t) => !addT.has(t.id)), ...c.rmTexts],
    }),
  };
};

export const opAddNote = (page: number, note: Note): Op => ({
  page,
  redo: (a) => ({ ...a, notes: [...a.notes, note] }),
  undo: (a) => ({ ...a, notes: a.notes.filter((n) => n.id !== note.id) }),
});

export const opRemoveNote = (page: number, note: Note): Op => ({
  page,
  redo: (a) => ({ ...a, notes: a.notes.filter((n) => n.id !== note.id) }),
  undo: (a) => ({ ...a, notes: [...a.notes, note] }),
});

// Mover o emblema do comentário de lugar (desfazer volta para a posição anterior)
export const opMoveNote = (
  page: number,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Op => ({
  page,
  redo: (a) => ({ ...a, notes: a.notes.map((n) => (n.id === id ? { ...n, x: to.x, y: to.y } : n)) }),
  undo: (a) => ({ ...a, notes: a.notes.map((n) => (n.id === id ? { ...n, x: from.x, y: from.y } : n)) }),
});

// ---------- Ferramentas ----------
export const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: "hand", label: "Navegar", glyph: "✋" },
  { id: "pen", label: "Caneta", glyph: "✎" },
  { id: "highlighter", label: "Marca-texto", glyph: "▮" },
  { id: "circle", label: "Círculo", glyph: "◯" },
  { id: "eraser", label: "Borracha", glyph: "⌫" },
  { id: "lasso", label: "Laço", glyph: "⬚" },
  { id: "note", label: "Comentário", glyph: "💬" },
  { id: "select", label: "Selecionar texto", glyph: "T" },
  { id: "clip", label: "Copiar imagem", glyph: "✂" },
];

export const INK_COLORS = ["#1b2430", "#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c"];
export const MARK_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa", "#fb923c", "#c084fc"];

// Espessuras como fração da largura da página (fina, média, grossa).
export const PEN_WIDTHS = [0.0022, 0.0038, 0.0065];
export const MARK_WIDTHS = [0.014, 0.022, 0.034];
