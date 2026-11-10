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
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { Callout, FileCard, FontSize, ResizableImage, Toggle, TrailingNode, WebEmbed } from "./editor/extensions";
import { AudioNote, VideoNote } from "./editor/media-extensions";
import AudioRecorder, { type RecordingData } from "./editor/AudioRecorder";
import MediaIndex from "./editor/MediaIndex";
import { fileExtension, uploadFile } from "@/lib/upload";
import { extFromFile, mediaErrorMessage, mediaKindOf, parseVideoLink, uploadMedia } from "@/lib/media";
import { Slice } from "@tiptap/pm/model";
import { richClipboard } from "@/lib/copy-html";
import { exportEditorAsPdf } from "@/lib/export-pdf";

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
  { name: "1", v: "12px" },
  { name: "2", v: "14px" },
  { name: "3", v: "16px" },
  { name: "4", v: "18px" },
  { name: "5", v: "20px" },
  { name: "6", v: "24px" },
  { name: "7", v: "28px" },
  { name: "Padrão", v: null },
];

// Keep useful formatting from external editors while dropping unsafe content and noisy styles.
function cleanClipboardHTML(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, textarea, select, svg, math").forEach((el) => el.remove());

  const allowedStyles = new Set([
    "background-color",
    "color",
    "font-size",
    "font-style",
    "font-weight",
    "text-align",
    "text-decoration",
    "text-decoration-line",
  ]);
  const safeUrl = (value: string, image: boolean) => {
    try {
      const url = new URL(value, doc.baseURI);
      return (url.protocol === "http:" || url.protocol === "https:" || (!image && url.protocol === "mailto:"))
        ? url.href
        : "";
    } catch {
      return "";
    }
  };

  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "contenteditable") {
        el.removeAttribute(attr.name);
      } else if (name === "style") {
        const style = (el as HTMLElement).style;
        const kept: string[] = [];
        for (const property of Array.from(style)) {
          const value = style.getPropertyValue(property).trim();
          if (allowedStyles.has(property) && value && !/url\s*\(|expression\s*\(/i.test(value)) {
            kept.push(`${property}: ${value}`);
          }
        }
        if (kept.length) el.setAttribute("style", kept.join("; "));
        else el.removeAttribute("style");
      } else if (name === "href" || name === "src") {
        const url = safeUrl(attr.value, el.tagName.toLowerCase() === "img");
        if (url) el.setAttribute(name, url);
        else el.removeAttribute(name);
      }
    }
  });
  return doc;
}

export default function Editor({
  initial,
  onChange,
}: {
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [message, setMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState<null | "format" | "insert">(null);
  const [slash, setSlash] = useState<null | { query: string; top: number; left: number }>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [linkBox, setLinkBox] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recorder, setRecorder] = useState(false);
  const [videoLinkBox, setVideoLinkBox] = useState(false);
  const [videoLinkValue, setVideoLinkValue] = useState("");
  const [videoLinkError, setVideoLinkError] = useState<string | null>(null);

  const slashRef = useRef(slash);
  slashRef.current = slash;
  const indexRef = useRef(0);
  indexRef.current = slashIndex;
  const editorRef = useRef<TipEditor | null>(null);
  const imagesRef = useRef<(files: File[], pos?: number) => Promise<void>>(async () => {});
  const mediaRef = useRef<(files: File[], forced?: "audio" | "video") => Promise<void>>(async () => {});

  const allItems: Cmd[] = [
    ...BLOCKS,
    { label: "Imagem", keywords: "imagem foto figura", run: () => imageInput.current?.click() },
    { label: "Copiar página inteira", keywords: "copiar tudo pagina inteira google docs word formatacao", run: () => { void copyWholePage(); } },
    { label: "Colar imagem", keywords: "colar imagem foto copiar area transferencia print", run: () => { void pasteImageFromClipboard(); } },
    { label: "PDF", keywords: "pdf arquivo anexo", run: () => pdfInput.current?.click() },
    { label: "Site", keywords: "site link url pagina web incorporar embed", run: () => { setLinkValue(""); setLinkError(null); setLinkBox(true); } },
    { label: "Gravar áudio", keywords: "gravar audio microfone voz explicacao gravacao", run: () => setRecorder(true) },
    { label: "Áudio (arquivo)", keywords: "audio mp3 m4a som arquivo enviar upload", run: () => audioInput.current?.click() },
    { label: "Vídeo (arquivo)", keywords: "video mp4 arquivo enviar upload", run: () => videoInput.current?.click() },
    { label: "Vídeo (link)", keywords: "video youtube vimeo link aula", run: () => { setVideoLinkValue(""); setVideoLinkError(null); setVideoLinkBox(true); } },
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
      WebEmbed,
      AudioNote,
      VideoNote,
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
      handleDOMEvents: {
        // Ctrl+C / Copiar: leva o texto com a formatação embutida, para o Google Docs e outros apps respeitarem
        copy: (view, event) => {
          try {
            const sel = view.state.selection;
            if (sel.empty || !event.clipboardData) return false;
            const { html, text } = richClipboard(view, sel.content());
            event.clipboardData.setData("text/html", html);
            event.clipboardData.setData("text/plain", text);
            event.preventDefault();
            return true;
          } catch {
            return false; // se algo falhar, vale a cópia normal do editor
          }
        },
      },
      handlePaste: (view, event) => {
        // Imagem copiada (print, galeria, outro app): envia e insere, sem precisar baixar antes.
        const pasted = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (pasted.length && !event.clipboardData?.getData("text/plain")?.trim()) {
          event.preventDefault();
          void imagesRef.current(pasted);
          return true;
        }
        const html = event.clipboardData?.getData("text/html");
        if (!html) return false;

        const doc = cleanClipboardHTML(html);
        if (!doc.body.textContent?.trim() && !doc.body.querySelector("table, img, hr")) return false;

        // Parse as a slice so pasted paragraphs, lists, and tables fit the current selection naturally.
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(doc.body, { preserveWhitespace: true });
        if (slice.content.size === 0) return false;

        event.preventDefault();
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false; // arrastar blocos dentro da página continua normal
        const files = Array.from(event.dataTransfer?.files ?? []);
        // Áudio/vídeo solto na página (computador): envia e insere o player.
        const media = files.filter((f) => mediaKindOf(f) !== null);
        if (media.length) {
          event.preventDefault();
          void mediaRef.current(media);
          return true;
        }
        const dropped = files.filter((f) => f.type.startsWith("image/"));
        if (!dropped.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void imagesRef.current(dropped, at);
        return true;
      },
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

  async function insertImages(files: File[], pos?: number) {
    const e = editorRef.current;
    if (!e || !files.length) return;
    setMessage(files.length > 1 ? "Enviando imagens…" : "Enviando imagem…");
    try {
      let at = pos;
      for (const file of files) {
        const src = await uploadFile(file);
        const node = { type: "image", attrs: { src } };
        if (at === undefined) e.chain().focus().insertContent(node).run();
        else {
          e.chain().focus().insertContentAt(at, node).run();
          at = undefined; // as próximas entram logo depois, onde o cursor ficou
        }
      }
      setMessage(null);
    } catch {
      setMessage("Não foi possível enviar a imagem. Confira se rodou o schema2.sql no Supabase e se você está logada.");
    }
  }
  imagesRef.current = insertImages;

  // Envia áudios/vídeos escolhidos (ou soltos na página) e insere um player para cada um, na posição do cursor.
  async function insertMediaFiles(files: File[], forced?: "audio" | "video") {
    const e = editorRef.current;
    if (!e || !files.length) return;
    for (const file of files) {
      const kind = forced ?? mediaKindOf(file);
      if (!kind) {
        setMessage(`“${file.name}” não parece ser um áudio ou vídeo que o navegador consegue tocar.`);
        continue;
      }
      setMessage(kind === "audio" ? "Enviando áudio…" : "Enviando vídeo… arquivos grandes podem demorar um pouco.");
      try {
        const url = await uploadMedia(file, extFromFile(file));
        const title = file.name.replace(/\.[^.]+$/, "");
        if (kind === "audio") {
          e.chain().focus().insertContent({ type: "audioNote", attrs: { url, title, description: "", duration: 0, recorded: false } }).run();
        } else {
          e.chain().focus().insertContent({ type: "videoNote", attrs: { kind: "file", url, title, subject: "", description: "" } }).run();
        }
        setMessage(null);
      } catch (cause) {
        setMessage(mediaErrorMessage(cause));
        return;
      }
    }
  }
  mediaRef.current = insertMediaFiles;

  // Salva a gravação feita no app: envia ao Storage e insere o player na página.
  async function saveRecording(data: RecordingData) {
    const e = editorRef.current;
    if (!e) throw new Error("O editor não está pronto. Tente de novo.");
    let url: string;
    try {
      url = await uploadMedia(data.blob, data.ext);
    } catch (cause) {
      throw new Error(mediaErrorMessage(cause));
    }
    const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    e.chain()
      .focus()
      .insertContent({
        type: "audioNote",
        attrs: { url, title: data.title || `Gravação ${stamp}`, description: data.description, duration: data.duration, recorded: true },
      })
      .run();
    setRecorder(false);
  }

  function insertVideoLink() {
    const e = editorRef.current;
    if (!e) return;
    const parsed = parseVideoLink(videoLinkValue);
    if (!parsed) {
      setVideoLinkError("Use o link de um vídeo do YouTube, do Vimeo ou de um arquivo .mp4. Exemplo: https://youtu.be/…");
      return;
    }
    e.chain().focus().insertContent({ type: "videoNote", attrs: { kind: parsed.kind, url: parsed.url, title: "", subject: "", description: "" } }).run();
    setVideoLinkBox(false);
    setVideoLinkValue("");
    setVideoLinkError(null);
  }

  // Copia a página toda (texto, títulos, cores, listas, tabelas, avisos e imagens) pronta para colar em outro app.
  async function copyWholePage() {
    const e = editorRef.current;
    if (!e) return;
    const { html, text } = richClipboard(e.view, new Slice(e.state.doc.content, 0, 0));
    let ok = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      ok = true;
    } catch {
      // navegador sem ClipboardItem: seleciona uma cópia invisível e usa o comando antigo de copiar
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      holder.innerHTML = html;
      document.body.append(holder);
      const range = document.createRange();
      range.selectNodeContents(holder);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      ok = document.execCommand("copy");
      sel?.removeAllRanges();
      holder.remove();
    }
    setMessage(ok ? "Página copiada com a formatação. Cole no Google Docs, Word ou outro app." : "Não foi possível copiar. Selecione o texto e use Copiar.");
    if (ok) window.setTimeout(() => setMessage((m) => (m && m.startsWith("Página copiada") ? null : m)), 5000);
  }

  // Botão "Colar imagem": lê a área de transferência (precisa de toque do usuário e HTTPS).
  async function pasteImageFromClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error("sem suporte");
      const clips = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clip of clips) {
        const type = clip.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await clip.getType(type);
        files.push(new File([blob], `colada.${fileExtension({ type })}`, { type }));
      }
      if (!files.length) {
        setMessage("Não achei nenhuma imagem copiada. Copie a imagem primeiro e toque em Colar imagem de novo.");
        return;
      }
      await insertImages(files);
    } catch {
      setMessage("O navegador não liberou a área de transferência. Toque e segure na página e escolha Colar.");
    }
  }

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

  function insertSite() {
    if (!editor) return;
    let raw = linkValue.trim();
    if (!raw) return;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocolo");
      if (!u.hostname.includes(".")) throw new Error("host");
      editor.chain().focus().insertContent({ type: "webEmbed", attrs: { url: u.toString(), title: "" } }).run();
      setLinkBox(false);
      setLinkValue("");
      setLinkError(null);
    } catch {
      setLinkError("Esse endereço não parece válido. Exemplo: https://www.gov.br/anvisa");
    }
  }

  const exportPdf = () => {
    if (!editor) return;
    const ok = exportEditorAsPdf(editor, "anotacao");
    if (!ok) setMessage("O navegador bloqueou a abertura da janela de impressão.");
    else setMessage(null);
  };

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
      <BubbleMenu editor={editor} tippyOptions={{ duration: 100, placement: "top" }}>
        <div className="bubble" onMouseDown={keep}>
          <button type="button" aria-label="Negrito" className={editor.isActive("bold") ? "on" : ""} onClick={() => chain().toggleBold().run()}><b>B</b></button>
          <button type="button" aria-label="Itálico" className={editor.isActive("italic") ? "on" : ""} onClick={() => chain().toggleItalic().run()}><i>I</i></button>
          <button type="button" aria-label="Sublinhado" className={editor.isActive("underline") ? "on" : ""} onClick={() => chain().toggleUnderline().run()}><u>U</u></button>
          <button type="button" aria-label="Tachado" className={editor.isActive("strike") ? "on" : ""} onClick={() => chain().toggleStrike().run()}><s>S</s></button>
          <button type="button" aria-label="Marca-texto amarelo" className={editor.isActive("highlight") ? "on" : ""} onClick={() => chain().toggleHighlight({ color: MARKERS[0].v }).run()}>▮</button>
          <button type="button" aria-label="Baixar em PDF" className="pdf-export-bubble" onClick={exportPdf}>PDF</button>
          <button type="button" aria-label="Mais opções de texto" onClick={() => setSheet(sheet === "format" ? null : "format")}>Aa</button>
        </div>
      </BubbleMenu>

      <MediaIndex editor={editor} />
      <EditorContent editor={editor} />
      {message && <p className="notice">{message}</p>}
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
              <p className="sheet-label">Tamanho da fonte</p>
              <div className="sheet-row">
                {SIZES.map((s) =>
                  chip(
                    s.name,
                    () => (s.v ? chain().setFontSize(s.v).run() : chain().unsetFontSize().run()),
                    s.v ? editor.isActive("textStyle", { fontSize: s.v }) : false,
                    `Tamanho ${s.name}`
                  )
                )}
                {chip("Personalizado", () => {
                  const value = window.prompt("Digite o tamanho da fonte em pixels:", "22");
                  if (value === null) return;
                  const size = Number(value);
                  if (!Number.isFinite(size) || size < 6 || size > 100) {
                    window.alert("Digite um tamanho entre 6 e 100 pixels.");
                    return;
                  }
                  chain().setFontSize(`${size}px`).run();
                })}
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
              {editor.isActive("callout") && (
                <>
                  <p className="sheet-label">Personalizar bloco de destaque</p>
                  <div className="sheet-row">
                    <span className="sheet-label">Fundo:</span>
                    {["#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#ede9fe", "#fee2e2", "#f3f4f6", "#ffffff"].map((color) => (
                      <button type="button" key={color} aria-label={`Fundo ${color}`} className="swatch" style={{ background: color }} onClick={() => chain().updateAttributes("callout", { backgroundColor: color }).run()} />
                    ))}
                    {chip("Personalizada", () => {
                      const color = window.prompt("Digite a cor de fundo em hexadecimal:", "#fff3cd");
                      if (color && /^#[0-9a-fA-F]{6}$/.test(color)) chain().updateAttributes("callout", { backgroundColor: color }).run();
                    })}
                  </div>
                  <div className="sheet-row">
                    <span className="sheet-label">Texto:</span>
                    {["#1b2430", "#991b1b", "#166534", "#1d4ed8", "#6b21a8", "#9d174d", "#ffffff"].map((color) => (
                      <button type="button" key={color} aria-label={`Texto ${color}`} className="swatch" style={{ background: color }} onClick={() => chain().updateAttributes("callout", { textColor: color }).run()} />
                    ))}
                    {chip("Personalizada", () => {
                      const color = window.prompt("Digite a cor do texto em hexadecimal:", "#1b2430");
                      if (color && /^#[0-9a-fA-F]{6}$/.test(color)) chain().updateAttributes("callout", { textColor: color }).run();
                    })}
                  </div>
                  <div className="sheet-row">
                    {chip("Restaurar cores", () => chain().updateAttributes("callout", { backgroundColor: null, textColor: null }).run())}
                  </div>
                </>
              )}
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
            <button type="button" aria-label="Gravar áudio" onClick={() => setRecorder(true)}>🎙</button>
            <button type="button" aria-label="Baixar PDF" className="pdf-export-btn" onClick={exportPdf}>PDF</button>
            <button type="button" aria-label="Desfazer" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>↶</button>
            <button type="button" aria-label="Refazer" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>↷</button>
            <button type="button" aria-label="Fechar teclado" onClick={() => editor.commands.blur()}>⌄</button>
          </div>
        </>
      )}

      {linkBox && (
        <div className="sheet link-box" onMouseDown={(e) => e.stopPropagation()}>
          <label className="link-box-label" htmlFor="site-url">Endereço do site</label>
          <input
            id="site-url"
            className="link-box-input"
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://…"
            value={linkValue}
            onChange={(e) => { setLinkValue(e.target.value); setLinkError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertSite(); } if (e.key === "Escape") setLinkBox(false); }}
          />
          {linkError && <p className="link-box-error">{linkError}</p>}
          <div className="sheet-row">
            <button type="button" className="chip on" onClick={insertSite}>Incorporar</button>
            <button type="button" className="chip" onClick={() => setLinkBox(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {videoLinkBox && (
        <div className="sheet link-box" onMouseDown={(e) => e.stopPropagation()}>
          <label className="link-box-label" htmlFor="video-url">Link do vídeo (YouTube, Vimeo ou .mp4)</label>
          <input
            id="video-url"
            className="link-box-input"
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://youtu.be/…"
            value={videoLinkValue}
            onChange={(e) => { setVideoLinkValue(e.target.value); setVideoLinkError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertVideoLink(); } if (e.key === "Escape") setVideoLinkBox(false); }}
          />
          {videoLinkError && <p className="link-box-error">{videoLinkError}</p>}
          <div className="sheet-row">
            <button type="button" className="chip on" onClick={insertVideoLink}>Inserir vídeo</button>
            <button type="button" className="chip" onClick={() => setVideoLinkBox(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {recorder && <AudioRecorder onClose={() => setRecorder(false)} onSave={saveRecording} />}

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { send(e.target.files?.[0], "image"); e.target.value = ""; }} />
      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { send(e.target.files?.[0], "pdf"); e.target.value = ""; }} />
      <input ref={audioInput} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.opus,.flac,.webm" multiple hidden onChange={(e) => { void insertMediaFiles(Array.from(e.target.files ?? []), "audio"); e.target.value = ""; }} />
      <input ref={videoInput} type="file" accept="video/*,.mp4,.mov,.m4v,.webm" multiple hidden onChange={(e) => { void insertMediaFiles(Array.from(e.target.files ?? []), "video"); e.target.value = ""; }} />
    </div>
  );
}
