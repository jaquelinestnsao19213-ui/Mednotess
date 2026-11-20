"use client";

import { useEffect, useRef, useState } from "react";
import type { Note, NoteClip } from "./types";
import { extFromFile, mediaErrorMessage, uploadMedia } from "@/lib/media";
import { looksLikeMarkdown, markdownToHtml } from "@/lib/markdown-paste";

const ALLOWED = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "H1", "H2", "H3", "H4", "H5", "H6", "MARK", "SPAN",
  "UL", "OL", "LI", "BR", "DIV", "P", "BLOCKQUOTE", "CODE", "PRE", "A", "IMG", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TITLE", "META", "LINK", "NOSCRIPT", "SVG", "CANVAS",
  "BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM", "VIDEO", "AUDIO",
]);
const KEEP_ATTRS: Record<string, string[]> = { A: ["href"], IMG: ["src", "alt"], TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan"] };

// Só mantém marca-texto de cor clara (cópias de sites escuros trazem fundo escuro que some o texto).
function lightBackground(css: string): string {
  const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return "";
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a < 0.1) return "";
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 && !(r > 245 && g > 245 && b > 245) ? css : "";
}

// Mantém a cor da letra vinda da colagem, exceto branco/transparente/muito claro (somem no fundo do comentário).
function safeTextColor(css: string): string {
  const v = (css || "").trim();
  if (!v) return "";
  if (/^(white|transparent|inherit|initial|unset|currentcolor)$/i.test(v)) return "";
  const m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a < 0.1) return "";
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.88 ? "" : v;
  }
  return /^(#[0-9a-f]{3,8}|hsla?\([^)]*\)|[a-z]{3,20})$/i.test(v) ? v : "";
}

// Mantém a formatação do texto (título, negrito, listas, tabelas, links, imagens, marca-texto, cor, tamanho, alinhamento) e tira o resto.
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
      const bg = lightBackground(el.style.backgroundColor);
      const textColor = safeTextColor(el.style.color);
      const fontSize = el.style.fontSize;
      const textAlign = el.style.textAlign;
      // Os botões B / I / U / S gravam a formatação como estilo (span); guarda esses estilos para não sumirem ao reabrir.
      const fw = el.style.fontWeight;
      const bold = fw === "bold" || fw === "bolder" || Number(fw) >= 600;
      const italic = el.style.fontStyle === "italic";
      const deco = el.style.textDecorationLine || el.style.textDecoration || "";
      const under = deco.includes("underline");
      const strike = deco.includes("line-through");
      const keep: Record<string, string> = {};
      for (const a of KEEP_ATTRS[el.tagName] ?? []) {
        const v = el.getAttribute(a);
        if (v) keep[a] = v;
      }
      Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name));
      if (el.tagName === "A") {
        if (/^(https?:|mailto:)/i.test(keep.href ?? "")) {
          el.setAttribute("href", keep.href);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        } else {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          return;
        }
        return;
      }
      if (el.tagName === "IMG") {
        if (/^(https?:\/\/|data:image\/)/i.test(keep.src ?? "")) {
          el.setAttribute("src", keep.src);
          if (keep.alt) el.setAttribute("alt", keep.alt);
          el.style.maxWidth = "100%";
        } else {
          parent.removeChild(el);
        }
        return;
      }
      for (const [k, v] of Object.entries(keep)) el.setAttribute(k, v);
      if (bg) el.style.backgroundColor = bg;
      if (textColor) el.style.color = textColor;
      if (/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(fontSize)) el.style.fontSize = fontSize;
      if (["left", "center", "right", "justify"].includes(textAlign)) el.style.textAlign = textAlign;
      if (bold) el.style.fontWeight = "bold";
      if (italic) el.style.fontStyle = "italic";
      if (under || strike) el.style.textDecoration = [under ? "underline" : "", strike ? "line-through" : ""].filter(Boolean).join(" ");
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
  onCopy: (clip: NoteClip) => void; // guarda o comentário para colar em outro lugar do PDF
  onDuplicate: () => void; // cria uma cópia ao lado
};

// Comentário do PDF: editor com negrito, título, marca-texto e lista; tamanho da letra e da caixa ajustáveis.
export default function NoteCard({ note, onPatch, onDelete, onClose, onCopy, onDuplicate }: Props) {
  const ed = useRef<HTMLDivElement>(null);
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const [size, setSize] = useState({ w: note.w ?? 300, h: note.h ?? 150 });
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
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
    // Comentário só com imagem não pode ser tratado como vazio (comentário vazio é apagado ao fechar).
    const text = el.innerText.trim() === "" && el.querySelector("img") ? "[imagem]" : el.innerText;
    patchRef.current({ html: el.innerHTML, text });
  }

  function cmd(name: string, value?: string) {
    ed.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
    sync();
  }

  function insertHtml(html: string) {
    ed.current?.focus();
    document.execCommand("insertHTML", false, html);
    sync();
    void rehostImages();
  }

  // Imagens coladas que vêm embutidas (data:) são enviadas ao Storage para o comentário não ficar pesado.
  async function rehostImages() {
    const el = ed.current;
    if (!el) return;
    const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img[src^="data:"]'));
    for (const img of imgs) {
      try {
        const blob = await (await fetch(img.src)).blob();
        img.src = await uploadMedia(blob, extFromFile({ type: blob.type }));
        sync();
      } catch {
        // mantém a imagem embutida se o envio falhar
      }
    }
  }

  async function insertImages(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setStatus("Enviando imagem…");
    try {
      const urls: string[] = [];
      for (const f of imgs) urls.push(await uploadMedia(f, extFromFile(f)));
      const el = ed.current;
      if (el) {
        el.focus();
        const sel = window.getSelection();
        if (savedRange.current) {
          sel?.removeAllRanges();
          sel?.addRange(savedRange.current);
        }
      }
      insertHtml(urls.map((u) => `<img src="${u}" style="max-width:100%">`).join("<br>"));
      setStatus(null);
    } catch (cause) {
      setStatus(mediaErrorMessage(cause));
    }
  }

  function pickImage() {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount && ed.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    fileInput.current?.click();
  }

  function addLink() {
    const url = window.prompt("Endereço do link (https://…)");
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url.trim())) return;
    cmd("createLink", url.trim());
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

  // Copia o comentário inteiro (com formatação) para a área de transferência e guarda para "Colar comentário" em outro ponto do PDF.
  async function copyAll() {
    const el = ed.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = el.innerText;
    onCopy({
      text: el.innerText.trim() === "" && el.querySelector("img") ? "[imagem]" : text,
      html,
      color: note.color,
      w: size.w,
      h: size.h,
      fs,
    });
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("sem suporte");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      // Plano B: seleciona o conteúdo e usa o comando de copiar do navegador.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      try {
        document.execCommand("copy");
      } catch {
        /* ignora */
      }
    }
    setStatus("Comentário copiado. Use \"Colar comentário\" na barra para colocar em outro ponto.");
    window.setTimeout(() => setStatus(null), 3200);
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
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("underline")} aria-label="Sublinhado"><u>U</u></button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("strikeThrough")} aria-label="Tachado"><s>S</s></button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={toggleTitle} aria-label="Título">Título</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={toggleMark} aria-label="Marca-texto">🖍</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("insertUnorderedList")} aria-label="Lista">• Lista</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("insertOrderedList")} aria-label="Lista numerada">1. Lista</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={addLink} aria-label="Link">🔗</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={pickImage} aria-label="Inserir imagem">🖼</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => cmd("removeFormat")} aria-label="Limpar formatação">Tx</button>
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
        onBlur={sync}
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => {
          e.preventDefault();
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (files.length) {
            const sel = window.getSelection();
            savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
            void insertImages(files);
            return;
          }
          const html = e.clipboardData.getData("text/html");
          const plain = e.clipboardData.getData("text/plain") ?? "";
          const cleaned = html.trim() ? clean(html) : "";

          const probe = document.createElement("div");
          probe.innerHTML = cleaned;
          const hasRichStructure = !!probe.querySelector(
            "h1,h2,h3,h4,h5,h6,strong,b,em,i,u,s,ul,ol,li,table,blockquote,pre,code,a,img,hr"
          );

          // Recupera a formatação Markdown quando o HTML recebido pelo navegador vem achatado (comum ao copiar do ChatGPT/Claude).
          if (looksLikeMarkdown(plain) && (!cleaned || !hasRichStructure)) {
            insertHtml(clean(markdownToHtml(plain)));
          } else if (cleaned.replace(/<[^>]*>/g, "").trim() || /<img/i.test(cleaned)) {
            insertHtml(cleaned);
          } else {
            document.execCommand("insertText", false, plain);
            sync();
          }
        }}
      />
      {status && <p style={{ margin: "4px 0", fontSize: 13, color: "var(--muted)" }}>{status}</p>}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void insertImages(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <style>{`
        .pdfnote-edit h1, .pdfnote-edit h2, .pdfnote-edit h3, .pdfnote-edit h5, .pdfnote-edit h6 { margin: 6px 0 4px; font-size: 1.2em; font-weight: 700; }
        .pdfnote-edit p { margin: 0 0 6px; }
        .pdfnote-edit img { max-width: 100%; height: auto; display: block; margin: 4px 0; border-radius: 6px; }
        .pdfnote-edit blockquote { margin: 6px 0; padding-left: 10px; border-left: 3px solid var(--line, #d5dbe3); color: var(--muted, #5b6675); }
        .pdfnote-edit code { font-family: ui-monospace, monospace; font-size: 0.92em; background: rgba(120,120,120,.15); padding: 0 4px; border-radius: 4px; }
        .pdfnote-edit pre { margin: 6px 0; padding: 8px; overflow-x: auto; background: rgba(120,120,120,.12); border-radius: 6px; }
        .pdfnote-edit pre code { background: none; padding: 0; }
        .pdfnote-edit a { color: var(--accent, #0f766e); text-decoration: underline; }
        .pdfnote-edit table { border-collapse: collapse; margin: 6px 0; display: block; overflow-x: auto; max-width: 100%; }
        .pdfnote-edit th, .pdfnote-edit td { border: 1px solid var(--line, #d5dbe3); padding: 4px 8px; text-align: left; vertical-align: top; }
        .pdfnote-edit th { font-weight: 700; background: rgba(120,120,120,.1); }
        .pdfnote-edit hr { border: 0; border-top: 1px solid var(--line, #d5dbe3); margin: 8px 0; }
      `}</style>
      <div className="pdfnote-actions">
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={() => void copyAll()}>Copiar</button>
        <button type="button" className="pdfnb-btn" onMouseDown={keep} onClick={onDuplicate}>Duplicar</button>
        <button type="button" className="pdfnb-btn" onClick={onDelete}>Excluir</button>
        <button
          type="button"
          className="pdfnb-btn on"
          onClick={() => {
            sync();
            onClose();
          }}
        >
          Pronto
        </button>
      </div>
      <span className="pdfnote-grip" onPointerDown={startResize} role="separator" aria-label="Arraste para redimensionar o comentário" />
    </div>
  );
}
