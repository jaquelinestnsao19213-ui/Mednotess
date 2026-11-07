"use client";

import { useParams } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
    const heading = `${index + 1}. ${item.title}`;
    const question = `Pergunta: ${item.front}`;
    const alternatives = item.type === "question" && item.options.length
      ? `\n${item.options.map((option) => `  - ${option}`).join("\n")}`
      : "";
    return `${heading}\n${question}${alternatives}\nResposta: ${item.back}${item.explanation ? `\nComentário: ${item.explanation}` : ""}`;
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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextText = useMemo(() => pageText(content).trim().slice(0, 20_000), [content]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  async function sendMessage(text: string) {
    const prompt = text.trim();
    if (!prompt || loading) return;
    setDraft("");
    setError(null);
    const next = [...messages, { role: "user" as const, content: prompt }].slice(-12);
    setMessages(next);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          messages: next.map(({ role, content: message }) => ({ role, content: message })),
          pageContext: { title: title.slice(0, 300), text: contextText },
        }),
      });
      const result = await response.json() as { message?: string; insertText?: string | null; reviewItems?: ReviewMaterial[]; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: result.message!,
        insertText: result.insertText ?? null,
        reviewItems: Array.isArray(result.reviewItems) ? result.reviewItems : [],
      }].slice(-12));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ocorreu um erro. Tente novamente.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
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
      correct_answer: item.correct_answer,
      explanation: item.explanation,
      status: "new",
      last_reviewed_at: null,
      next_review_at: new Date().toISOString(),
    }));
    const { error: saveError } = await supabase.from("study_review_items").insert(rows);
    if (saveError) {
      setError("Não foi possível salvar. Confira se executou supabase/ai-review.sql no Supabase.");
    } else {
      setMessages((current) => current.map((item, index) => index === messageIndex ? { ...item, saved: true } : item));
    }
    setSavingIndex(null);
  }

  function insertReviewItems(messageIndex: number) {
    const message = messages[messageIndex];
    if (!message?.reviewItems?.length || message.inserted) return;
    onInsert(asPlainText(message.reviewItems));
    setMessages((current) => current.map((item, index) => index === messageIndex ? { ...item, inserted: true } : item));
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

            <div ref={listRef} className="page-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
              {messages.length === 0 ? (
                <p className="page-assistant-empty">Pergunte sobre esta página ou peça flashcards e questões. A IA apresentará os materiais antes de você escolher onde salvá-los.</p>
              ) : messages.map((message, index) => (
                <article key={`${index}-${message.role}`} className={`page-assistant-message ${message.role}`}>
                  <div className="page-assistant-bubble">{message.content}</div>
                  {message.insertText && (
                    <button type="button" className="secondary page-assistant-action" onClick={() => onInsert(message.insertText!)}>
                      Inserir sugestão na página
                    </button>
                  )}
                  {!!message.reviewItems?.length && (
                    <div className="page-assistant-review-preview">
                      <strong>{message.reviewItems.length} material(is) de revisão gerado(s)</strong>
                      {message.reviewItems.map((item, itemIndex) => (
                        <div className="page-assistant-review-item" key={`${itemIndex}-${item.title}`}>
                          <span className="study-pill">{item.type === "question" ? "Questão" : "Flashcard"}</span>
                          <strong>{item.title}</strong>
                          <p>{item.front}</p>
                          {item.type === "question" && item.options.length > 0 && (
                            <ul>{item.options.map((option) => <li key={option}>{option}</li>)}</ul>
                          )}
                          <details><summary>Ver resposta e comentário</summary><p><b>Resposta:</b> {item.back}</p>{item.explanation && <p><b>Comentário:</b> {item.explanation}</p>}</details>
                        </div>
                      ))}
                      <div className="page-assistant-actions">
                        <button type="button" className="secondary" disabled={message.inserted} onClick={() => insertReviewItems(index)}>
                          {message.inserted ? "Inserido na página" : "Inserir na Página"}
                        </button>
                        <button type="button" className="primary" disabled={message.saved || savingIndex === index} onClick={() => void saveReviewItems(index)}>
                          {message.saved ? "Salvo em Revisões" : savingIndex === index ? "Salvando…" : "Salvar em Revisões"}
                        </button>
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
              <textarea
                id="page-assistant-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Peça um resumo, flashcards ou questões…"
                rows={2}
                maxLength={4000}
              />
              <button type="submit" className="primary" aria-label="Enviar mensagem" disabled={loading || !draft.trim()}>{loading ? "…" : "Enviar"}</button>
            </form>
            <small className="page-assistant-footnote">O texto desta página é enviado à assistente para responder. PDFs anexados não são lidos.</small>
          </section>
        </div>
      )}

      <button
        type="button"
        className="primary page-assistant-launch"
        aria-expanded={open}
        aria-controls="page-assistant-title"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >✦ Assistente</button>
    </>
  );
}
