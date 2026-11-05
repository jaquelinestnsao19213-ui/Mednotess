"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TipEditor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Callout, FileCard, FontSize, ResizableImage, Toggle, TrailingNode } from "./editor/extensions";
import { uploadFile } from "@/lib/upload";

type Cmd = { label: string; keywords: string; run: (e: TipEditor) => void };

const BLOCKS: Cmd[] = [
  { label: "Texto", keywords: "texto paragrafo", run: (e) => e.chain().focus().setParagraph().run() },
  { label: "Título 1", keywords: "titulo h1 grande", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Título 2", keywords: "titulo h2 medio", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Título 3", keywords: "titulo h3 pequeno subtitulo", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "Lista com marcadores", keywords: "lista marcadores bullet", run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Lista numerada", keywords: "lista numerada numeros", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Lista de tarefas", keywords: "tarefas checklist caixa", run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Lista recolhível (toggle)", keywords: "toggle recolher recolhivel", run: (e) => e.chain().focus().toggleWrap("toggle").run() },
  { label: "Citação", keywords: "citacao quote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Bloco de código", keywords: "codigo code", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "Divisória", keywords: "divisoria linha separador", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { label: "Destaque (callout)", keywords: "destaque callout aviso", run: (e) => e.chain().focus().toggleWrap("callout").run() },
  { label: "Tabela", keywords: "tabela", run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

const TEXT_COLORS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Cinza", v: "#6b7280" },
  { name: "Vermelho", v: "#dc2626" },
  { name: "Laranja", v: "#ea580c" },
  { name: "Verde", v: "#16a34a" },
  { name: "Azul", v: "#2563eb" },
  { name: "Roxo", v: "#9333ea" },
  { name: "Rosa", v: "#db2777" },
];
const MARKERS = [
  { name: "Amarelo", v: "#fde68a" },
  { name: "Verde", v: "#bbf7d0" },
  { name: "Azul", v: "#bfdbfe" },
  { name: "Rosa", v: "#fbcfe8" },
  { name: "Laranja", v: "#fed7aa" },
  { name: "Roxo", v: "#e9d5ff" },
];
const SIZES: { name: string; v: string | null }[] = [
  { name: "Pequeno", v: "0.85em" },
  { name: "Normal", v: null },
  { name: "Grande", v: "1.3em" },
  { name: "Enorme", v: "1.75em" },
];

export default function Editor({
  initial,
  onChange,
}: {
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [message, setMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState<null | "format" | "insert">(null);
  const [slash, setSlash] = useState<null | { query: string; top: number; left: number }>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const slashRef = useRef(slash);
  slashRef.current = slash;
  const indexRef = useRef(0);
  indexRef.current = slashIndex;
  const editorRef = useRef<TipEditor | null>(null);

  const allItems: Cmd[] = [
    ...BLOCKS,
    { label: "Imagem", keywords: "imagem foto figura", run: () => imageInput.current?.click() },
    { label: "PDF", keywords: "pdf arquivo anexo", run: () => pdfInput.current?.click() },
  ];
  const filtered = (q: string) => {
    const t = q.trim().toLowerCase();
    return t ? allItems.filter((i) => (i.label + " " + i.keywords).toLowerCase().includes(t)) : allItems;
  };
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  function checkSlash(e: TipEditor) {
    const { selection } = e.state;
    const { $from } = selection;
    const text = $from.parent.textContent;
    const ok =
      selection.empty &&
      $from.parent.type.name === "paragraph" &&
      text.startsWith("/") &&
      text.length <= 24 &&
      $from.parentOffset === text.length;
    if (!ok || filteredRef.current(text.slice(1)).length === 0) return setSlash(null);
    const c = e.view.coordsAtPos($from.pos);
    const room = window.innerHeight - c.bottom;
    const top = room > 250 ? c.bottom + 6 : Math.max(8, c.top - 6 - 240);
    const left = Math.max(8, Math.min(c.left, window.innerWidth - 270));
    setSlash((prev) => {
      if (!prev || prev.query !== text.slice(1)) setSlashIndex(0);
      return { query: text.slice(1), top, left };
    });
  }

  function pickSlash(item: Cmd) {
    const e = editorRef.current;
    if (!e) return;
    const { $from } = e.state.selection;
    e.chain().focus().deleteRange({ from: $from.start(), to: $from.pos }).run();
    setSlash(null);
    item.run(e);
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage,
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? "Título" : "Escreva aqui ou digite / para inserir blocos…"),
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      Toggle,
      FileCard,
      TrailingNode,
    ],
    content: initial,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getJSON());
      checkSlash(editor);
    },
    onSelectionUpdate: ({ editor }) => checkSlash(editor),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      setSheet(null);
      setSlash(null);
    },
    editorProps: {
      attributes: { spellcheck: "true", "aria-label": "Página" },
      handleKeyDown: (_view, ev) => {
        const s = slashRef.current;
        if (!s) return false;
        const list = filteredRef.current(s.query);
        if (ev.key === "ArrowDown") { setSlashIndex((indexRef.current + 1) % list.length); return true; }
        if (ev.key === "ArrowUp") { setSlashIndex((indexRef.current - 1 + list.length) % list.length); return true; }
        if (ev.key === "Escape") { setSlash(null); return true; }
        if (ev.key === "Enter") {
          const item = list[Math.min(indexRef.current, list.length - 1)];
          if (item) { pickSlash(item); return true; }
        }
        return false;
      },
    },
  });

  // Mantém a barra de baixo colada no teclado (também no iPhone).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () =>
      document.documentElement.style.setProperty(
        "--kb",
        `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`
      );
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
    };
  }, []);

  async function send(file: File | undefined, kind: "image" | "pdf") {
    if (!file || !editor) return;
    setMessage("Enviando arquivo…");
    try {
      const url = await uploadFile(file);
      if (kind === "image") editor.chain().focus().setImage({ src: url }).run();
      else editor.chain().focus().insertContent({ type: "fileCard", attrs: { url, name: file.name } }).run();
      setMessage(null);
    } catch {
      setMessage("Não foi possível enviar o arquivo. Confira se rodou o schema2.sql no Supabase.");
    }
  }

  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const keep = (e: React.MouseEvent) => e.preventDefault();

  const chip = (label: string, run: () => void, active = false, aria?: string) => (
    <button type="button" key={label} aria-label={aria ?? label} className={active ? "chip on" : "chip"} onClick={run}>
      {label}
    </button>
  );
  const items = slash ? filtered(slash.query) : [];

  return (
    <div className="editor">
      {message && <p className="notice">{message}</p>}

      <BubbleMenu editor={editor} tippyOptions={{ duration: 100, placement: "top" }}>
        <div className="bubble" onMouseDown={keep}>
          <button type="button" aria-label="Negrito" className={editor.isActive("bold") ? "on" : ""} onClick={() => chain().toggleBold().run()}><b>B</b></button>
          <button type="button" aria-label="Itálico" className={editor.isActive("italic") ? "on" : ""} onClick={() => chain().toggleItalic().run()}><i>I</i></button>
          <button type="button" aria-label="Sublinhado" className={editor.isActive("underline") ? "on" : ""} onClick={() => chain().toggleUnderline().run()}><u>U</u></button>
          <button type="button" aria-label="Tachado" className={editor.isActive("strike") ? "on" : ""} onClick={() => chain().toggleStrike().run()}><s>S</s></button>
          <button type="button" aria-label="Marca-texto amarelo" className={editor.isActive("highlight") ? "on" : ""} onClick={() => chain().toggleHighlight({ color: MARKERS[0].v }).run()}>▮</button>
          <button type="button" aria-label="Mais opções de texto" onClick={() => setSheet(sheet === "format" ? null : "format")}>Aa</button>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />

      {slash && items.length > 0 && (
        <div className="slash" style={{ top: slash.top, left: slash.left }} onMouseDown={keep} role="listbox" aria-label="Inserir bloco">
          {items.map((it, i) => (
            <button
              type="button"
              key={it.label}
              role="option"
              aria-selected={i === slashIndex}
              className={i === slashIndex ? "slash-item on" : "slash-item"}
              onClick={() => pickSlash(it)}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}

      {(focused || sheet) && (
        <>
          {sheet === "insert" && (
            <div className="sheet" onMouseDown={keep}>
              <div className="sheet-grid">
                {allItems.map((it) => (
                  <button type="button" key={it.label} className="chip" onClick={() => { it.run(editor); setSheet(null); }}>
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sheet === "format" && (
            <div className="sheet" onMouseDown={keep}>
              <div className="sheet-row">
                {chip("B", () => chain().toggleBold().run(), editor.isActive("bold"), "Negrito")}
                {chip("I", () => chain().toggleItalic().run(), editor.isActive("italic"), "Itálico")}
                {chip("U", () => chain().toggleUnderline().run(), editor.isActive("underline"), "Sublinhado")}
                {chip("S", () => chain().toggleStrike().run(), editor.isActive("strike"), "Tachado")}
                {chip("<>", () => chain().toggleCode().run(), editor.isActive("code"), "Código em linha")}
              </div>
              <div className="sheet-row">
                {chip("H1", () => chain().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }), "Título 1")}
                {chip("H2", () => chain().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }), "Título 2")}
                {chip("H3", () => chain().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }), "Título 3")}
                {chip("Citação", () => chain().toggleBlockquote().run(), editor.isActive("blockquote"))}
                {chip("Código", () => chain().toggleCodeBlock().run(), editor.isActive("codeBlock"), "Bloco de código")}
              </div>
              <div className="sheet-row">
                {chip("Esquerda", () => chain().setTextAlign("left").run(), editor.isActive({ textAlign: "left" }))}
                {chip("Centro", () => chain().setTextAlign("center").run(), editor.isActive({ textAlign: "center" }))}
                {chip("Direita", () => chain().setTextAlign("right").run(), editor.isActive({ textAlign: "right" }))}
                {chip("Justificado", () => chain().setTextAlign("justify").run(), editor.isActive({ textAlign: "justify" }))}
              </div>
              <div className="sheet-row">
                {SIZES.map((s) =>
                  chip(s.name, () => (s.v ? chain().setFontSize(s.v).run() : chain().unsetFontSize().run()), s.v ? editor.isActive("textStyle", { fontSize: s.v }) : false, `Tamanho ${s.name}`)
                )}
              </div>
              <p className="sheet-label">Cor do texto</p>
              <div className="sheet-row">
                {TEXT_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    aria-label={`Cor ${c.name}`}
                    className="swatch"
                    style={{ background: c.v ?? "var(--ink)" }}
                    onClick={() => (c.v ? chain().setColor(c.v).run() : chain().unsetColor().run())}
                  />
                ))}
              </div>
              <p className="sheet-label">Marca-texto</p>
              <div className="sheet-row">
                {MARKERS.map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    aria-label={`Marca-texto ${c.name}`}
                    className="swatch"
                    style={{ background: c.v }}
                    onClick={() => chain().setHighlight({ color: c.v }).run()}
                  />
                ))}
                {chip("Tirar", () => chain().unsetHighlight().run(), false, "Tirar marca-texto")}
              </div>
              {editor.isActive("table") && (
                <>
                  <p className="sheet-label">Tabela</p>
                  <div className="sheet-row">
                    {chip("+ Linha", () => chain().addRowAfter().run())}
                    {chip("+ Coluna", () => chain().addColumnAfter().run())}
                    {chip("− Linha", () => chain().deleteRow().run())}
                    {chip("− Coluna", () => chain().deleteColumn().run())}
                    {chip("Apagar tabela", () => chain().deleteTable().run())}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="dock" onMouseDown={keep} role="toolbar" aria-label="Ferramentas de escrita">
            <button type="button" aria-label="Inserir bloco" className={sheet === "insert" ? "on" : ""} onClick={() => setSheet(sheet === "insert" ? null : "insert")}>＋</button>
            <button type="button" aria-label="Formatação do texto" className={sheet === "format" ? "on" : ""} onClick={() => setSheet(sheet === "format" ? null : "format")}>Aa</button>
            <button type="button" aria-label="Negrito" className={editor.isActive("bold") ? "on" : ""} onClick={() => chain().toggleBold().run()}><b>B</b></button>
            <button type="button" aria-label="Itálico" className={editor.isActive("italic") ? "on" : ""} onClick={() => chain().toggleItalic().run()}><i>I</i></button>
            <button type="button" aria-label="Marca-texto" className={editor.isActive("highlight") ? "on" : ""} onClick={() => chain().toggleHighlight({ color: MARKERS[0].v }).run()}>▮</button>
            <button type="button" aria-label="Lista com marcadores" className={editor.isActive("bulletList") ? "on" : ""} onClick={() => chain().toggleBulletList().run()}>•</button>
            <button type="button" aria-label="Lista de tarefas" className={editor.isActive("taskList") ? "on" : ""} onClick={() => chain().toggleTaskList().run()}>☑</button>
            <button type="button" aria-label="Inserir imagem" onClick={() => imageInput.current?.click()}>Img</button>
            <button type="button" aria-label="Desfazer" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>↶</button>
            <button type="button" aria-label="Refazer" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>↷</button>
            <button type="button" aria-label="Fechar teclado" onClick={() => editor.commands.blur()}>⌄</button>
          </div>
        </>
      )}

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { send(e.target.files?.[0], "image"); e.target.value = ""; }} />
      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { send(e.target.files?.[0], "pdf"); e.target.value = ""; }} />
    </div>
  );
}
