"use client";

import type { Editor } from "@tiptap/core";

const FONTS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Sem serifa", v: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { name: "Com serifa", v: 'Georgia, "Times New Roman", serif' },
  { name: "Mono", v: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
];

const CELL_COLORS = ["#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#ede9fe", "#fee2e2", "#f3f4f6"];

// Escolha da fonte do texto selecionado.
export function FontFamilyPicker({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  return (
    <>
      <p className="sheet-label">Fonte</p>
      <div className="sheet-row">
        {FONTS.map((f) => (
          <button
            type="button"
            key={f.name}
            aria-label={`Fonte ${f.name}`}
            className={f.v && editor.isActive("textStyle", { fontFamily: f.v }) ? "chip on" : "chip"}
            style={f.v ? { fontFamily: f.v } : undefined}
            onClick={() => (f.v ? chain().setFontFamily(f.v).run() : chain().unsetFontFamily().run())}
          >
            {f.name}
          </button>
        ))}
      </div>
    </>
  );
}

// Célula (ou cabeçalho) onde está o cursor.
function currentCell(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") return { node, pos: $from.before(d) };
  }
  return null;
}

// Aumenta/diminui a largura da coluna onde está o cursor (funciona com toque, sem precisar arrastar).
function changeColumnWidth(editor: Editor, delta: number) {
  const cell = currentCell(editor);
  if (!cell) return;
  const span = Number(cell.node.attrs.colspan) || 1;
  const saved = Array.isArray(cell.node.attrs.colwidth) ? (cell.node.attrs.colwidth as number[]).reduce((a, b) => a + b, 0) : 0;
  const dom = editor.view.nodeDOM(cell.pos) as HTMLElement | null;
  const current = saved || dom?.getBoundingClientRect().width || 120;
  const next = Math.min(1200, Math.max(60, Math.round(current + delta)));
  const widths = Array.from({ length: span }, () => Math.round(next / span));
  editor.chain().focus().setCellAttribute("colwidth", widths).run();
}

// Remove as larguras fixas: a tabela volta a ocupar a largura da página, com colunas iguais.
function fitTableToPage(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const table = $from.node(d);
    if (table.type.name !== "table") continue;
    const start = $from.start(d);
    const tr = state.tr;
    table.descendants((n, p) => {
      if (n.type.name === "tableCell" || n.type.name === "tableHeader") {
        tr.setNodeMarkup(start + p, undefined, { ...n.attrs, colwidth: null });
      }
    });
    view.dispatch(tr);
    editor.commands.focus();
    return;
  }
}

// Formatação da tabela (colada ou criada): largura das colunas, título, mesclar, alinhar e cor da célula.
export function TableFormatting({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  return (
    <>
      <p className="sheet-label">Largura (arraste a borda da coluna ou use os botões)</p>
      <div className="sheet-row">
        <button type="button" className="chip" aria-label="Diminuir coluna" onClick={() => changeColumnWidth(editor, -40)}>− Coluna mais estreita</button>
        <button type="button" className="chip" aria-label="Aumentar coluna" onClick={() => changeColumnWidth(editor, 40)}>+ Coluna mais larga</button>
        <button type="button" className="chip" onClick={() => fitTableToPage(editor)}>Ajustar à página</button>
      </div>
      <div className="sheet-row">
        <button type="button" className="chip" onClick={() => chain().toggleHeaderRow().run()}>Linha de título</button>
        <button type="button" className="chip" onClick={() => chain().mergeCells().run()}>Mesclar células</button>
        <button type="button" className="chip" onClick={() => chain().splitCell().run()}>Dividir célula</button>
      </div>
      <p className="sheet-label">Alinhar texto da célula</p>
      <div className="sheet-row">
        <button type="button" className="chip" onClick={() => chain().setCellAttribute("textAlign", "left").run()}>Esquerda</button>
        <button type="button" className="chip" onClick={() => chain().setCellAttribute("textAlign", "center").run()}>Centro</button>
        <button type="button" className="chip" onClick={() => chain().setCellAttribute("textAlign", "right").run()}>Direita</button>
      </div>
      <p className="sheet-label">Cor da célula (arraste sobre várias células para colorir juntas)</p>
      <div className="sheet-row">
        {CELL_COLORS.map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`Cor da célula ${color}`}
            className="swatch"
            style={{ background: color }}
            onClick={() => chain().setCellAttribute("backgroundColor", color).run()}
          />
        ))}
        <button type="button" className="chip" onClick={() => chain().setCellAttribute("backgroundColor", null).run()}>Sem cor</button>
      </div>
    </>
  );
}
