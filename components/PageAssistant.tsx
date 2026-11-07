"use client";

import { useParams } from "next/navigation";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { supabase } from "@/lib/supabase";
import type { ReviewMaterial } from "@/lib/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  insertText?: string | null;
  reviewItems?: ReviewMaterial[];
  saved?: boolean;
  inserted?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  page_title: string;
  updated_at: string;
};

function pageText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "fileCard") return `[PDF anexado: ${String(node.attrs?.name ?? "arquivo")}]`;
  const parts = (node.content ?? []).map(pageText).filter(Boolean);
  if (["paragraph", "heading", "listItem", "tableCell", "tableHeader"].includes(node.type ?? "")) return parts.join("") + "\n";
  return parts.join(node.type === "doc" ? "" : "\n");
}

function asPlainText(items: ReviewMaterial[]) {
  return items.map((item, index) => {
    const alternatives = item.type === "question" && item.options.length
      ? `\n${item.options.map((option) => `  - ${option}`).join("\n")}`
      : "";
    return `${index + 1}. ${item.title}\nPergunta: ${item.front}${alternatives}\nResposta: ${item.back}${item.explanation ? `\nComentário: ${item.explanation}` : ""}`;
  }).join("\n\n");
}

export default function PageAssistant({
  title,
  content,
  onInsert,
}: {
  title: string;
  content: JSONContent;
  onInsert: (text: string) => void;
}) {
  const params = useParams<{ id?: string }>();
  const pageId = typeof params?.id === "string" ? params.id : null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextText = useMemo(() => pageText(content).trim().slice(0, 20_000), [content]);

  const refreshHistory = useCallback(async () => {
    if (!pageId) return;
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase
      .from("page_assistant_conversations")
      .select("id,title,page_title,updated_at")
      .eq("page_id", pageId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (historyError) {
      setError("Não foi possível carregar o histórico. Confira supabase/page-assistant-history.sql.");
    } else {
      setConversations((data ?? []) as ConversationSummary[]);
    }
    setHistoryLoading(false);
  }, [pageId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  async function persistMessages(id: string, titleText: string, nextMessages: ChatMessage[]) {
    const { error: saveError } = await supabase
      .from("page_assistant_conversations")
      .update({ messages: nextMessages, page_title: title, title: titleText, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (saveError) throw new Error("Não foi possível salvar o histórico da conversa.");
    await refreshHistory();
  }

  async function ensureConversation(firstMessage: string, initialMessages: ChatMessage[]) {
    if (conversationId) return conversationId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !pageId) throw new Error("Faça login para salvar o histórico desta conversa.");
    const { data, error: insertError } = await supabase
      .from("page_assistant_conversations")
      .insert({
        user_id: user.id,
        page_id: pageId,
        page_title: title,
        title: firstMessage.slice(0, 120),
        messages: initialMessages,
      })
      .select("id")
      .single();
    if (insertError || !data) throw new Error("Não foi possível criar o histórico. Confira supabase/page-assistant-history.sql.");
    setConversationId(data.id);
    await refreshHistory();
    return data.id as string;
  }

  async function sendMessage(text: string) {
    const prompt = text.trim();
    if (!prompt || loading) return;
    setDraft("");
    setError(null);
    const next = [...messages, { role: "user" as const, content: prompt }].slice(-30);
    setMessages(next);
    setLoading(true);
    let id: string | null = null;
    try {
      id = await ensureConversation(prompt, next);
      if (id) await persistMessages(id, prompt, next);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          messages: next.map(({ role, content: message }) => ({ role, content: message })).slice(-12),
          pageContext: { title: title.slice(0, 300), text: contextText },
        }),
      });
      const result = await response.json() as { message?: string; insertText?: string | null; reviewItems?: ReviewMaterial[]; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.message,
        insertText: result.insertText ?? null,
        reviewItems: Array.isArray(result.reviewItems) ? result.reviewItems : [],
      };
      const completed = [...next, assistantMessage].slice(-30);
      setMessages(completed);
      if (id) await persistMessages(id, prompt, completed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ocorreu um erro. Tente novamente.");
      if (id) {
        try { await persistMessages(id, prompt, next); } catch { /* keep the original assistant error */ }
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function openConversation(id: string) {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("page_assistant_conversations")
      .select("id,messages")
      .eq("id", id)
      .maybeSingle();
    if (loadError || !data) return setError("Não foi possível abrir esta conversa.");
    const loaded = Array.isArray(data.messages) ? data.messages as ChatMessage[] : [];
    setConversationId(data.id);
    setMessages(loaded.slice(-30));
    setHistoryOpen(false);
  }

  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function saveReviewItems(messageIndex: number) {
    const message = messages[messageIndex];
    if (!pageId || !message?.reviewItems?.length || message.saved || savingIndex !== null) return;
    setSavingIndex(messageIndex);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Sua sessão expirou. Entre novamente para salvar as revisões.");
      setSavingIndex(null);
      return;
    }
    const rows = message.reviewItems.map((item) => ({
      user_id: user.id,
      page_id: pageId,
      page_title: title,
      type: item.type,
      title: item.title,
      front: item.front,
      back: item.back,
      options: item.options,
      correct_answer: item.correct_answer || item.back,
      explanation: item.explanation,
      status: "new",
      last_reviewed_at: null,
      next_review_at: new Date().toISOString(),
    }));
    const { error: saveError } = await supabase.from("study_review_items").insert(rows);
    if (saveError) setError("Não foi possível salvar. Confira se executou supabase/ai-review.sql no Supabase.");
    else {
      const updated = messages.map((item, index) => index === messageIndex ? { ...item, saved: true } : item);
      setMessages(updated);
      if (conversationId) await persistMessages(conversationId, messages.find((item) => item.role === "user")?.content ?? title, updated);
    }
    setSavingIndex(null);
  }

  function insertReviewItems(messageIndex: number) {
    const message = messages[messageIndex];
    if (!message?.reviewItems?.length || message.inserted) return;
    onInsert(asPlainText(message.reviewItems));
    const updated = messages.map((item, index) => index === messageIndex ? { ...item, inserted: true } : item);
    setMessages(updated);
    if (conversationId) void persistMessages(conversationId, title, updated);
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
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <>
      {open && (
        <div className="page-assistant-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="page-assistant-panel" role="dialog" aria-modal="true" aria-labelledby="page-assistant-title">
            <header className="page-assistant-header">
              <span aria-hidden="true" className="page-assistant-icon">✦</span>
              <div className="page-assistant-heading">
                <strong id="page-assistant-title">Assistente desta página</strong>
                <span>Use o conteúdo do caderno para estudar e gerar revisões</span>
              </div>
              <button type="button" className="secondary page-assistant-close" aria-label="Fechar chat" onClick={() => setOpen(false)}>×</button>
            </header>

            <div className="page-assistant-toolbar">
              <button type="button" className="secondary" onClick={startNewConversation}>Nova conversa</button>
              <button type="button" className="secondary" aria-expanded={historyOpen} onClick={() => { setHistoryOpen((value) => !value); if (!historyOpen) void refreshHistory(); }}>Histórico</button>
            </div>
            {historyOpen && (
              <aside className="page-assistant-history" aria-label="Histórico de conversas">
                {historyLoading ? <p>Carregando histórico…</p> : conversations.length === 0 ? <p>Nenhuma conversa salva ainda.</p> : conversations.map((conversation) => (
                  <button type="button" key={conversation.id} className={conversation.id === conversationId ? "page-assistant-history-item active" : "page-assistant-history-item"} onClick={() => void openConversation(conversation.id)}>
                    <strong>{conversation.title}</strong>
                    <small>{new Date(conversation.updated_at).toLocaleString("pt-BR")}</small>
                  </button>
                ))}
              </aside>
            )}

            <div ref={listRef} className="page-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
              {messages.length === 0 ? (
                <p className="page-assistant-empty">Pergunte sobre esta página ou peça flashcards e questões. A IA apresentará os materiais antes de você escolher onde salvá-los.</p>
              ) : messages.map((message, index) => (
                <article key={`${index}-${message.role}`} className={`page-assistant-message ${message.role}`}>
                  <div className="page-assistant-bubble">{message.content}</div>
                  {message.insertText && <button type="button" className="secondary page-assistant-action" onClick={() => onInsert(message.insertText!)}>Inserir sugestão na página</button>}
                  {!!message.reviewItems?.length && (
                    <div className="page-assistant-review-preview">
                      <strong>{message.reviewItems.length} material(is) de revisão gerado(s)</strong>
                      {message.reviewItems.map((item, itemIndex) => (
                        <div className="page-assistant-review-item" key={`${itemIndex}-${item.title}`}>
                          <span className="study-pill">{item.type === "question" ? "Questão" : "Flashcard"}</span>
                          <strong>{item.title}</strong><p>{item.front}</p>
                          {item.type === "question" && item.options.length > 0 && <ul>{item.options.map((option) => <li key={option}>{option}</li>)}</ul>}
                          <details><summary>Ver resposta e comentário</summary><p><b>Resposta:</b> {item.back}</p>{item.explanation && <p><b>Comentário:</b> {item.explanation}</p>}</details>
                        </div>
                      ))}
                      <div className="page-assistant-actions">
                        <button type="button" className="secondary" disabled={message.inserted} onClick={() => insertReviewItems(index)}>{message.inserted ? "Inserido na página" : "Inserir na Página"}</button>
                        <button type="button" className="primary" disabled={message.saved || savingIndex === index} onClick={() => void saveReviewItems(index)}>{message.saved ? "Salvo em Revisões" : savingIndex === index ? "Salvando…" : "Salvar em Revisões"}</button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {loading && <p className="page-assistant-loading" role="status">Preparando uma resposta…</p>}
            </div>

            {error && <p role="alert" className="notice page-assistant-error">{error}</p>}
            <form onSubmit={submit} className="page-assistant-form">
              <label className="sr-only" htmlFor="page-assistant-input">Mensagem para a assistente</label>
              <textarea id="page-assistant-input" ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Peça um resumo, flashcards ou questões…" rows={2} maxLength={4000} />
              <button type="submit" className="primary" aria-label="Enviar mensagem" disabled={loading || !draft.trim()}>{loading ? "…" : "Enviar"}</button>
            </form>
            <small className="page-assistant-footnote">O texto desta página é enviado à assistente. Conversas deste caderno ficam salvas na sua conta. PDFs anexados não são lidos.</small>
          </section>
        </div>
      )}

      <button type="button" className="primary page-assistant-launch" aria-expanded={open} aria-controls="page-assistant-title" onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }}>✦ Assistente</button>
    </>
  );
}
