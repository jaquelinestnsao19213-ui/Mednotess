"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/upload";
import Markdown from "./Markdown";

type FileInfo = { name: string; url: string; kind: "image" | "pdf" };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: FileInfo[];
  insertText?: string | null;
  inserted?: boolean;
  isError?: boolean;
};

const MAX_PAGE_CONTEXT = 24_000;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 400_000;

const STARTERS = [
  "Resuma esta página",
  "Crie perguntas de revisão",
  "Explique os pontos principais",
  "Monte um quadro comparativo",
];

/** Extrai o texto simples de um documento do editor (Tiptap). */
function docToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "fileCard") return `[PDF anexado: ${String(n.attrs?.name ?? "arquivo")}]\n`;
  if (n.type === "webEmbed") return `[Site incorporado: ${String(n.attrs?.title || n.attrs?.url || "")} ${String(n.attrs?.url ?? "")}]\n`;
  const inner = (n.content ?? []).map(docToText);
  const text = n.type === "tableRow" ? inner.join(" | ") : inner.join("");
  const blocks = ["paragraph", "heading", "listItem", "taskItem", "tableRow", "blockquote", "codeBlock"];
  return n.type && blocks.includes(n.type) ? text + "\n" : text;
}

const CSS = `
.pa-fab{position:fixed;right:14px;bottom:calc(var(--kb,0px) + 58px);z-index:36;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:600;font-size:.95rem;box-shadow:0 6px 20px rgb(0 0 0 / .22);cursor:pointer}
.pa-fab.hide{display:none}
.pa-panel{position:fixed;right:12px;bottom:calc(var(--kb,0px) + 108px);z-index:35;display:none;flex-direction:column;width:min(420px,calc(100vw - 24px));height:min(70vh,640px);overflow:hidden;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 16px 48px rgb(0 0 0 / .24)}
.pa-panel.open{display:flex}
.pa-panel.wide{width:min(780px,calc(100vw - 24px));height:min(88vh,920px);bottom:calc(var(--kb,0px) + 12px)}
.pa-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--accent) 7%,var(--surface))}
.pa-avatar{display:grid;place-items:center;flex:0 0 auto;width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:17px}
.pa-title{flex:1;min-width:0;line-height:1.25}
.pa-title strong{display:block;font-size:.98rem}
.pa-title span{display:block;color:var(--muted);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-icon{display:inline-grid;place-items:center;width:34px;height:34px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--ink);font-size:17px;cursor:pointer}
.pa-icon:hover{background:color-mix(in srgb,var(--ink) 8%,transparent)}
.pa-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:14px;overflow-y:auto;overscroll-behavior:contain}
.pa-empty{margin:auto 0;text-align:center;color:var(--muted)}
.pa-empty .pa-big{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 10px;border-radius:50%;background:color-mix(in srgb,var(--accent) 14%,var(--surface));color:var(--accent);font-size:24px}
.pa-empty h3{margin:0 0 4px;color:var(--ink);font-size:1.02rem}
.pa-empty p{margin:0 auto 14px;max-width:300px;font-size:.88rem;line-height:1.45}
.pa-starters{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.pa-starter{padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);font-size:.84rem;cursor:pointer}
.pa-starter:hover{border-color:var(--accent)}
.pa-msg{display:flex;flex-direction:column;max-width:92%}
.pa-msg.user{align-self:flex-end;align-items:flex-end}
.pa-msg.assistant{align-self:stretch;max-width:100%}
.pa-bubble{padding:10px 13px;border-radius:16px;font-size:.92rem;line-height:1.5;overflow-wrap:anywhere}
.pa-msg.user .pa-bubble{border-bottom-right-radius:5px;background:color-mix(in srgb,var(--accent) 16%,var(--surface));white-space:pre-wrap}
.pa-msg.assistant .pa-bubble{border:1px solid var(--line);border-bottom-left-radius:5px;background:color-mix(in srgb,var(--ink) 3%,var(--surface))}
.pa-msg.error .pa-bubble{border-color:var(--danger);color:var(--danger)}
.pa-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.pa-file{padding:3px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:.76rem;color:var(--muted)}
.pa-md>:first-child{margin-top:0}.pa-md>:last-child{margin-bottom:0}
.pa-md p{margin:0 0 .65em}
.pa-md h2,.pa-md h3,.pa-md h4,.pa-md h5{margin:.9em 0 .35em;line-height:1.3;font-size:1rem}
.pa-md ul,.pa-md ol{margin:0 0 .65em;padding-left:1.25em}
.pa-md li{margin:.2em 0}
.pa-md table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:0 0 .65em;font-size:.84rem}
.pa-md th,.pa-md td{padding:5px 8px;border:1px solid var(--line);text-align:left;vertical-align:top}
.pa-md th{background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
.pa-md code{padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--accent) 9%,var(--surface));font-size:.86em}
.pa-md pre{margin:0 0 .65em;padding:9px 11px;overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.pa-md blockquote{margin:0 0 .65em;padding-left:11px;border-left:3px solid var(--line);color:var(--muted)}
.pa-suggest{margin-top:8px;border:1px dashed var(--accent);border-radius:14px;background:color-mix(in srgb,var(--accent) 6%,var(--surface));overflow:hidden}
.pa-suggest-h{padding:8px 12px 0;color:var(--accent);font-size:.76rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.pa-suggest-b{max-height:200px;padding:6px 12px 10px;overflow-y:auto;font-size:.88rem;line-height:1.5}
.pa-suggest-a{display:flex;gap:8px;padding:8px 10px;border-top:1px solid var(--line)}
.pa-btn{padding:8px 13px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink);font-size:.85rem;cursor:pointer}
.pa-btn.main{border-color:var(--accent);background:var(--accent);color:var(--accent-ink);font-weight:600}
.pa-done{margin-top:6px;color:var(--muted);font-size:.8rem}
.pa-typing{display:inline-flex;gap:5px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:16px;border-bottom-left-radius:5px;background:color-mix(in srgb,var(--ink) 3%,var(--surface))}
.pa-typing i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:pa-b 1.1s infinite ease-in-out}
.pa-typing i:nth-child(2){animation-delay:.15s}.pa-typing i:nth-child(3){animation-delay:.3s}
@keyframes pa-b{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.pa-foot{padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:var(--surface)}
.pa-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.pa-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 6px 4px 10px;border:1px solid var(--line);border-radius:999px;font-size:.78rem}
.pa-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.pa-chip button{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:14px;padding:0 4px}
.pa-form{display:flex;align-items:flex-end;gap:6px;padding:6px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.pa-form:focus-within{border-color:var(--accent)}
.pa-form textarea{flex:1;min-width:0;max-height:140px;padding:8px 4px;border:0;outline:0;resize:none;background:transparent;color:var(--ink);font:inherit;font-size:.92rem;line-height:1.4}
.pa-send{display:grid;place-items:center;flex:0 0 auto;width:38px;height:38px;padding:0;border:0;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-size:18px;cursor:pointer}
.pa-send:disabled{opacity:.4;cursor:default}
.pa-note{margin:8px 2px 0;color:var(--muted);font-size:.7rem;line-height:1.35}
`;

export default function PageAssistant({
  title,
  content,
  onInsert,
}: {
  title?: string;
  content?: unknown;
  onInsert?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const contextText = useMemo(() => docToText(content).trim().slice(0, MAX_PAGE_CONTEXT), [content]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function sendMessage(text: string) {
    const typed = text.trim();
    if ((!typed && !attachments.length) || loading) return;
    const pending = [...attachments];
    setDraft("");
    setAttachments([]);
    setLoading(true);
    try {
      if (pending.length > MAX_FILES) throw new Error(`Envie no máximo ${MAX_FILES} arquivos por mensagem.`);
      // imagens e PDFs vão para o Storage; arquivos de texto entram direto na mensagem
      const files: FileInfo[] = [];
      let inlineText = "";
      for (const file of pending) {
        const lower = file.name.toLowerCase();
        if (file.type.startsWith("image/")) {
          if (file.size > MAX_IMAGE_BYTES) throw new Error("A imagem é grande demais (máx. 5 MB).");
          files.push({ name: file.name, url: await uploadFile(file), kind: "image" });
        } else if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
          if (file.size > MAX_PDF_BYTES) throw new Error("O PDF é grande demais (máx. 20 MB).");
          files.push({ name: file.name, url: await uploadFile(file), kind: "pdf" });
        } else if (file.type.startsWith("text/") || /\.(txt|md|csv|tsv)$/.test(lower)) {
          if (file.size > MAX_TEXT_FILE_BYTES) throw new Error("O arquivo de texto é grande demais.");
          inlineText += `\n\n[Arquivo: ${file.name}]\n${await file.text()}`;
        } else {
          throw new Error("Tipo de arquivo não aceito. Envie foto, PDF ou texto (.txt, .md, .csv).");
        }
      }
      const userMessage: ChatMessage = {
        id: `u${Date.now()}`,
        role: "user",
        content: `${typed}${inlineText}`.trim() || "(arquivo enviado)",
        files: files.length ? files : undefined,
      };
      const next = [...messages, userMessage];
      setMessages(next);

      const history = next
        .filter((m) => !m.isError)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content, attachments: m.files }));
      while (history.length && history[0].role !== "user") history.shift();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: history, pageContext: { title: (title ?? "").slice(0, 300), text: contextText } }),
      });
      const result = (await response.json()) as { message?: string; insertText?: string | null; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível obter uma resposta agora.");
      setMessages((current) => [
        ...current,
        { id: `a${Date.now()}`, role: "assistant", content: result.message!, insertText: result.insertText?.trim() ? result.insertText : null },
      ]);
    } catch (cause) {
      setMessages((current) => [
        ...current,
        { id: `e${Date.now()}`, role: "assistant", isError: true, content: cause instanceof Error ? cause.message : "Ocorreu um erro. Tente novamente." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  function insert(id: string, text: string) {
    onInsert?.(text);
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, insertText: null, inserted: true } : m)));
  }

  function discard(id: string) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, insertText: null } : m)));
  }

  const canSend = !loading && (draft.trim().length > 0 || attachments.length > 0);

  return (
    <>
      <style>{CSS}</style>

      <section className={`pa-panel${open ? " open" : ""}${wide ? " wide" : ""}`} aria-label="Chat com a assistente da página">
        <header className="pa-head">
          <span className="pa-avatar" aria-hidden="true">✦</span>
          <div className="pa-title">
            <strong>Maria · assistente da página</strong>
            <span>Lê o texto desta página e pode sugerir conteúdo</span>
          </div>
          {messages.length > 0 && (
            <button type="button" className="pa-icon" aria-label="Nova conversa" title="Nova conversa" onClick={() => { setMessages([]); setAttachments([]); }}>↺</button>
          )}
          <button type="button" className="pa-icon" aria-label={wide ? "Reduzir" : "Ampliar"} title={wide ? "Reduzir" : "Ampliar"} onClick={() => setWide((v) => !v)}>{wide ? "⤡" : "⤢"}</button>
          <button type="button" className="pa-icon" aria-label="Fechar assistente" onClick={() => setOpen(false)}>×</button>
        </header>

        <div ref={listRef} className="pa-list" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <div className="pa-empty">
              <div className="pa-big" aria-hidden="true">✦</div>
              <h3>Como posso ajudar nesta página?</h3>
              <p>Pergunte sobre o conteúdo, peça um resumo, perguntas de revisão ou um texto para acrescentar ao caderno.</p>
              <div className="pa-starters">
                {STARTERS.map((s) => (
                  <button type="button" key={s} className="pa-starter" onClick={() => void sendMessage(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`pa-msg ${m.role}${m.isError ? " error" : ""}`}>
                <div className="pa-bubble">
                  {m.role === "assistant" && !m.isError ? <div className="pa-md"><Markdown text={m.content} /></div> : m.content}
                </div>
                {m.files && (
                  <div className="pa-files">{m.files.map((f) => <span key={f.url} className="pa-file">{f.kind === "pdf" ? "📄" : "🖼️"} {f.name}</span>)}</div>
                )}
                {m.insertText && (
                  <div className="pa-suggest">
                    <div className="pa-suggest-h">Sugestão para a página</div>
                    <div className="pa-suggest-b pa-md"><Markdown text={m.insertText} /></div>
                    <div className="pa-suggest-a">
                      <button type="button" className="pa-btn main" onClick={() => insert(m.id, m.insertText!)}>Inserir na página</button>
                      <button type="button" className="pa-btn" onClick={() => discard(m.id)}>Descartar</button>
                    </div>
                  </div>
                )}
                {m.inserted && <div className="pa-done">✓ Inserido no fim da página</div>}
              </div>
            ))
          )}
          {loading && (
            <div className="pa-msg assistant" role="status" aria-label="Preparando a resposta">
              <span className="pa-typing"><i /><i /><i /></span>
            </div>
          )}
        </div>

        <div className="pa-foot">
          {attachments.length > 0 && (
            <div className="pa-chips">
              {attachments.map((file, i) => (
                <span key={`${file.name}-${i}`} className="pa-chip">
                  <span>{file.name}</span>
                  <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setAttachments((prev) => prev.filter((_, index) => index !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <form className="pa-form" onSubmit={submit}>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept="image/*,application/pdf,.txt,.md,.csv,.tsv,text/*"
              onChange={(e) => { setAttachments((prev) => [...prev, ...Array.from(e.target.files ?? [])].slice(0, MAX_FILES)); e.target.value = ""; }}
            />
            <button type="button" className="pa-icon" aria-label="Anexar arquivo" title="Anexar foto, PDF ou texto" onClick={() => fileRef.current?.click()}>📎</button>
            <label htmlFor="page-assistant-input" style={{ position: "absolute", width: 1, height: 1, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Escreva sua mensagem</label>
            <textarea
              id="page-assistant-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={4000}
              disabled={loading}
              placeholder="Pergunte ou peça para adicionar algo…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="pa-send" aria-label="Enviar mensagem" disabled={!canSend}>↑</button>
          </form>
          <p className="pa-note">O conteúdo da página é enviado à Anthropic para gerar a resposta. PDFs anexados à página não são lidos.</p>
        </div>
      </section>

      <button
        type="button"
        className={`pa-fab${open && wide ? " hide" : ""}`}
        aria-expanded={open}
        aria-label={open ? "Fechar assistente" : "Abrir assistente desta página"}
        onClick={() => { setOpen((v) => !v); if (!open) setTimeout(() => inputRef.current?.focus(), 0); }}
      >
        ✦ {open ? "Fechar" : "Agente"}
      </button>
    </>
  );
}
