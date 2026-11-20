"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Callout, FileCard, FontSize, ResizableImage, Toggle, WebEmbed } from "./editor/extensions";
import { FontFamily, StyledTableCell, StyledTableHeader } from "./editor/format-extensions";
import { AudioNote, VideoNote } from "./editor/media-extensions";
import { InkBlock } from "./editor/ink-extension";
import InkOverlay, { readInkLayer } from "./editor/InkOverlay";
import { toDoc } from "@/lib/doc";

export type SharedPage = {
  id: string;
  type: string;
  title: string;
  icon: string | null;
  cover_url: string | null;
  props: { date?: string; discipline?: string; room?: string } | null;
  content: unknown;
};

// Página publicada: mesmo visual da página original, mas somente leitura (sem barra de edição).
export default function SharedPageView({ page }: { page: SharedPage }) {
  const doc = toDoc(page.content);
  const layer = readInkLayer(doc.inkLayer);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage,
      Table.configure({ resizable: false }),
      TableRow,
      StyledTableHeader,
      StyledTableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      Toggle,
      FileCard,
      WebEmbed,
      AudioNote,
      VideoNote,
      InkBlock,
    ],
    content: doc,
    editorProps: { attributes: { "aria-label": "Página compartilhada (somente leitura)" } },
  });

  const props = page.props ?? {};
  const isLesson = page.type === "lesson";

  return (
    <>
      <p className="muted small" style={{ margin: "0 0 8px" }}>Página compartilhada · somente leitura</p>

      {page.cover_url && <div className="cover" style={{ backgroundImage: `url(${page.cover_url})` }} />}

      <div className="titlebar">
        {page.icon && <span className="icon-btn" aria-hidden="true">{page.icon}</span>}
        <h1 className="display" style={{ margin: 0 }}>{page.title || "Sem título"}</h1>
      </div>

      {isLesson && (props.date || props.discipline || props.room) && (
        <p className="muted">
          {[props.date ? new Date(`${props.date}T12:00:00`).toLocaleDateString("pt-BR") : "", props.discipline, props.room].filter(Boolean).join(" · ")}
        </p>
      )}

      {editor && (
        <div className="editor">
          <div style={{ position: "relative" }}>
            <EditorContent editor={editor} />
            <InkOverlay layer={layer} onChange={() => {}} active={false} onClose={() => {}} />
          </div>
        </div>
      )}
    </>
  );
}
