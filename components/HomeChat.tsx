"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Markdown from "@/components/Markdown";

type Attachment = { url: string; kind: "image" | "pdf"; name: string };
type Message = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };
type Conversation = { id: string; title: string; updated_at: string };
type Scope = "home" | "planner";

const COPY: Record<Scope, { eyebrow: string; title: string; subtitle: string; starters: string[]; placeholder: string }> = {
  home: {
    eyebrow: "SUA ASSISTENTE DE ESTUDOS",
    title: "Como posso ajudar?",
    subtitle: "Converse sobre seus estudos e sua rotina.",
    starters: ["Organize minha semana", "Crie um planejamento de estudos", "Analise minhas pendências"],
    placeholder: "Escreva um comando ou uma pergunta…",
  },
  planner: {
    eyebrow: "ASSISTENTE DO PLANEJAMENTO",
    title: "Organize sua semana conversando",
    subtitle: "Envie seu planejamento em texto, foto ou PDF e ela preenche a semana para você.",
    starters: ["O que falta fazer esta semana?", "Adicione meu planejamento (vou colar)", "Reorganize os horários de amanhã"],
    placeholder: "Cole seu planejamento ou peça uma mudança…",
  },
};

const MAX_TEXT_FILE_BYTES = 400_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;
const SEND_LIMIT_CHARS = 400_000; // tamanho máximo do histórico enviado à IA

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Últimas mensagens que cabem no limite da API (até 20), sempre começando pela usuária. */
function historyForApi(all: Message[]) {
  const picked: Message[] = [];
  let total = 0;
  for (let i = all.length - 1; i >= 0 && picked.length < 20; i--) {
    const content = all[i].content.slice(0, 200_000);
    if (total + content.length > SEND_LIMIT_CHARS) break;
    total += content.length;
    picked.unshift({ role: all[i].role, content, attachments: all[i].attachments });
  }
  while (picked.length && picked[0].role !== "user") picked.shift();
  return picked;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

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

export default function HomeChat({ scope = "home", onChanged }: { scope?: Scope; onChanged?: () => void }) {
  const copy = COPY[scope];
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [textFiles, setTextFiles] = useState<{ name: string; text: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, loading]);

  // ao abrir: carrega a lista de conversas desta tela e reabre a mais recente
  useEffect(() => {
    void (async () => {
      const { data, error: listError } = await supabase
        .from("chat_conversations")
        .select("id,title,updated_at")
        .eq("scope", scope)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (listError) return; // tabelas/colunas ainda não criadas: o chat funciona, só sem histórico
      const list = (data ?? []) as Conversation[];
      setConversations(list);
      if (list[0]) await openConversation(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function openConversation(id: string) {
    const { data, error: loadError } = await supabase
      .from("chat_messages")
      .select("role,content,attachments")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (loadError) return setError("Não foi possível abrir essa conversa.");
    setActiveId(id);
    setMessages(((data ?? []) as { role: "user" | "assistant"; content: string; attachments: Attachment[] | null }[]).map((row) => ({ role: row.role, content: row.content, attachments: row.attachments ?? undefined })));
    setShowHistory(false);
    setError(null);
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setShowHistory(false);
    setError(null);
    inputRef.current?.focus();
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Apagar esta conversa do histórico?")) return;
    const { error: deleteError } = await supabase.from("chat_conversations").delete().eq("id", id);
    if (deleteError) return setError("Não foi possível apagar a conversa.");
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeId === id) newConversation();
  }

  async function saveMessage(conversationId: string, message: Message) {
    await supabase.from("chat_messages").insert({
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      attachments: message.attachments?.length ? message.attachments : null,
    });
    const now = new Date().toISOString();
    await supabase.from("chat_conversations").update({ updated_at: now }).eq("id", conversationId);
    setConversations((current) => {
      const found = current.find((item) => item.id === conversationId);
      if (!found) return current;
      return [{ ...found, updated_at: now }, ...current.filter((item) => item.id !== conversationId)];
    });
  }

  async function ensureConversation(firstPrompt: string) {
    if (activeId) return activeId;
    const title = firstPrompt.replace(/\s+/g, " ").slice(0, 60) || "Nova conversa";
    const { data, error: createError } = await supabase.from("chat_conversations").insert({ title, scope }).select("id,title,updated_at").single();
    if (createError || !data) return null; // sem histórico, mas o chat continua funcionando
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

  async function sendMessage(text: string) {
    const typed = text.trim();
    if ((!typed && !pending.length && !textFiles.length) || loading || uploading) return;
    const inlineFiles = textFiles.map((file) => `\n\n[Arquivo: ${file.name}]\n${file.text}`).join("");
    const content = `${typed}${inlineFiles}`.trim();
    const userMessage: Message = { role: "user", content: content || "(arquivo enviado)", attachments: pending.length ? pending : undefined };
    setDraft("");
    setPending([]);
    setTextFiles([]);
    setError(null);
    const nextMessages: Message[] = [...messages, userMessage];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const conversationId = await ensureConversation(typed || userMessage.content);
      if (conversationId) await saveMessage(conversationId, userMessage);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: historyForApi(nextMessages), today: localDateKey(), scope }),
      });
      const result = (await response.json()) as { message?: string; error?: string; changed?: boolean };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      const assistantMessage: Message = { role: "assistant", content: result.message };
      setMessages((current) => [...current, assistantMessage]);
      if (conversationId) await saveMessage(conversationId, assistantMessage);
      if (result.changed) onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ocorreu um erro. Tente novamente.");
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

  const hasStuff = draft.trim() || pending.length || textFiles.length;

  return (
    <section className="home-chat" aria-labelledby={`chat-title-${scope}`}>
      <header className="home-chat-header">
        <span className="home-chat-mark" aria-hidden="true">✦</span>
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id={`chat-title-${scope}`}>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <span className="home-chat-provider">Claude</span>
      </header>

      <div className="home-chat-toolbar">
        <button type="button" className="home-chat-tool" onClick={() => setShowHistory((open) => !open)} aria-expanded={showHistory}>
          🕘 Histórico{conversations.length ? ` (${conversations.length})` : ""}
        </button>
        <button type="button" className="home-chat-tool" onClick={newConversation} disabled={loading}>＋ Nova conversa</button>
      </div>

      {showHistory && (
        <ul className="home-chat-history" aria-label="Conversas anteriores">
          {conversations.length === 0 && <li className="home-chat-history-empty">Suas conversas aparecerão aqui.</li>}
          {conversations.map((conversation) => (
            <li key={conversation.id} className={conversation.id === activeId ? "is-active" : undefined}>
              <button type="button" className="home-chat-history-open" onClick={() => void openConversation(conversation.id)}>
                <strong>{conversation.title}</strong>
                <small>{formatWhen(conversation.updated_at)}</small>
              </button>
              <button type="button" className="home-chat-history-delete" aria-label={`Apagar conversa ${conversation.title}`} onClick={() => void deleteConversation(conversation.id)}>×</button>
            </li>
          ))}
        </ul>
      )}

      <div className="home-chat-messages" ref={listRef} role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="home-chat-welcome">
            <p>Comece com um comando ou escolha uma sugestão:</p>
            <div className="home-chat-starters">
              {copy.starters.map((starter) => (
                <button key={starter} type="button" className="home-chat-starter" disabled={loading} onClick={() => void sendMessage(starter)}>
                  {starter}<span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <article key={`${index}-${message.role}`} className={`home-chat-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
              <span className="home-chat-avatar" aria-hidden="true">{message.role === "user" ? "Você" : "✦"}</span>
              <div className="home-chat-bubble">
                {message.attachments?.length ? (
                  <div className="home-chat-files">
                    {message.attachments.map((file) => (
                      file.kind === "image"
                        ? <a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer"><img src={file.url} alt={file.name} /></a>
                        : <a key={file.url} className="home-chat-pdf" href={file.url} target="_blank" rel="noopener noreferrer">📄 {file.name}</a>
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" ? <Markdown text={message.content} /> : <div className="home-chat-usertext">{message.content}</div>}
              </div>
            </article>
          ))
        )}
        {loading && <div className="home-chat-message is-assistant" role="status"><span className="home-chat-avatar" aria-hidden="true">✦</span><p className="home-chat-loading"><i /><i /><i /><span>Preparando uma resposta…</span></p></div>}
      </div>

      {error && <p className="home-chat-error" role="alert">{error}</p>}

      {(pending.length > 0 || textFiles.length > 0 || uploading) && (
        <ul className="home-chat-pending" aria-label="Arquivos para enviar">
          {pending.map((file) => (
            <li key={file.url}>{file.kind === "image" ? "🖼" : "📄"} <span>{file.name}</span><button type="button" aria-label={`Remover ${file.name}`} onClick={() => setPending((current) => current.filter((item) => item.url !== file.url))}>×</button></li>
          ))}
          {textFiles.map((file, index) => (
            <li key={`${file.name}-${index}`}>📝 <span>{file.name}</span><button type="button" aria-label={`Remover ${file.name}`} onClick={() => setTextFiles((current) => current.filter((_, i) => i !== index))}>×</button></li>
          ))}
          {uploading && <li className="is-uploading">Enviando arquivo…</li>}
        </ul>
      )}

      <form className="home-chat-form" onSubmit={submit}>
        <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.tsv,text/plain" onChange={(event) => void onPickFiles(event)} />
        <button type="button" className="home-chat-attach" aria-label="Anexar foto ou arquivo" disabled={loading || uploading} onClick={() => fileRef.current?.click()}>📎</button>
        <label className="sr-only" htmlFor={`chat-input-${scope}`}>Escreva sua mensagem</label>
        <textarea
          id={`chat-input-${scope}`}
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={copy.placeholder}
          rows={1}
          disabled={loading}
        />
        <button type="submit" className="home-chat-send" aria-label="Enviar mensagem" disabled={loading || uploading || !hasStuff}>
          {loading ? <span className="home-chat-spinner" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}
        </button>
      </form>
      <p className="home-chat-footnote">A conversa e os arquivos são enviados à Anthropic para gerar respostas. Quando você pedir, a assistente adiciona atividades ao planejamento e move cadernos entre disciplinas.</p>
    </section>
  );
}
