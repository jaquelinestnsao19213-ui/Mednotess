"use client";

import { useEffect, useRef, useState } from "react";
import type { Note } from "./types";

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "H4", "MARK", "SPAN", "UL", "OL", "LI", "BR", "DIV", "P"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"]);

// Mantém só a formatação simples do comentário (negrito, título, marca-texto, lista).
function clean(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (parent: Node) => {
    Array.from(parent.childNodes).forEach((n) => {
      if (n.nodeType === 3) return;
      if (n.nodeType !== 1) {
        parent.removeChild(n);
        return;
      }
      const el = n as HTMLElement;
      if (DROP.has(el.tagName)) {
        parent.removeChild(el);
        return;
      }
      walk(el);
      if (!ALLOWED.has(el.tagName)) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      const bg = el.style.backgroundColor;
      Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name));
      if (bg) el.style.backgroundColor = bg;
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  note: Note;
  onPatch: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onClose: () => void;
};

// Comentário do PDF: editor com negrito, título, marca-texto e lista; tamanho da letra e da caixa ajustáveis.
export default function NoteCard({ note, onPatch, onDelete, onClose }: Props) {
  const ed = useRef<HTMLDivElement>(null);
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const [size, setSize] = useState({ w: note.w ?? 300, h: note.h ?? 150 });
  const fs = note.fs ?? 14;

  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    el.innerHTML = note.html != null ? clean(note.html) : textToHtml(note.text);
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const el = ed.current;
    if (!el) return;
    patchRef.current({ html: el.innerHTML, text: el.innerText });
  }

  function cmd(name: string, value?: string) {
    ed.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
    sync();
  }

  function toggleTitle() {
    const now = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    cmd("formatBlock", now === "h4" ? "div" : "h4");
  }

  function toggleMark() {
    const v = String(document.queryCommandValue("hiliteColor") || "");
    const on = v !== "" && v !== "transparent" && v !== "rgba(0, 0, 0, 0)";
    cmd("hiliteColor", on ? "transparent" : "#fde68a");
  }

  function startResize(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = size.w;
    const h0 = size.h;
    let last = { w: w0, h: h0 };
    const move = (ev: PointerEvent) => {
      last = { w: clamp(Math.round(w0 + ev.clientX - sx), 220, 900), h: clamp(Math.round(h0 + ev.clientY - sy), 90, 700) };
      setSize(last);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      patchRef.current({ w: last.w, h: last.h });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  function toggleBig() {
    const next = size.w >= 520 ? { w: 300, h: 150 } : { w: 560, h: 320 };
    setSize(next);
    patchRef.current(next);
  }

  function setFont(delta: number) {
    patchRef.current({ fs: clamp(fs + delta, 11, 28) });
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      className="pdfnote-card"
      style={{
        width: `min(${size.w}px, 100%)`,
        top: `calc(${note.y * 100}% + 8px)`,
        left: `max(0px, min(${note.x * 100}%, calc(100% - ${size.w}px)))`,
      }}
    >
      <div className="pdfnote-tools" role="toolbar" aria-label="Formatar comentário">
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("bold")} aria-label="Negrito"><b>B</b></button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("italic")} aria-label="Itálico"><i>I</i></button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={toggleTitle} aria-label="Título">Título</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={toggleMark} aria-label="Marca-texto">🖍</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("insertUnorderedList")} aria-label="Lista">• Lista</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => setFont(-2)} aria-label="Diminuir letra">A−</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => setFont(2)} aria-label="Aumentar letra">A+</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={toggleBig} aria-label="Expandir ou recolher comentário">⤢</button>
      </div>
      <div
        ref={ed}
        className="pdfnote-edit"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Comentário"
        data-placeholder="Escreva seu comentário…"
        style={{ height: size.h, fontSize: fs }}
        onInput={sync}
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => {
          e.preventDefault();
          const t = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, t);
          sync();
        }}
      />
      <div className="pdfnote-actions">
        <button type="button" className="pdfnb-btn" onClick={onDelete}>Excluir</button>
        <button type="button" className="pdfnb-btn on" onClick={onClose}>Pronto</button>
      </div>
      <span className="pdfnote-grip" onPointerDown={startResize} role="separator" aria-label="Arraste para redimensionar o comentário" />
    </div>
  );
}
