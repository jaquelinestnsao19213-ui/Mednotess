"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Message = { role: "user" | "assistant"; content: string };
type Conversation = { id: string; title: string; updated_at: string };

const STARTERS = ["Organize minha semana", "Crie um planejamento de estudos", "Analise minhas pendências"];
const SEND_LIMIT_CHARS = 24_000; // tamanho máximo do histórico enviado à IA

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Últimas mensagens que cabem no limite da API (até 12 mensagens), sempre terminando na da usuária. */
function historyForApi(all: Message[]) {
  const picked: Message[] = [];
  let total = 0;
  for (let i = all.length - 1; i >= 0 && picked.length < 12; i--) {
    const content = all[i].content.slice(0, 4_000);
    if (total + content.length > SEND_LIMIT_CHARS) break;
    total += content.length;
    picked.unshift({ role: all[i].role, content });
  }
  while (picked.length && picked[0].role !== "user") picked.shift(); // a conversa precisa começar com a usuária
  return picked;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function HomeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, loading]);

  // ao abrir: carrega a lista de conversas e reabre a mais recente
  useEffect(() => {
    void (async () => {
      const { data, error: listError } = await supabase
        .from("chat_conversations")
        .select("id,title,updated_at")
        .order("updated_at", { ascending: false })
        .limit(30);
      if (listError) return; // tabelas ainda não criadas: o chat funciona, só sem histórico
      const list = (data ?? []) as Conversation[];
      setConversations(list);
      if (list[0]) await openConversation(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConversation(id: string) {
    const { data, error: loadError } = await supabase
      .from("chat_messages")
      .select("role,content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (loadError) return setError("Não foi possível abrir essa conversa.");
    setActiveId(id);
    setMessages((data ?? []) as Message[]);
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
    await supabase.from("chat_messages").insert({ conversation_id: conversationId, role: message.role, content: message.content });
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
    const title = firstPrompt.replace(/\s+/g, " ").slice(0, 60);
    const { data, error: createError } = await supabase.from("chat_conversations").insert({ title }).select("id,title,updated_at").single();
    if (createError || !data) return null; // sem histórico, mas o chat continua funcionando
    setActiveId(data.id);
    setConversations((current) => [data as Conversation, ...current]);
    return data.id as string;
  }

  async function sendMessage(text: string) {
    const prompt = text.trim();
    if (!prompt || loading) return;
    setDraft("");
    setError(null);
    const userMessage: Message = { role: "user", content: prompt };
    const nextMessages: Message[] = [...messages, userMessage];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const conversationId = await ensureConversation(prompt);
      if (conversationId) await saveMessage(conversationId, userMessage);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: historyForApi(nextMessages), today: localDateKey() }),
      });
      const result = (await response.json()) as { message?: string; error?: string; changed?: boolean };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      const assistantMessage: Message = { role: "assistant", content: result.message };
      setMessages((current) => [...current, assistantMessage]);
      if (conversationId) await saveMessage(conversationId, assistantMessage);
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
      if (draft.trim() && !loading) void sendMessage(draft);
    }
  }

  return (
    <section className="home-chat" aria-labelledby="home-chat-title">
      <header className="home-chat-header">
        <span className="home-chat-mark" aria-hidden="true">✦</span>
        <div>
          <span className="eyebrow">SUA ASSISTENTE DE ESTUDOS</span>
          <h2 id="home-chat-title">Como posso ajudar?</h2>
          <p>Converse sobre seus estudos e sua rotina.</p>
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
              {STARTERS.map((starter) => (
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
              <p>{message.content}</p>
            </article>
          ))
        )}
        {loading && <div className="home-chat-message is-assistant" role="status"><span className="home-chat-avatar" aria-hidden="true">✦</span><p className="home-chat-loading"><i /><i /><i /><span>Preparando uma resposta…</span></p></div>}
      </div>

      {error && <p className="home-chat-error" role="alert">{error}</p>}
      <form className="home-chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="home-chat-input">Escreva sua mensagem</label>
        <textarea
          id="home-chat-input"
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escreva um comando ou uma pergunta…"
          rows={1}
          maxLength={4_000}
          disabled={loading}
        />
        <button type="submit" aria-label="Enviar mensagem" disabled={loading || !draft.trim()}>
          {loading ? <span className="home-chat-spinner" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}
        </button>
      </form>
      <p className="home-chat-footnote">A conversa é enviada à Anthropic para gerar respostas. Quando você pedir, a assistente pode adicionar atividades ao planejamento e mover cadernos entre disciplinas.</p>
    </section>
  );
}
