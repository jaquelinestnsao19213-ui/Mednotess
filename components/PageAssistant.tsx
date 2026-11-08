"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/upload";
import { type AssistantCard, cardsToMarkdown, sanitizeCards } from "@/lib/cards";
import { saveCardsToReview } from "@/lib/cards-db";
import Markdown from "./Markdown";

type FileInfo = { name: string; url: string; kind: "image" | "pdf" };
type CardsUi = { saving?: boolean; saved?: number; skipped?: number; inserted?: boolean; error?: string };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: FileInfo[];
  insertText?: string | null;
  inserted?: boolean;
  isError?: boolean;
  cards?: AssistantCard[];
  cardsUi?: CardsUi;
};
type Conversation = { id: string; title: string; updated_at: string };

const MAX_PAGE_CONTEXT = 24_000;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 400_000;

const STARTERS = [
  "Resuma esta página",
  "Crie 8 flashcards desta página",
  "Crie 5 questões de múltipla escolha",
  "Explique os pontos principais",
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

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const CSS = `
.pa-root{--pa-bg:#ffffff;--pa-ink:#14202b;--pa-muted:#4a5868;--pa-line:#b9c3ce;--pa-soft:#eef2f6;--pa-user:#d6efe9;--pa-accent:#0f766e;--pa-accent-ink:#ffffff;--pa-accent-soft:#e1f4f0;--pa-danger:#b42318}
.pa-root button:focus-visible,.pa-root a:focus-visible,.pa-root textarea:focus-visible{outline:3px solid var(--pa-accent);outline-offset:2px}
.pa-overlay{display:none}
.pa-fab{position:fixed;right:14px;bottom:calc(var(--kb,0px) + 58px);z-index:1002;display:inline-flex;align-items:center;gap:6px;padding:11px 18px;border:2px solid var(--pa-bg);border-radius:999px;background:var(--pa-accent);color:var(--pa-accent-ink);font-weight:700;font-size:.95rem;box-shadow:0 8px 24px rgb(0 0 0 / .35);cursor:pointer}
.pa-fab:hover{filter:brightness(1.1)}
.pa-fab.hide{display:none}
.pa-panel{position:fixed;right:12px;bottom:calc(var(--kb,0px) + 112px);z-index:1001;display:none;flex-direction:column;width:min(430px,calc(100vw - 24px));height:min(72vh,660px);overflow:hidden;color:var(--pa-ink);background:var(--pa-bg);border:2px solid var(--pa-line);border-radius:18px;box-shadow:0 28px 70px rgb(0 0 0 / .45),0 0 0 1px rgb(0 0 0 / .08)}
.pa-panel.open{display:flex}
.pa-panel.wide{width:min(800px,calc(100vw - 24px));height:min(90vh,940px);bottom:calc(var(--kb,0px) + 12px)}
@media (max-width:640px){
  .pa-overlay.open{display:block;position:fixed;inset:0;z-index:1000;background:rgb(0 0 0 / .55)}
  .pa-panel{left:8px;right:8px;width:auto;bottom:calc(var(--kb,0px) + 8px);height:min(86dvh,calc(100dvh - 16px))}
  .pa-panel.wide{width:auto;height:min(94dvh,calc(100dvh - 8px))}
}
.pa-head{display:flex;align-items:center;gap:8px;padding:12px 10px 12px 14px;border-bottom:2px solid var(--pa-line);background:var(--pa-accent-soft)}
.pa-avatar{display:grid;place-items:center;flex:0 0 auto;width:36px;height:36px;border-radius:50%;background:var(--pa-accent);color:var(--pa-accent-ink);font-size:17px}
.pa-title{flex:1;min-width:0;line-height:1.25}
.pa-title strong{display:block;font-size:.98rem;color:var(--pa-ink)}
.pa-title span{display:block;color:var(--pa-muted);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-icon{display:inline-grid;place-items:center;min-width:36px;height:36px;padding:0 6px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--pa-ink);font-size:17px;cursor:pointer}
.pa-icon:hover{background:var(--pa-soft);border-color:var(--pa-line)}
.pa-icon.on{background:var(--pa-accent);color:var(--pa-accent-ink)}
.pa-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;padding:14px;overflow-y:auto;overscroll-behavior:contain;background:var(--pa-bg)}
.pa-empty{margin:auto 0;text-align:center;color:var(--pa-muted)}
.pa-empty .pa-big{display:grid;place-items:center;width:54px;height:54px;margin:0 auto 10px;border-radius:50%;background:var(--pa-accent-soft);color:var(--pa-accent);font-size:25px}
.pa-empty h3{margin:0 0 4px;color:var(--pa-ink);font-size:1.05rem}
.pa-empty p{margin:0 auto 14px;max-width:310px;font-size:.88rem;line-height:1.45}
.pa-starters{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.pa-starter{padding:9px 13px;border:1.5px solid var(--pa-line);border-radius:999px;background:var(--pa-bg);color:var(--pa-ink);font-size:.84rem;cursor:pointer}
.pa-starter:hover{border-color:var(--pa-accent);background:var(--pa-accent-soft)}
.pa-msg{display:flex;flex-direction:column;max-width:94%}
.pa-msg.user{align-self:flex-end;align-items:flex-end}
.pa-msg.assistant{align-self:stretch;max-width:100%}
.pa-bubble{padding:11px 14px;border-radius:16px;font-size:.93rem;line-height:1.5;color:var(--pa-ink);overflow-wrap:anywhere}
.pa-msg.user .pa-bubble{border:1px solid var(--pa-accent);border-bottom-right-radius:5px;background:var(--pa-user);white-space:pre-wrap}
.pa-msg.assistant .pa-bubble{border:1.5px solid var(--pa-line);border-bottom-left-radius:5px;background:var(--pa-soft)}
.pa-msg.error .pa-bubble{border-color:var(--pa-danger);color:var(--pa-danger);background:var(--pa-bg)}
.pa-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.pa-file{padding:3px 9px;border:1px solid var(--pa-line);border-radius:999px;background:var(--pa-bg);font-size:.76rem;color:var(--pa-muted)}
.pa-md>:first-child{margin-top:0}.pa-md>:last-child{margin-bottom:0}
.pa-md p{margin:0 0 .65em}
.pa-md h2,.pa-md h3,.pa-md h4,.pa-md h5{margin:.9em 0 .35em;line-height:1.3;font-size:1rem}
.pa-md ul,.pa-md ol{margin:0 0 .65em;padding-left:1.25em}
.pa-md li{margin:.2em 0}
.pa-md table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:0 0 .65em;font-size:.84rem}
.pa-md th,.pa-md td{padding:5px 8px;border:1px solid var(--pa-line);text-align:left;vertical-align:top}
.pa-md th{background:var(--pa-accent-soft)}
.pa-md code{padding:1px 5px;border-radius:5px;background:var(--pa-accent-soft);font-size:.86em}
.pa-md pre{margin:0 0 .65em;padding:9px 11px;overflow-x:auto;border:1px solid var(--pa-line);border-radius:10px}
.pa-md blockquote{margin:0 0 .65em;padding-left:11px;border-left:3px solid var(--pa-line);color:var(--pa-muted)}
.pa-md a{color:var(--pa-accent)}
.pa-block{margin-top:10px;border:2px solid var(--pa-accent);border-radius:14px;background:var(--pa-bg);overflow:hidden}
.pa-block-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:9px 12px;background:var(--pa-accent-soft);border-bottom:1px solid var(--pa-line)}
.pa-block-h strong{font-size:.92rem;color:var(--pa-ink)}
.pa-block-h span{font-size:.78rem;color:var(--pa-muted)}
.pa-block-b{max-height:min(340px,42vh);padding:10px 12px;overflow-y:auto;font-size:.88rem;line-height:1.5}
.pa-card{padding:10px 11px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-soft)}
.pa-card+.pa-card{margin-top:9px}
.pa-card p{margin:5px 0 0}
.pa-tag{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--pa-accent);color:var(--pa-accent-ink);font-size:.72rem;font-weight:700;letter-spacing:.03em}
.pa-tag.question{background:var(--pa-ink);color:var(--pa-bg)}
.pa-opts{margin:6px 0 0;padding-left:1.6em;list-style:upper-alpha}
.pa-opts li{margin:3px 0}
.pa-opts li.ok{font-weight:700;color:var(--pa-accent)}
.pa-block-a{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-top:1px solid var(--pa-line);background:var(--pa-bg)}
.pa-btn{flex:1 1 140px;padding:10px 13px;border:2px solid var(--pa-ink);border-radius:11px;background:var(--pa-bg);color:var(--pa-ink);font-size:.88rem;font-weight:700;cursor:pointer}
.pa-btn:hover:not(:disabled){background:var(--pa-soft)}
.pa-btn.main{border-color:var(--pa-accent);background:var(--pa-accent);color:var(--pa-accent-ink)}
.pa-btn.main:hover:not(:disabled){filter:brightness(1.1);background:var(--pa-accent)}
.pa-btn:disabled{border-color:var(--pa-line);background:var(--pa-soft);color:var(--pa-muted);cursor:default}
.pa-done{margin:0;padding:0 12px 10px;color:var(--pa-ink);font-size:.82rem;line-height:1.4}
.pa-done a{color:var(--pa-accent);font-weight:700}
.pa-err{margin:0;padding:0 12px 10px;color:var(--pa-danger);font-size:.82rem;font-weight:600}
.pa-typing{display:inline-flex;gap:5px;align-items:center;padding:12px 14px;border:1.5px solid var(--pa-line);border-radius:16px;border-bottom-left-radius:5px;background:var(--pa-soft)}
.pa-typing i{width:7px;height:7px;border-radius:50%;background:var(--pa-muted);animation:pa-b 1.1s infinite ease-in-out}
.pa-typing i:nth-child(2){animation-delay:.15s}.pa-typing i:nth-child(3){animation-delay:.3s}
@keyframes pa-b{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.pa-hist{flex:1;min-height:0;margin:0;padding:10px;list-style:none;overflow-y:auto;background:var(--pa-bg)}
.pa-hist li{display:flex;align-items:stretch;gap:6px;margin-bottom:8px}
.pa-hist-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1.5px solid var(--pa-line);border-radius:12px;background:var(--pa-bg);color:var(--pa-ink);text-align:left;cursor:pointer}
.pa-hist-open:hover{border-color:var(--pa-accent);background:var(--pa-accent-soft)}
.pa-hist-open.on{border-color:var(--pa-accent);border-width:2px}
.pa-hist-open b{font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa-hist-open small{color:var(--pa-muted)}
.pa-hist-del{flex:0 0 auto;width:40px;border:1.5px solid var(--pa-line);border-radius:12px;background:var(--pa-bg);color:var(--pa-danger);font-size:18px;cursor:pointer}
.pa-hist-del:hover{background:var(--pa-soft)}
.pa-hist-empty{padding:18px;color:var(--pa-muted);text-align:center;font-size:.9rem}
.pa-foot{padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:2px solid var(--pa-line);background:var(--pa-bg)}
.pa-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.pa-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 6px 4px 10px;border:1px solid var(--pa-line);border-radius:999px;background:var(--pa-soft);color:var(--pa-ink);font-size:.78rem}
.pa-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.pa-chip button{border:0;background:transparent;color:var(--pa-muted);cursor:pointer;font-size:15px;padding:0 4px}
.pa-form{display:flex;align-items:flex-end;gap:6px;padding:6px;border:2px solid var(--pa-line);border-radius:16px;background:var(--pa-bg)}
.pa-form:focus-within{border-color:var(--pa-accent)}
.pa-form textarea{flex:1;min-width:0;max-height:140px;padding:8px 4px;border:0;outline:0;resize:none;background:transparent;color:var(--pa-ink);font:inherit;font-size:.93rem;line-height:1.4}
.pa-form textarea::placeholder{color:var(--pa-muted);opacity:1}
.pa-form textarea:disabled{opacity:.6}
.pa-send{display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;padding:0;border:0;border-radius:12px;background:var(--pa-accent);color:var(--pa-accent-ink);font-size:19px;font-weight:700;cursor:pointer}
.pa-send:hover:not(:disabled){filter:brightness(1.1)}
.pa-send:disabled{background:var(--pa-line);color:var(--pa-muted);cursor:not-allowed}
.pa-note{margin:8px 2px 0;color:var(--pa-muted);font-size:.72rem;line-height:1.35}
.pa-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}
`;

export default function PageAssistant({
  pageId,
  title,
  content,
  onInsert,
}: {
  pageId?: string;
  title?: string;
  content?: unknown;
  onInsert?: (text: string) => void;
}) {
  const scope = `page:${pageId ?? "sem-pagina"}`;
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyOk, setHistoryOk] = useState(true);
  const loadedHistory = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open, showHistory]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ao abrir pela primeira vez: carrega o histórico desta página e reabre a conversa mais recente
  useEffect(() => {
    if (!open || loadedHistory.current || !pageId) return;
    loadedHistory.current = true;
    void (async () => {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id,title,updated_at")
        .eq("scope", scope)
        .order("updated_at", { ascending: false })
        .limit(40);
      if (error) return setHistoryOk(false); // tabelas ainda não criadas: o chat funciona, só sem histórico
      const list = (data ?? []) as Conversation[];
      setConversations(list);
      if (list[0]) await openConversation(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  function closePanel() {
    setOpen(false);
    setWide(false);
    fabRef.current?.focus();
  }

  async function openConversation(id: string) {
    type Row = { role: "user" | "assistant"; content: string; attachments: FileInfo[] | null; meta?: { cards?: unknown; insertText?: unknown } | null };
    const result = await supabase.from("chat_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }).limit(300);
    if (result.error) return;
    setActiveId(id);
    setMessages(
      ((result.data ?? []) as Row[]).map((row, index) => {
        const cards = sanitizeCards(row.meta?.cards);
        const insertText = typeof row.meta?.insertText === "string" && row.meta.insertText.trim() ? row.meta.insertText : null;
        return {
          id: `h${id}-${index}`,
          role: row.role,
          content: row.content,
          files: row.attachments?.length ? row.attachments : undefined,
          cards: cards.length ? cards : undefined,
          insertText,
        };
      })
    );
    setShowHistory(false);
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setAttachments([]);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Apagar esta conversa do histórico?")) return;
    const { error } = await supabase.from("chat_conversations").delete().eq("id", id);
    if (error) return;
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeId === id) newConversation();
  }

  async function saveMessage(conversationId: string, message: ChatMessage) {
    const base: Record<string, unknown> = {
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      attachments: message.files?.length ? message.files : null,
    };
    const meta = message.cards?.length || message.insertText ? { cards: message.cards ?? null, insertText: message.insertText ?? null } : null;
    let { error } = await supabase.from("chat_messages").insert(meta ? { ...base, meta } : base);
    if (error && meta) ({ error } = await supabase.from("chat_messages").insert(base)); // coluna "meta" ainda não existe
    if (error) return;
    const now = new Date().toISOString();
    await supabase.from("chat_conversations").update({ updated_at: now }).eq("id", conversationId);
    setConversations((current) => {
      const found = current.find((item) => item.id === conversationId);
      return found ? [{ ...found, updated_at: now }, ...current.filter((item) => item.id !== conversationId)] : current;
    });
  }

  async function ensureConversation(firstPrompt: string) {
    if (activeId) return activeId;
    if (!pageId || !historyOk) return null;
    const heading = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Nova conversa";
    const { data, error } = await supabase.from("chat_conversations").insert({ title: heading, scope }).select("id,title,updated_at").single();
    if (error || !data) return null; // sem histórico, mas o chat continua funcionando
    setActiveId(data.id);
    setConversations((current) => [data as Conversation, ...current]);
    return data.id as string;
  }

  async function sendMessage(text: string) {
    const typed = text.trim();
    if ((!typed && !attachments.length) || loading) return;
    const pending = [...attachments];
    setDraft("");
    setAttachments([]);
    setShowHistory(false);
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

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const conversationId = await ensureConversation(typed || userMessage.content);
      if (conversationId) await saveMessage(conversationId, userMessage);

      const history = next
        .filter((m) => !m.isError)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content, attachments: m.files }));
      while (history.length && history[0].role !== "user") history.shift();

      const pageText = docToText(contentRef.current).trim().slice(0, MAX_PAGE_CONTEXT);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: history, pageContext: { title: (title ?? "").slice(0, 300), text: pageText } }),
      });
      const result = (await response.json()) as { message?: string; insertText?: string | null; cards?: unknown; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível obter uma resposta agora.");
      const cards = sanitizeCards(result.cards);
      const reply: ChatMessage = {
        id: `a${Date.now()}`,
        role: "assistant",
        content: result.message,
        cards: cards.length ? cards : undefined,
        insertText: !cards.length && result.insertText?.trim() ? result.insertText : null,
      };
      setMessages((current) => [...current, reply]);
      if (conversationId) await saveMessage(conversationId, reply);
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

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function patchCardsUi(id: string, ui: CardsUi) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, cardsUi: { ...m.cardsUi, ...ui } } : m)));
  }

  function insertCards(message: ChatMessage) {
    if (!message.cards?.length) return;
    onInsert?.(cardsToMarkdown(message.cards, title));
    patchCardsUi(message.id, { inserted: true });
  }

  async function saveCards(message: ChatMessage) {
    if (!message.cards?.length || message.cardsUi?.saving) return;
    patchCardsUi(message.id, { saving: true, error: undefined });
    try {
      const result = await saveCardsToReview(message.cards, pageId ?? null, title ?? "");
      patchCardsUi(message.id, { saving: false, saved: result.saved, skipped: result.skipped });
    } catch (cause) {
      patchCardsUi(message.id, { saving: false, error: cause instanceof Error ? cause.message : "Não foi possível salvar agora." });
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

  const canSend = !loading && (draft.trim().length > 0 || attachments.length > 0);

  return (
    <div className="pa-root">
      <style>{CSS}</style>

      <div className={`pa-overlay${open ? " open" : ""}`} onClick={closePanel} aria-hidden="true" />

      <section className={`pa-panel${open ? " open" : ""}${wide ? " wide" : ""}`} role="dialog" aria-modal="false" aria-label="Assistente da página">
        <header className="pa-head">
          <span className="pa-avatar" aria-hidden="true">✦</span>
          <div className="pa-title">
            <strong>Maria · assistente da página</strong>
            <span>{showHistory ? "Histórico de conversas desta página" : "Lê esta página, cria flashcards e questões"}</span>
          </div>
          {historyOk && pageId && (
            <button type="button" className={`pa-icon${showHistory ? " on" : ""}`} aria-label="Histórico de conversas" aria-pressed={showHistory} title="Histórico" onClick={() => setShowHistory((v) => !v)}>
              🕘{conversations.length ? ` ${conversations.length}` : ""}
            </button>
          )}
          <button type="button" className="pa-icon" aria-label="Nova conversa" title="Nova conversa" onClick={newConversation}>＋</button>
          <button type="button" className="pa-icon" aria-label={wide ? "Reduzir" : "Ampliar"} title={wide ? "Reduzir" : "Ampliar"} onClick={() => setWide((v) => !v)}>{wide ? "⤡" : "⤢"}</button>
          <button type="button" className="pa-icon" aria-label="Fechar assistente" title="Fechar" onClick={closePanel}>×</button>
        </header>

        {showHistory ? (
          <ul className="pa-hist" aria-label="Conversas anteriores">
            {conversations.length === 0 && <li className="pa-hist-empty">As conversas desta página aparecerão aqui.</li>}
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button type="button" className={`pa-hist-open${conversation.id === activeId ? " on" : ""}`} onClick={() => void openConversation(conversation.id)}>
                  <b>{conversation.title}</b>
                  <small>{formatWhen(conversation.updated_at)}</small>
                </button>
                <button type="button" className="pa-hist-del" aria-label={`Apagar conversa ${conversation.title}`} onClick={() => void deleteConversation(conversation.id)}>×</button>
              </li>
            ))}
          </ul>
        ) : (
          <div ref={listRef} className="pa-list" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="pa-empty">
                <div className="pa-big" aria-hidden="true">✦</div>
                <h3>Como posso ajudar nesta página?</h3>
                <p>Pergunte sobre o conteúdo, peça um resumo ou gere flashcards e questões para guardar em Revisões.</p>
                <div className="pa-starters">
                  {STARTERS.map((s) => (
                    <button type="button" key={s} className="pa-starter" onClick={() => void sendMessage(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const ui = m.cardsUi ?? {};
                const flash = m.cards?.filter((c) => c.type === "flashcard").length ?? 0;
                const quiz = (m.cards?.length ?? 0) - flash;
                return (
                  <div key={m.id} className={`pa-msg ${m.role}${m.isError ? " error" : ""}`}>
                    <div className="pa-bubble">
                      {m.role === "assistant" && !m.isError ? <div className="pa-md"><Markdown text={m.content} /></div> : m.content}
                    </div>
                    {m.files && (
                      <div className="pa-files">{m.files.map((f) => <span key={f.url} className="pa-file">{f.kind === "pdf" ? "📄" : "🖼️"} {f.name}</span>)}</div>
                    )}

                    {m.cards && m.cards.length > 0 && (
                      <div className="pa-block" role="group" aria-label="Flashcards e questões geradas">
                        <div className="pa-block-h">
                          <strong>{m.cards.length} {m.cards.length === 1 ? "item gerado" : "itens gerados"}</strong>
                          <span>{flash ? `${flash} flashcard${flash > 1 ? "s" : ""}` : ""}{flash && quiz ? " · " : ""}{quiz ? `${quiz} questõe${quiz > 1 ? "s" : "o"}`.replace("questõeo", "questão") : ""}</span>
                        </div>
                        <div className="pa-block-b">
                          {m.cards.map((card, i) => (
                            <article key={i} className="pa-card">
                              <span className={`pa-tag ${card.type}`}>{card.type === "flashcard" ? "FLASHCARD" : "QUESTÃO"} {i + 1}</span>
                              <p><b>Pergunta:</b> {card.question}</p>
                              {card.options && (
                                <ol className="pa-opts">
                                  {card.options.map((option, j) => (
                                    <li key={j} className={j === card.correctIndex ? "ok" : undefined}>{option}{j === card.correctIndex ? " ✓" : ""}</li>
                                  ))}
                                </ol>
                              )}
                              <p><b>Resposta:</b> {card.answer}</p>
                              {card.explanation && <p><b>Explicação:</b> {card.explanation}</p>}
                            </article>
                          ))}
                        </div>
                        <div className="pa-block-a">
                          <button type="button" className="pa-btn main" disabled={ui.inserted} onClick={() => insertCards(m)}>
                            {ui.inserted ? "✓ Inserido na Página" : "Inserir na Página"}
                          </button>
                          <button type="button" className="pa-btn" disabled={ui.saving || ui.saved !== undefined} onClick={() => void saveCards(m)}>
                            {ui.saving ? "Salvando…" : ui.saved !== undefined ? "✓ Salvo em Revisões" : "Salvar em Revisões"}
                          </button>
                        </div>
                        {ui.saved !== undefined && (
                          <p className="pa-done">
                            {ui.saved} {ui.saved === 1 ? "item salvo" : "itens salvos"} em Revisões{ui.skipped ? ` (${ui.skipped} já existia${ui.skipped > 1 ? "m" : ""})` : ""}.{" "}
                            <Link href="/revisoes">Abrir Revisões →</Link>
                          </p>
                        )}
                        {ui.error && <p className="pa-err" role="alert">{ui.error}</p>}
                      </div>
                    )}

                    {m.insertText && (
                      <div className="pa-block">
                        <div className="pa-block-h"><strong>Sugestão para a página</strong></div>
                        <div className="pa-block-b pa-md"><Markdown text={m.insertText} /></div>
                        <div className="pa-block-a">
                          <button type="button" className="pa-btn main" onClick={() => { onInsert?.(m.insertText!); patchMessage(m.id, { insertText: null, inserted: true }); }}>Inserir na Página</button>
                          <button type="button" className="pa-btn" onClick={() => patchMessage(m.id, { insertText: null })}>Descartar</button>
                        </div>
                      </div>
                    )}
                    {m.inserted && <p className="pa-done" style={{ padding: "6px 2px 0" }}>✓ Inserido no fim da página</p>}
                  </div>
                );
              })
            )}
            {loading && (
              <div className="pa-msg assistant" role="status" aria-label="Preparando a resposta">
                <span className="pa-typing"><i /><i /><i /></span>
              </div>
            )}
          </div>
        )}

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
            <label htmlFor="page-assistant-input" className="pa-sr">Escreva sua mensagem</label>
            <textarea
              id="page-assistant-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={4000}
              disabled={loading}
              placeholder="Pergunte ou peça flashcards, questões…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="pa-send" aria-label="Enviar mensagem" disabled={!canSend}>↑</button>
          </form>
          <p className="pa-note">O conteúdo da página é enviado à Anthropic para gerar a resposta. PDFs anexados à página não são lidos.</p>
        </div>
      </section>

      <button
        ref={fabRef}
        type="button"
        className={`pa-fab${open && wide ? " hide" : ""}`}
        aria-expanded={open}
        aria-label={open ? "Fechar assistente" : "Abrir assistente desta página"}
        onClick={() => { if (open) closePanel(); else { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); } }}
      >
        ✦ {open ? "Fechar" : "Agente"}
      </button>
    </div>
  );
}
