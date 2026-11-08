"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, CalendarDays, Check, ChevronDown, ChevronUp, Copy, FileText, Image as ImageIcon, Maximize2, Menu, Minimize2, Paperclip, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ApiError, errorMessage, postJson } from "@/lib/api";
import Markdown from "@/components/Markdown";
import type { Action } from "@/lib/server/chat-agent";

type Attachment = { url: string; kind: "image" | "pdf"; name: string };
type Message = { role: "user" | "assistant"; content: string; attachments?: Attachment[]; actions?: Action[] };
type Conversation = { id: string; title: string; updated_at: string };
type Scope = "home" | "planner";
type Mode = "bar" | "inline" | "full";
export type OpenTaskRequest = { id: string; date: string };

const COPY: Record<Scope, { eyebrow: string; title: string; subtitle: string; barText: string; starters: string[]; placeholder: string }> = {
  home: {
    eyebrow: "SUA ASSISTENTE DE ESTUDOS",
    title: "Maria · Assistente de estudos",
    subtitle: "Converse sobre seus estudos e sua rotina.",
    barText: "Sua assistente de estudos",
    starters: ["Organize minha semana", "Crie um planejamento de estudos", "Analise minhas pendências"],
    placeholder: "Escreva um comando ou uma pergunta…",
  },
  planner: {
    eyebrow: "ASSISTENTE DO PLANEJAMENTO",
    title: "Maria · Assistente de Planejamento",
    subtitle: "Cole seu planejamento em texto, foto ou PDF e ela organiza a semana para você.",
    barText: "Sua assistente de planejamento",
    starters: ["O que falta fazer esta semana?", "Adicione meu planejamento (vou colar)", "Reorganize os horários de amanhã"],
    placeholder: "Cole seu planejamento ou peça uma mudança…",
  },
};

const MAX_TEXT_FILE_BYTES = 400_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;
const SEND_LIMIT_CHARS = 400_000; // tamanho máximo do histórico enviado à IA
const LEGACY_FAILURE = "Não consegui concluir agora. Tente novamente."; // texto antigo gravado como se fosse resposta

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Últimas mensagens que cabem no limite da API (até 20), sempre começando pela usuária. */
function historyForApi(all: Message[]) {
  const usable = all.filter((message) => !(message.role === "assistant" && message.content.trim() === LEGACY_FAILURE));
  const picked: Message[] = [];
  let total = 0;
  for (let i = usable.length - 1; i >= 0 && picked.length < 20; i--) {
    const content = usable[i].content.slice(0, 200_000);
    if (total + content.length > SEND_LIMIT_CHARS) break;
    total += content.length;
    picked.unshift({ role: usable[i].role, content, attachments: usable[i].attachments });
  }
  while (picked.length && picked[0].role !== "user") picked.shift();
  return picked;
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("pt-BR", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
function groupOf(iso: string) {
  const days = Math.floor((new Date(new Date().toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days <= 7) return "Últimos 7 dias";
  return "Mais antigas";
}
function longDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(y, m - 1, d));
}
const isMissingColumn = (error: { code?: string; message?: string } | null) => !!error && (error.code === "42703" || error.code === "PGRST204" || /actions/i.test(error.message ?? ""));

/** Reduz fotos grandes do celular (a IA aceita até ~5 MB por imagem e fica mais rápido). */
async function shrinkImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch {
    /* usa o original */
  }
  if (file.size > 4_500_000) throw new Error("A imagem é grande demais. Tente enviar outra foto.");
  return file;
}

async function uploadToStorage(blob: Blob, ext: string, contentType: string) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sua sessão expirou. Entre novamente.");
  const path = `${data.user.id}/chat-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("files").upload(path, blob, { contentType });
  if (error) throw new Error("Não foi possível enviar o arquivo. Tente novamente.");
  return supabase.storage.from("files").getPublicUrl(path).data.publicUrl;
}

/** Copia para a área de transferência (com plano B para navegadores que bloqueiam a API moderna). */
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* tenta o plano B */ }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch { return false; }
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  async function copy() {
    setState((await copyText(text)) ? "ok" : "fail");
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <button type="button" className={`ac-copy${state === "ok" ? " is-ok" : ""}`} onClick={() => void copy()} aria-label="Copiar mensagem" title="Copiar mensagem">
      {state === "ok" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{state === "ok" ? "Copiado" : state === "fail" ? "Não foi possível copiar" : "Copiar"}</span>
    </button>
  );
}

/** Cartão de uma atividade que a assistente criou ou alterou (dados lidos de volta do banco). */
function TaskActionCard({ action, onOpen }: { action: Action; onOpen: (action: Action) => void }) {
  const [more, setMore] = useState(false);
  const done = action.steps.filter((step) => step.completed).length;
  const shown = more ? action.steps : action.steps.slice(0, 5);
  return (
    <div className="ac-card">
      <div className="ac-card-head">
        <span className="ac-card-icon" aria-hidden="true"><CalendarDays size={18} /></span>
        <div className="ac-card-title"><strong>{action.title}</strong><span>{longDay(action.date)} · {action.time_label}{action.subject ? ` · ${action.subject}` : ""}</span></div>
        <span className="ac-card-badge"><Check size={12} strokeWidth={3} aria-hidden="true" /> {action.type === "created" ? "Criada" : "Atualizada"}</span>
      </div>
      {action.notes_chars > 0 && <p className="ac-card-notes"><FileText size={14} aria-hidden="true" /> {action.notes_preview}{action.notes_chars > action.notes_preview.length ? "…" : ""}</p>}
      {action.steps_total > 0 && (
        <div className="ac-card-steps">
          <div className="ac-card-steps-head"><span>Etapas</span><span>{done}/{action.steps_total}</span></div>
          <ul>{shown.map((step, index) => <li key={index} className={step.completed ? "done" : ""}><i aria-hidden="true">{step.completed && <Check size={10} strokeWidth={3.5} />}</i>{step.text}</li>)}</ul>
          {action.steps.length > 5 && <button type="button" className="ac-link" onClick={() => setMore((open) => !open)}>{more ? "Ver menos" : `Ver mais ${action.steps.length - 5}`}</button>}
        </div>
      )}
      <button type="button" className="ac-card-open" onClick={() => onOpen(action)}>Ver no calendário <CalendarDays size={14} aria-hidden="true" /></button>
    </div>
  );
}

export default function HomeChat({ scope = "home", onChanged, onOpenTask }: { scope?: Scope; onChanged?: () => void; onOpenTask?: (request: OpenTaskRequest) => void }) {
  const copy = COPY[scope];
  const [mode, setMode] = useState<Mode>("inline");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [textFiles, setTextFiles] = useState<{ name: string; text: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const activeRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const actionsColumn = useRef<boolean | null>(null);
  const touched = useRef(false); // a pessoa já mexeu na conversa: o carregamento do histórico não pode sobrescrever a tela
  activeRef.current = activeId;
  messagesRef.current = messages;

  const isLoading = loadingKey !== null && (loadingKey === "__pending__" || loadingKey === (activeId ?? "__pending__"));
  const storageKey = `mednotes-assistant:${scope}`;

  // lembra se a janela estava minimizada, normal ou ampliada
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "bar" || saved === "inline" || saved === "full") setMode(saved);
    } catch { /* sem armazenamento: segue com o padrão */ }
  }, [storageKey]);
  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    if (next !== "full") setDrawerOpen(false);
    try { window.localStorage.setItem(storageKey, next); } catch { /* ignora */ }
  }, [storageKey]);

  // ao ampliar: trava a rolagem da página, fecha com Esc e leva o foco ao campo de escrita
  useEffect(() => {
    if (mode !== "full") return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (drawerOpen) setDrawerOpen(false);
      else changeMode("inline");
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); };
  }, [mode, drawerOpen, changeMode]);

  // acompanha a mensagem mais recente, mas respeita quem subiu para reler
  useEffect(() => {
    const list = listRef.current;
    if (list && (nearBottom.current || messages[messages.length - 1]?.role === "user")) list.scrollTop = list.scrollHeight;
  }, [messages, loadingKey, mode]);

  // campo de escrita cresce junto com o texto
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [draft, mode]);

  // ao abrir: carrega a lista de conversas desta tela e reabre a mais recente
  useEffect(() => {
    void (async () => {
      const { data, error: listError } = await supabase.from("chat_conversations").select("id,title,updated_at").eq("scope", scope).order("updated_at", { ascending: false }).limit(100);
      if (listError) return; // tabelas ainda não criadas: o chat funciona, só sem histórico
      const list = (data ?? []) as Conversation[];
      setConversations(list);
      if (list[0] && !touched.current) await openConversation(list[0].id, false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function openConversation(id: string, closeDrawer = true) {
    if (closeDrawer) touched.current = true;
    let result = await supabase.from("chat_messages").select("role,content,attachments,actions").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500);
    if (result.error && isMissingColumn(result.error)) {
      actionsColumn.current = false;
      result = await supabase.from("chat_messages").select("role,content,attachments").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500) as typeof result;
    }
    if (result.error) return setError("Não foi possível abrir essa conversa.");
    const rows = (result.data ?? []) as unknown as { role: "user" | "assistant"; content: string; attachments: Attachment[] | null; actions?: Action[] | null }[];
    nearBottom.current = true;
    setActiveId(id);
    setMessages(rows.map((row) => ({ role: row.role, content: row.content, attachments: row.attachments ?? undefined, actions: row.actions ?? undefined })));
    if (closeDrawer) setDrawerOpen(false);
    setError(null);
    setCanRetry(false);
  }

  function newConversation() {
    touched.current = true;
    setActiveId(null);
    setMessages([]);
    setDrawerOpen(false);
    setError(null);
    setCanRetry(false);
    setDraft("");
    inputRef.current?.focus();
  }

  async function renameConversation(id: string) {
    const title = renameValue.replace(/\s+/g, " ").trim().slice(0, 80);
    setRenamingId(null);
    if (!title) return;
    const previous = conversations;
    setConversations((current) => current.map((item) => (item.id === id ? { ...item, title } : item)));
    const { error: renameError } = await supabase.from("chat_conversations").update({ title }).eq("id", id);
    if (renameError) { setConversations(previous); setError("Não foi possível renomear a conversa."); }
  }

  async function deleteConversation(id: string) {
    setConfirmDeleteId(null);
    const { error: deleteError } = await supabase.from("chat_conversations").delete().eq("id", id);
    if (deleteError) return setError("Não foi possível excluir a conversa.");
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeId === id) newConversation();
  }

  /** Grava a mensagem no histórico. Devolve false se não conseguiu (a conversa segue, mas avisamos). */
  async function saveMessage(conversationId: string, message: Message) {
    const base = { conversation_id: conversationId, role: message.role, content: message.content, attachments: message.attachments?.length ? message.attachments : null };
    let result = actionsColumn.current === false || !message.actions?.length
      ? await supabase.from("chat_messages").insert(base)
      : await supabase.from("chat_messages").insert({ ...base, actions: message.actions });
    if (result.error && isMissingColumn(result.error)) {
      actionsColumn.current = false; // schema13.sql ainda não rodou: guarda a mensagem sem os cartões
      result = await supabase.from("chat_messages").insert(base);
    }
    if (result.error) return false;
    const now = new Date().toISOString();
    await supabase.from("chat_conversations").update({ updated_at: now }).eq("id", conversationId);
    setConversations((current) => {
      const found = current.find((item) => item.id === conversationId);
      if (!found) return current;
      return [{ ...found, updated_at: now }, ...current.filter((item) => item.id !== conversationId)];
    });
    return true;
  }

  async function ensureConversation(firstPrompt: string) {
    if (activeRef.current) return activeRef.current;
    const title = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Nova conversa";
    const { data, error: createError } = await supabase.from("chat_conversations").insert({ title, scope }).select("id,title,updated_at").single();
    if (createError || !data) return null; // sem histórico, mas o chat continua funcionando
    activeRef.current = data.id;
    setActiveId(data.id);
    setConversations((current) => [data as Conversation, ...current]);
    return data.id as string;
  }

  async function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (pending.length + textFiles.length + files.length > MAX_FILES) return setError(`Envie até ${MAX_FILES} arquivos por mensagem.`);
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (file.type.startsWith("image/")) {
          const blob = await shrinkImage(file);
          const url = await uploadToStorage(blob, "jpg", blob.type || "image/jpeg");
          setPending((current) => [...current, { url, kind: "image", name: file.name }]);
        } else if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
          if (file.size > MAX_PDF_BYTES) throw new Error("O PDF passa de 20 MB. Envie um arquivo menor.");
          const url = await uploadToStorage(file, "pdf", "application/pdf");
          setPending((current) => [...current, { url, kind: "pdf", name: file.name }]);
        } else if (file.type.startsWith("text/") || /\.(txt|md|csv|tsv)$/.test(lower)) {
          if (file.size > MAX_TEXT_FILE_BYTES) throw new Error("O arquivo de texto é grande demais. Cole o conteúdo na mensagem ou envie em PDF.");
          const text = await file.text();
          setTextFiles((current) => [...current, { name: file.name, text }]);
        } else {
          throw new Error("Esse tipo de arquivo ainda não é aceito. Envie foto, PDF ou texto (.txt, .md, .csv). Para Word ou Excel, salve como PDF.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível anexar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  /** Pede a resposta da assistente para o histórico informado e mostra o resultado (ou o motivo exato da falha). */
  async function requestReply(history: Message[], conversationId: string | null) {
    setLoadingKey(conversationId ?? "__pending__");
    setError(null);
    setCanRetry(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new ApiError("Sua sessão expirou. Entre novamente para continuar.", 401);
      const result = await postJson("/api/chat", { messages: historyForApi(history), today: localDateKey(), scope }, {
        token: session.access_token,
        timeoutMs: 125_000,
        validate: (data) => (typeof data.message === "string" && data.message ? { message: data.message, changed: data.changed === true, actions: Array.isArray(data.actions) ? (data.actions as Action[]) : [] } : null),
      });
      const reply: Message = { role: "assistant", content: result.message, actions: result.actions.length ? result.actions : undefined };
      if (activeRef.current === conversationId || (conversationId === null && activeRef.current === null)) setMessages((current) => [...current, reply]);
      if (result.changed) onChanged?.(); // a tela de planejamento recarrega já, sem esperar o histórico
      if (conversationId && !(await saveMessage(conversationId, reply))) setNotice("A resposta apareceu, mas não consegui salvá-la no histórico.");
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível concluir agora. Tente novamente."));
      setCanRetry(true);
    } finally {
      setLoadingKey(null);
      if (mode !== "bar") inputRef.current?.focus();
    }
  }

  async function sendMessage(text: string) {
    const typed = text.trim();
    if (typed || pending.length || textFiles.length) touched.current = true;
    if ((!typed && !pending.length && !textFiles.length) || isLoading || uploading) return;
    const inlineFiles = textFiles.map((file) => `\n\n[Arquivo: ${file.name}]\n${file.text}`).join("");
    const content = `${typed}${inlineFiles}`.trim();
    const userMessage: Message = { role: "user", content: content || "(arquivo enviado)", attachments: pending.length ? pending : undefined };
    setDraft("");
    setPending([]);
    setTextFiles([]);
    setError(null);
    setNotice(null);
    nearBottom.current = true;
    const nextMessages: Message[] = [...messagesRef.current, userMessage];
    setMessages(nextMessages);
    setLoadingKey("__pending__");
    const conversationId = await ensureConversation(typed || userMessage.content);
    if (conversationId && !(await saveMessage(conversationId, userMessage))) setNotice("Não consegui salvar esta mensagem no histórico.");
    await requestReply(nextMessages, conversationId);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // no celular (teclado na tela) Enter quebra a linha; no computador Enter envia e Shift+Enter quebra a linha
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (event.key === "Enter" && !event.shiftKey && !touch && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  function openTask(action: Action) {
    if (mode === "full") changeMode("inline");
    if (onOpenTask) onOpenTask({ id: action.id, date: action.date });
    else window.location.href = `/planejamento?date=${action.date}&task=${action.id}`;
  }

  const hasStuff = draft.trim() || pending.length || textFiles.length;
  const grouped = useMemo(() => {
    const groups: { label: string; items: Conversation[] }[] = [];
    for (const item of conversations) {
      const label = groupOf(item.updated_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [conversations]);
  const activeTitle = conversations.find((item) => item.id === activeId)?.title;

  if (mode === "bar") {
    return (
      <section className="ac ac-bar" aria-label="Assistente">
        <button type="button" className="ac-bar-open" onClick={() => changeMode("inline")} aria-label="Abrir a assistente">
          <span className="ac-mark" aria-hidden="true"><Sparkles size={16} /></span>
          <span className="ac-bar-text"><strong>Maria</strong> · {copy.barText}</span>
          <ChevronUp size={18} aria-hidden="true" />
        </button>
        <button type="button" className="ac-icon-btn" onClick={() => changeMode("full")} aria-label="Abrir em tela ampla" title="Abrir em tela ampla"><Maximize2 size={17} aria-hidden="true" /></button>
      </section>
    );
  }

  const full = mode === "full";
  return (
    <section className={`ac ${full ? "ac-full" : "ac-inline"}`} aria-label="Assistente de planejamento">
      {full && <div className="ac-backdrop" aria-hidden="true" onClick={() => changeMode("inline")} />}
      <div className="ac-shell" role={full ? "dialog" : undefined} aria-modal={full ? true : undefined} aria-label={full ? "Assistente de planejamento em tela ampla" : undefined}>
        {drawerOpen && <div className="ac-drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <aside className={`ac-drawer${drawerOpen ? " is-open" : ""}`} aria-label="Conversas" aria-hidden={!drawerOpen}>
          <div className="ac-drawer-head">
            <h3>Conversas</h3>
            <button type="button" className="ac-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu" tabIndex={drawerOpen ? 0 : -1}><X size={18} aria-hidden="true" /></button>
          </div>
          <button type="button" className="ac-new" onClick={newConversation} tabIndex={drawerOpen ? 0 : -1}><Plus size={17} aria-hidden="true" /> Nova conversa</button>
          <div className="ac-drawer-list">
            {conversations.length === 0 && <p className="ac-drawer-empty">Suas conversas aparecerão aqui.</p>}
            {grouped.map((group) => (
              <div key={group.label} className="ac-group">
                <h4>{group.label}</h4>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id} className={`ac-conv${item.id === activeId ? " is-active" : ""}`}>
                      {renamingId === item.id ? (
                        <input className="ac-rename" value={renameValue} maxLength={80} autoFocus aria-label="Novo nome da conversa" onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void renameConversation(item.id)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenamingId(null); }} />
                      ) : confirmDeleteId === item.id ? (
                        <div className="ac-confirm" role="alertdialog" aria-label="Confirmar exclusão">
                          <span>Excluir esta conversa?</span>
                          <button type="button" className="ac-danger" onClick={() => void deleteConversation(item.id)}>Excluir</button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <>
                          <button type="button" className="ac-conv-open" aria-current={item.id === activeId ? "true" : undefined} tabIndex={drawerOpen ? 0 : -1} onClick={() => void openConversation(item.id)}>
                            <strong>{item.title}</strong>
                            <small>{formatWhen(item.updated_at)}</small>
                          </button>
                          <div className="ac-conv-actions">
                            <button type="button" aria-label={`Renomear ${item.title}`} title="Renomear" tabIndex={drawerOpen ? 0 : -1} onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }}><Pencil size={14} aria-hidden="true" /></button>
                            <button type="button" aria-label={`Excluir ${item.title}`} title="Excluir" tabIndex={drawerOpen ? 0 : -1} onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={14} aria-hidden="true" /></button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        <header className="ac-head">
          <button type="button" className="ac-icon-btn" onClick={() => setDrawerOpen((open) => !open)} aria-label="Histórico de conversas" aria-expanded={drawerOpen} title="Conversas"><Menu size={20} aria-hidden="true" /></button>
          <span className="ac-mark" aria-hidden="true"><Sparkles size={16} /></span>
          <div className="ac-head-title">
            <span className="eyebrow">{copy.eyebrow}</span>
            <h2>{activeTitle && full ? activeTitle : copy.title}</h2>
          </div>
          <div className="ac-head-actions">
            {full ? (
              <>
                <button type="button" className="ac-icon-btn" onClick={() => changeMode("inline")} aria-label="Reduzir para o tamanho normal" title="Reduzir"><Minimize2 size={18} aria-hidden="true" /></button>
                <button type="button" className="ac-icon-btn" onClick={() => changeMode("bar")} aria-label="Fechar e minimizar a assistente" title="Fechar"><X size={19} aria-hidden="true" /></button>
              </>
            ) : (
              <>
                <button type="button" className="ac-icon-btn" onClick={() => changeMode("bar")} aria-label="Minimizar a assistente" title="Minimizar"><ChevronDown size={19} aria-hidden="true" /></button>
                <button type="button" className="ac-icon-btn" onClick={() => changeMode("full")} aria-label="Ampliar para tela cheia" title="Ampliar"><Maximize2 size={17} aria-hidden="true" /></button>
              </>
            )}
          </div>
        </header>

        <div className="ac-messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions text" onScroll={(event) => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          <div className="ac-thread">
            {messages.length === 0 ? (
              <div className="ac-welcome">
                <span className="ac-mark ac-mark-lg" aria-hidden="true"><Sparkles size={22} /></span>
                <h3>Como posso ajudar sua rotina?</h3>
                <p>{copy.subtitle}</p>
                <div className="ac-starters">
                  {copy.starters.map((starter) => (
                    <button key={starter} type="button" className="ac-starter" disabled={isLoading} onClick={() => void sendMessage(starter)}>{starter}<ArrowUp size={14} aria-hidden="true" /></button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <article key={`${index}-${message.role}`} className={`ac-msg ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                  {message.role === "assistant" && <span className="ac-avatar" aria-hidden="true"><Sparkles size={14} /></span>}
                  <div className="ac-bubble">
                    {message.attachments?.length ? (
                      <div className="ac-files">
                        {message.attachments.map((file) => (
                          file.kind === "image"
                            ? <a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer"><img src={file.url} alt={file.name} /></a>
                            : <a key={file.url} className="ac-pdf" href={file.url} target="_blank" rel="noopener noreferrer"><FileText size={14} aria-hidden="true" /> {file.name}</a>
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" ? <Markdown text={message.content} /> : <div className="ac-usertext">{message.content}</div>}
                    {message.actions?.length ? <div className="ac-cards">{message.actions.map((action) => <TaskActionCard key={`${action.id}-${action.type}`} action={action} onOpen={openTask} />)}</div> : null}
                    <div className="ac-msg-tools"><CopyButton text={message.content} /></div>
                  </div>
                </article>
              ))
            )}
            {isLoading && <div className="ac-msg is-assistant" role="status"><span className="ac-avatar" aria-hidden="true"><Sparkles size={14} /></span><p className="ac-loading"><i /><i /><i /><span>Trabalhando no seu planejamento…</span></p></div>}
          </div>
        </div>

        <div className="ac-composer">
          <div className="ac-thread">
            {error && (
              <div className="ac-error" role="alert">
                <span>{error}</span>
                {canRetry && !isLoading && <button type="button" onClick={() => void requestReply(messagesRef.current, activeRef.current)}>Tentar de novo</button>}
              </div>
            )}
            {notice && !error && <p className="ac-notice" role="status">{notice}</p>}
            {(pending.length > 0 || textFiles.length > 0 || uploading) && (
              <ul className="ac-pending" aria-label="Arquivos para enviar">
                {pending.map((file) => (
                  <li key={file.url}>{file.kind === "image" ? <ImageIcon size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}<span>{file.name}</span><button type="button" aria-label={`Remover ${file.name}`} onClick={() => setPending((current) => current.filter((item) => item.url !== file.url))}><X size={13} aria-hidden="true" /></button></li>
                ))}
                {textFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`}><FileText size={14} aria-hidden="true" /><span>{file.name}</span><button type="button" aria-label={`Remover ${file.name}`} onClick={() => setTextFiles((current) => current.filter((_, i) => i !== index))}><X size={13} aria-hidden="true" /></button></li>
                ))}
                {uploading && <li className="is-uploading">Enviando arquivo…</li>}
              </ul>
            )}
            <form className="ac-form" onSubmit={submit}>
              <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.tsv,text/plain" onChange={(event) => void onPickFiles(event)} />
              <button type="button" className="ac-attach" aria-label="Anexar foto ou arquivo" disabled={isLoading || uploading} onClick={() => fileRef.current?.click()}><Paperclip size={18} aria-hidden="true" /></button>
              <label className="sr-only" htmlFor={`chat-input-${scope}`}>Escreva sua mensagem</label>
              <textarea id={`chat-input-${scope}`} ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={copy.placeholder} rows={1} />
              <button type="submit" className="ac-send" aria-label="Enviar mensagem" disabled={isLoading || uploading || !hasStuff}><ArrowUp size={18} aria-hidden="true" /></button>
            </form>
            <p className="ac-footnote">A conversa e os arquivos são enviados à Anthropic para gerar respostas. A assistente altera o seu planejamento quando você pede.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
