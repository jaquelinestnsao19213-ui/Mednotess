"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { uploadFile } from "@/lib/upload";

// Cartão de arquivo (PDF anexado): abre em outra aba ao tocar.
const FileCard = Node.create({
  name: "fileCard",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      url: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("href") ?? "" },
      name: { default: "arquivo", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "arquivo" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-file-card]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: node.attrs.url,
        target: "_blank",
        rel: "noopener",
        class: "file-card",
        "data-file-card": "",
        "data-name": node.attrs.name,
      }),
      `📄 ${node.attrs.name}`,
    ];
  },
});

export default function Editor({
  initial,
  onChange,
}: {
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: "Escreva aqui as suas anotações…" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      FileCard,
    ],
    content: initial,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

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
  const c = () => editor.chain().focus();
  const btn = (label: string, run: () => void, active = false) => (
    <button type="button" className={active ? "tb on" : "tb"} onClick={run}>{label}</button>
  );

  return (
    <div className="editor">
      <div className="toolbar" role="toolbar" aria-label="Formatação">
        {btn("Título", () => c().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {btn("Subtítulo", () => c().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
        {btn("Negrito", () => c().toggleBold().run(), editor.isActive("bold"))}
        {btn("Itálico", () => c().toggleItalic().run(), editor.isActive("italic"))}
        {btn("Lista", () => c().toggleBulletList().run(), editor.isActive("bulletList"))}
        {btn("Checklist", () => c().toggleTaskList().run(), editor.isActive("taskList"))}
        {btn("Tabela", () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {editor.isActive("table") && btn("+ Linha", () => c().addRowAfter().run())}
        {editor.isActive("table") && btn("+ Coluna", () => c().addColumnAfter().run())}
        {editor.isActive("table") && btn("Apagar tabela", () => c().deleteTable().run())}
        {btn("Imagem", () => imageInput.current?.click())}
        {btn("PDF", () => pdfInput.current?.click())}
      </div>
      {message && <p className="notice">{message}</p>}
      <EditorContent editor={editor} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { send(e.target.files?.[0], "image"); e.target.value = ""; }} />
      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { send(e.target.files?.[0], "pdf"); e.target.value = ""; }} />
    </div>
  );
}
