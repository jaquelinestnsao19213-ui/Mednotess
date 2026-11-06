"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { supabase } from "@/lib/supabase";

type ChatMessage = { role: "user" | "assistant"; content: string; insertText?: string | null };

function pageText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "fileCard") return `[PDF anexado: ${String(node.attrs?.name ?? "arquivo")}]`;
  const parts = (node.content ?? []).map(pageText).filter(Boolean);
  if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem" || node.type === "tableCell" || node.type === "tableHeader") {
    return parts.join("") + "\n";
  }
  return parts.join(node.type === "doc" ? "" : "\n");
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
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
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
      const result = await response.json() as { message?: string; insertText?: string | null; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      setMessages((current) => [...current, { role: "assistant", content: result.message!, insertText: result.insertText ?? null }].slice(-12));
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

  const panel: React.CSSProperties = {
    position: "fixed",
    right: 12,
    bottom: "calc(var(--kb, 0px) + 108px)",
    zIndex: 35,
    width: "min(410px, calc(100vw - 24px))",
    maxHeight: "min(68vh, 620px)",
    display: open ? "flex" : "none",
    flexDirection: "column",
    gap: 12,
    padding: 14,
    color: "var(--ink)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 16,
    boxShadow: "0 12px 40px rgb(0 0 0 / 0.2)",
  };

  return (
    <>
      <section style={panel} aria-label="Chat com assistente da página">
        <header style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
          <span aria-hidden="true" style={{ color: "var(--accent)", fontSize: 22 }}>✦</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Assistente desta página</strong>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Lê o texto do caderno e pode sugerir conteúdo</div>
          </div>
          <button type="button" className="secondary" aria-label="Fechar chat" onClick={() => setOpen(false)} style={{ padding: "4px 9px" }}>×</button>
        </header>
        <div ref={listRef} role="log" aria-live="polite" style={{ display: "grid", gap: 10, minHeight: 100, overflowY: "auto", padding: "2px 1px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {messages.length === 0 ? (
            <p className="muted" style={{ margin: "auto 0", fontSize: 14 }}>Pergunte sobre esta página ou peça um resumo, complemento ou lista de revisão.</p>
          ) : messages.map((message, index) => (
            <div key={`${index}-${message.role}`} style={{ justifySelf: message.role === "user" ? "end" : "stretch", maxWidth: "95%" }}>
              <div style={{ padding: "9px 11px", borderRadius: 12, background: message.role === "user" ? "color-mix(in srgb, var(--accent) 12%, var(--surface))" : "var(--bg)", fontSize: 14, lineHeight: 1.5 }}>{message.content}</div>
              {message.insertText && (
                <button type="button" className="primary" style={{ marginTop: 7, padding: "7px 10px", fontSize: 13 }} onClick={() => { onInsert(message.insertText!); setMessages((current) => current.map((item, i) => i === index ? { ...item, insertText: null } : item)); }}>
                  Inserir sugestão na página
                </button>
              )}
            </div>
          ))}
          {loading && <p className="muted" role="status" style={{ margin: 0 }}>Preparando uma resposta…</p>}
        </div>
        {error && <p role="alert" className="notice" style={{ margin: 0, fontSize: 13 }}>{error}</p>}
        <form onSubmit={submit} style={{ display: "flex", alignItems: "flex-end", gap: 8, border: "1px solid var(--line)", borderRadius: 12, padding: 7 }}>
          <label htmlFor="page-assistant-input" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>Escreva sua mensagem</label>
          <textarea id="page-assistant-input" ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Pergunte ou peça para adicionar algo…" rows={2} maxLength={4_000} disabled={loading} style={{ flex: 1, minWidth: 0, resize: "none", border: 0, outline: 0, background: "transparent", color: "var(--ink)", font: "inherit", fontSize: 14 }} />
          <button type="submit" className="primary" aria-label="Enviar mensagem" disabled={loading || !draft.trim()} style={{ padding: "7px 12px" }}>{loading ? "…" : "↑"}</button>
        </form>
        <small style={{ color: "var(--muted)", fontSize: 11 }}>O conteúdo do caderno é enviado à Anthropic. PDFs anexados não são lidos nesta versão.</small>
      </section>
      <button
        type="button"
        className={open ? "primary" : "secondary"}
        aria-expanded={open}
        aria-label={open ? "Fechar assistente" : "Abrir assistente desta página"}
        onClick={() => { setOpen((value) => !value); if (!open) setTimeout(() => inputRef.current?.focus(), 0); }}
        style={{ position: "fixed", right: 14, bottom: "calc(var(--kb, 0px) + 58px)", zIndex: 36, borderRadius: 999, boxShadow: "0 4px 16px rgb(0 0 0 / 0.18)", fontWeight: 600 }}
      >✦ {open ? "Fechar" : "Agente"}</button>
    </>
  );
}
