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

// Formatação da tabela (colada ou criada): título, mesclar, alinhar e cor da célula.
export function TableFormatting({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  return (
    <>
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
