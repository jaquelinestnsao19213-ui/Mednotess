"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Message = { role: "user" | "assistant"; content: string };
const STARTERS = ["Organize minha semana", "Crie um planejamento de estudos", "Analise minhas pendências"];

export default function HomeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, loading]);

  async function sendMessage(text: string) {
    const prompt = text.trim();
    if (!prompt || loading) return;
    setDraft("");
    setError(null);
    const nextMessages: Message[] = [...messages, { role: "user", content: prompt }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: nextMessages.slice(-12) }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      setMessages((current) => [...current, { role: "assistant", content: result.message! }]);
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
      <p className="home-chat-footnote">A conversa é enviada à Anthropic para gerar respostas. Nesta etapa, a assistente não lê nem altera seus dados no Mednotes.</p>
    </section>
  );
}
