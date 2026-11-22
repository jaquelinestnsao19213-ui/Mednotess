"use client";

import { useMemo } from "react";
import type { Note, NoteClip } from "./types";

// Comentário da dona do caderno visto por um visitante do link publicado: só leitura (dá para copiar).

const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "CANVAS", "VIDEO", "AUDIO",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function safeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("*").forEach((el) => {
    if (DROP.has(el.tagName.toUpperCase())) {
      el.remove();
      return;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName.toUpperCase() === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return tpl.innerHTML;
}

type Props = {
  note: Note;
  onClose: () => void;
  onCopy: (clip: NoteClip) => void;
};

export default function ReadOnlyNote({ note, onClose, onCopy }: Props) {
  const w = note.w ?? 300;
  const h = note.h ?? 150;
  const fs = note.fs ?? 14;
  const html = useMemo(() => (note.html != null ? safeHtml(note.html) : escapeHtml(note.text)), [note.html, note.text]);

  async function copy() {
    onCopy({ text: note.text, html, color: note.color, w, h, fs });
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("sem suporte");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([note.text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      /* o comentário continua guardado para "Colar comentário" */
    }
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      className="pdfnote-card"
      style={{
        width: `min(${w}px, 100%)`,
        top: `calc(${note.y * 100}% + 8px)`,
        left: `max(0px, min(${note.x * 100}%, calc(100% - ${w}px)))`,
      }}
    >
      <p className="pdfnote-ro-label">Comentário do caderno (somente leitura)</p>
      <div className="pdfnote-ro-body" style={{ maxHeight: Math.max(h, 120), fontSize: fs }} dangerouslySetInnerHTML={{ __html: html }} />
      <div className="pdfnote-actions">
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => void copy()}>Copiar</button>
        <button type="button" className="pdfnb-btn on" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
