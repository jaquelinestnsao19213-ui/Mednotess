"use client";

import { useEffect, useRef, useState } from "react";
import { cleanNoteHtml, noteIsEmpty, noteToHtml } from "@/lib/pdf-note-html";

// Comentário do PDF: editor com formatação (título, negrito, itálico, marca-texto, lista) e tamanho livre.
// O tamanho escolhido fica guardado neste aparelho, por comentário.

type Size = { w: number; h: number };
const DEFAULT_SIZE: Size = { w: 340, h: 240 };
const MIN: Size = { w: 220, h: 150 };
const MAX: Size = { w: 900, h: 800 };
const HIGHLIGHT = "#fde68a";

const sizeKey = (id: string) => `mednotes:pdfnote-size:${id}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readSize(id: string): Size {
  try {
    const raw = localStorage.getItem(sizeKey(id));
    if (raw) {
      const v = JSON.parse(raw) as Partial<Size>;
      return { w: clamp(Number(v.w) || DEFAULT_SIZE.w, MIN.w, MAX.w), h: clamp(Number(v.h) || DEFAULT_SIZE.h, MIN.h, MAX.h) };
    }
  } catch {
    /* ignora */
  }
  return DEFAULT_SIZE;
}

function saveSize(id: string, size: Size) {
  try {
    localStorage.setItem(sizeKey(id), JSON.stringify(size));
  } catch {
    /* ignora */
  }
}

export default function NotePopup({
  id,
  text,
  style,
  anchorRight,
  onText,
  onDelete,
  onDone,
}: {
  id: string;
  text: string;
  style: React.CSSProperties;
  anchorRight: boolean;
  onText: (text: string) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const ed = useRef<HTMLDivElement>(null);
  const sent = useRef(text);
  const [size, setSize] = useState<Size>(() => readSize(id));
  const latest = useRef(size);
  latest.current = size;
  const [restore, setRestore] = useState<Size | null>(null);

  // Conteúdo inicial (uma vez): o editor não é recriado a cada letra, para o cursor não pular.
  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    el.innerHTML = noteToHtml(text);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit() {
    const el = ed.current;
    if (!el) return;
    const clean = cleanNoteHtml(el.innerHTML);
    const next = noteIsEmpty(clean) ? "" : clean;
    if (next === sent.current) return;
    sent.current = next;
    onText(next);
  }

  function run(command: string, value?: string) {
    ed.current?.focus();
    document.execCommand(command, false, value);
    commit();
  }

  function toggleTitle() {
    const current = String(document.queryCommandValue("formatBlock")).replace(/[<>]/g, "").toLowerCase();
    run("formatBlock", current === "h4" ? "<div>" : "<h4>");
  }

  function toggleMark() {
    const current = String(document.queryCommandValue("hiliteColor"));
    run("hiliteColor", /253,\s*230,\s*138|#fde68a/i.test(current) ? "transparent" : HIGHLIGHT);
  }

  function startResize(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = latest.current.w;
    const h0 = latest.current.h;
    const dir = anchorRight ? -1 : 1; // preso à direita, o comentário cresce para a esquerda
    const move = (ev: PointerEvent) => {
      setSize({ w: clamp(w0 + dir * (ev.clientX - sx), MIN.w, MAX.w), h: clamp(h0 + (ev.clientY - sy), MIN.h, MAX.h) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      saveSize(id, latest.current);
      setRestore(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function toggleExpand() {
    if (restore) {
      setSize(restore);
      saveSize(id, restore);
      setRestore(null);
      return;
    }
    setRestore(latest.current);
    const big = { w: clamp(window.innerWidth - 32, MIN.w, 760), h: clamp(Math.round(window.innerHeight * 0.6), MIN.h, 560) };
    setSize(big);
    saveSize(id, big);
  }

  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault(); // não tira a seleção do texto

  return (
    <div className="pdfnote-pop pdfnote-rich" style={{ ...style, width: size.w, height: size.h }}>
      <div className="pdfnote-tools" role="toolbar" aria-label="Formatação do comentário">
        <button type="button" className="pdfnote-tool t-title" aria-label="Título em negrito" onPointerDown={keep} onMouseDown={keep} onClick={toggleTitle}>Título</button>
        <button type="button" className="pdfnote-tool t-bold" aria-label="Negrito" onPointerDown={keep} onMouseDown={keep} onClick={() => run("bold")}>B</button>
        <button type="button" className="pdfnote-tool t-italic" aria-label="Itálico" onPointerDown={keep} onMouseDown={keep} onClick={() => run("italic")}>I</button>
        <button type="button" className="pdfnote-tool t-mark" aria-label="Marca-texto" onPointerDown={keep} onMouseDown={keep} onClick={toggleMark}>Marca</button>
        <button type="button" className="pdfnote-tool" aria-label="Lista com marcadores" onPointerDown={keep} onMouseDown={keep} onClick={() => run("insertUnorderedList")}>•</button>
        <button type="button" className="pdfnote-tool" aria-label="Limpar formatação" onPointerDown={keep} onMouseDown={keep} onClick={() => run("removeFormat")}>Tx</button>
        <span className="pdfnote-tool-spacer" />
        <button type="button" className="pdfnote-tool" aria-label={restore ? "Reduzir comentário" : "Ampliar comentário"} title={restore ? "Voltar ao tamanho anterior" : "Ampliar"} onClick={toggleExpand}>{restore ? "⤡" : "⤢"}</button>
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
        onInput={commit}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation(); // Ctrl+Z aqui desfaz o texto, não o desenho do PDF
          if (e.key === "Escape") onDone();
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />
      <div className="pdfnote-actions">
        <button type="button" className="pdfnb-btn" onClick={onDelete}>Excluir</button>
        <button type="button" className="pdfnb-btn on" onClick={onDone}>Pronto</button>
      </div>
      <span
        className={anchorRight ? "pdfnote-grip left" : "pdfnote-grip"}
        role="separator"
        aria-label="Arrastar para mudar o tamanho do comentário"
        onPointerDown={startResize}
      />
    </div>
  );
}
