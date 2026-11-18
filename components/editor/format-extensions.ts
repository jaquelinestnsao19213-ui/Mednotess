import { Extension } from "@tiptap/core";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

export function safeFontFamily(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 200) return null;
  if (/[;{}<>\\]|url\s*\(|expression\s*\(|\/\*/i.test(v)) return null;
  return v;
}

// Família da fonte (guardada dentro da marca "textStyle"): o texto colado mantém a fonte de origem.
export const FontFamily = Extension.create({
  name: "fontFamily",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => safeFontFamily(el.style.fontFamily),
            renderHTML: (attrs: Record<string, unknown>) => {
              const family = safeFontFamily(typeof attrs.fontFamily === "string" ? attrs.fontFamily : null);
              return family ? { style: `font-family: ${family}` } : {};
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontFamily: (family: string) => ({ chain }) => chain().setMark("textStyle", { fontFamily: family }).run(),
      unsetFontFamily: () => ({ chain }) =>
        chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});

function isTransparent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return !t || t === "transparent" || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(t);
}

// Células de tabela com cor de fundo e alinhamento do texto (mantidos ao colar e editáveis depois).
const cellStyleAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.backgroundColor;
      return v && !isTransparent(v) ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.backgroundColor ? { style: `background-color: ${String(attrs.backgroundColor)}` } : {},
  },
  textAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.textAlign;
      return v === "left" || v === "center" || v === "right" || v === "justify" ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.textAlign ? { style: `text-align: ${String(attrs.textAlign)}` } : {},
  },
};

/* ---------- arrastar a borda da coluna (mouse, dedo ou caneta) ---------- */

const MIN_COL = 48; // largura mínima de uma coluna, em pixels

function columnCount(table: HTMLTableElement): number {
  let max = 0;
  for (const row of Array.from(table.rows)) {
    let sum = 0;
    for (const cell of Array.from(row.cells)) sum += cell.colSpan || 1;
    max = Math.max(max, sum);
  }
  return max;
}

// índice da primeira coluna ocupada pela célula
function columnStart(cell: HTMLTableCellElement): number {
  let start = 0;
  for (let el = cell.previousElementSibling; el; el = el.previousElementSibling) start += (el as HTMLTableCellElement).colSpan || 1;
  return start;
}

// largura de cada coluna, como está na tela agora
function measureColumns(table: HTMLTableElement): number[] {
  const count = columnCount(table);
  const rows = Array.from(table.rows);
  const plain = rows.find((row) => row.cells.length === count && Array.from(row.cells).every((c) => (c.colSpan || 1) === 1));
  if (plain) return Array.from(plain.cells).map((c) => c.getBoundingClientRect().width);
  const widths: number[] = [];
  const first = rows[0];
  if (first) {
    for (const cell of Array.from(first.cells)) {
      const span = cell.colSpan || 1;
      for (let i = 0; i < span; i++) widths.push(cell.getBoundingClientRect().width / span);
    }
  }
  while (widths.length < count) widths.push(table.getBoundingClientRect().width / Math.max(count, 1));
  return widths;
}

// mostra o novo tamanho enquanto o dedo arrasta (sem mexer no documento)
function previewColumns(table: HTMLTableElement, widths: number[]) {
  const cols = table.querySelectorAll(":scope > colgroup > col");
  if (cols.length !== widths.length) return;
  cols.forEach((col, i) => {
    const el = col as HTMLElement;
    el.style.width = `${widths[i]}px`;
    el.style.minWidth = `${widths[i]}px`;
  });
}

// grava a largura de todas as colunas em todas as linhas (assim ela aparece em qualquer linha)
function commitColumns(view: EditorView, table: HTMLTableElement, widths: number[]) {
  const hit: { node: PMNode | null; pos: number } = { node: null, pos: -1 };
  view.state.doc.descendants((node, pos) => {
    if (hit.node) return false;
    if (node.type.name === "table") {
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (dom && (dom === table || dom.contains(table))) {
        hit.node = node;
        hit.pos = pos;
        return false;
      }
    }
    return true;
  });
  if (!hit.node) return;
  const tr = view.state.tr;
  const base = hit.pos + 1;
  hit.node.forEach((row, rowOffset) => {
    let col = 0;
    row.forEach((cellNode, cellOffset) => {
      const span = Number(cellNode.attrs.colspan) || 1;
      const slice = widths.slice(col, col + span).map((w) => Math.round(w));
      tr.setNodeMarkup(base + rowOffset + 1 + cellOffset, undefined, { ...cellNode.attrs, colwidth: slice.length === span ? slice : null });
      col += span;
    });
  });
  view.dispatch(tr);
}

// Qual borda entre colunas está sob o ponteiro? (devolve o índice da coluna à esquerda da borda)
function borderUnder(view: EditorView, event: PointerEvent): { table: HTMLTableElement; boundary: number } | null {
  const target = event.target as HTMLElement | null;
  const cell = target?.closest?.("td,th") as HTMLTableCellElement | null;
  if (!cell || !view.dom.contains(cell)) return null;
  const table = cell.closest("table") as HTMLTableElement | null;
  if (!table) return null;
  const zone = event.pointerType === "mouse" ? 8 : 16;
  const rect = cell.getBoundingClientRect();
  const start = columnStart(cell);
  const last = start + (cell.colSpan || 1) - 1;
  const total = columnCount(table);
  const fromRight = rect.right - event.clientX;
  if (fromRight <= zone && fromRight >= -zone && last < total - 1) return { table, boundary: last };
  if (event.clientX - rect.left <= zone && start > 0) return { table, boundary: start - 1 };
  return null;
}

function columnDragPlugin() {
  return new Plugin({
    key: new PluginKey("columnDrag"),
    view(view) {
      let dragging = false;

      const onHover = (event: PointerEvent) => {
        if (dragging || event.pointerType !== "mouse") return;
        view.dom.classList.toggle("col-resize-cursor", !!borderUnder(view, event));
      };

      const onDown = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0 || !view.editable) return;
        const found = borderUnder(view, event);
        if (!found) return;
        const { table, boundary } = found;
        const startX = event.clientX;
        const startWidths = measureColumns(table);
        if (boundary + 1 >= startWidths.length) return;
        let widths = startWidths;
        let active = false;
        // com o mouse a borda é fina: não deixa o clique virar seleção de texto
        if (event.pointerType === "mouse") event.preventDefault();

        const move = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          const raw = e.clientX - startX;
          if (!active) {
            if (Math.abs(raw) < 4) return; // um toque simples continua sendo só um toque
            active = true;
            dragging = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }
          e.preventDefault();
          const delta = Math.min(Math.max(raw, -(startWidths[boundary] - MIN_COL)), startWidths[boundary + 1] - MIN_COL);
          widths = startWidths.map((w, i) => (i === boundary ? w + delta : i === boundary + 1 ? w - delta : w));
          previewColumns(table, widths);
        };

        const finish = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          dragging = false;
          view.dom.classList.remove("col-resize-cursor");
          if (active && e.type !== "pointercancel") commitColumns(view, table, widths);
          else if (active) previewColumns(table, startWidths);
        };

        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      };

      view.dom.addEventListener("pointermove", onHover);
      view.dom.addEventListener("pointerdown", onDown, true);
      return {
        destroy() {
          view.dom.removeEventListener("pointermove", onHover);
          view.dom.removeEventListener("pointerdown", onDown, true);
        },
      };
    },
  });
}

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
  addProseMirrorPlugins() {
    return [columnDragPlugin()];
  },
});

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
});
