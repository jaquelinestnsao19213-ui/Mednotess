"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { StudyReviewItem } from "@/lib/types";

export default function ReviewsPage() {
  const [items, setItems] = useState<StudyReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "flashcard" | "question">("all");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: resultError } = await supabase
        .from("study_review_items")
        .select("*")
        .order("next_review_at", { ascending: true })
        .order("created_at", { ascending: false });
      if (!active) return;
      if (resultError) setError("Não foi possível carregar Revisões. Execute supabase/ai-review.sql no projeto Supabase.");
      else setItems((data ?? []) as StudyReviewItem[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  async function markReviewed(item: StudyReviewItem, correct: boolean) {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + (correct ? 3 : 1));
    const patch = {
      status: "review" as const,
      last_reviewed_at: now.toISOString(),
      next_review_at: next.toISOString(),
      updated_at: now.toISOString(),
    };
    const { error: updateError } = await supabase.from("study_review_items").update(patch).eq("id", item.id);
    if (updateError) setError("Não foi possível salvar o resultado da revisão.");
    else {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...patch } : row));
      setRevealed((current) => ({ ...current, [item.id]: true }));
    }
    setBusyId(null);
  }

  const filtered = useMemo(() => items.filter((item) => filter === "all" || item.type === filter), [items, filter]);
  const dueItems = items.filter((item) => new Date(item.next_review_at).getTime() <= Date.now()).length;

  return (
    <div className="shell review-page">
      <nav className="crumbs" aria-label="Caminho"><Link href="/">Meu Espaço</Link><span className="sep">/</span><span>Revisões</span></nav>
      <div className="head">
        <div><span className="eyebrow">SEU BANCO DE ESTUDOS</span><h1 className="display">Revisões</h1></div>
        <Link className="secondary" href="/">Voltar ao Meu Espaço</Link>
      </div>
      <p className="muted">{items.length} material(is) salvo(s) · {dueItems} para revisar agora</p>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="study-toggle review-filters" aria-label="Filtrar materiais">
        <button type="button" className={filter === "all" ? "chip on" : "chip"} onClick={() => setFilter("all")}>Todos</button>
        <button type="button" className={filter === "flashcard" ? "chip on" : "chip"} onClick={() => setFilter("flashcard")}>Flashcards</button>
        <button type="button" className={filter === "question" ? "chip on" : "chip"} onClick={() => setFilter("question")}>Questões</button>
      </div>
      {loading ? <p className="muted">Carregando…</p> : filtered.length === 0 ? (
        <div className="study-empty"><strong>Nenhum material salvo ainda.</strong><span>Peça flashcards ou questões à assistente dentro de um caderno e use “Salvar em Revisões”.</span></div>
      ) : (
        <div className="study-grid">
          {filtered.map((item) => {
            const show = !!revealed[item.id];
            const selectedAnswer = selected[item.id];
            const isCorrect = item.type === "question" && selectedAnswer === item.correct_answer;
            return (
              <article className="study-card" key={item.id}>
                <div className="study-card-head">
                  <span className="study-pill">{item.type === "question" ? "Questão" : "Flashcard"}</span>
                  <small>{item.status === "new" ? "Novo" : "Em revisão"}</small>
                </div>
                <h2>{item.title}</h2>
                <p><strong>Origem:</strong> <Link href={item.page_id ? `/p/${item.page_id}` : "/cadernos"}>{item.page_title || "Caderno removido"}</Link></p>
                <p className="study-prompt">{item.front}</p>
                {item.type === "question" && item.options?.length > 0 && (
                  <div className="study-options">
                    {item.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={selectedAnswer === option ? "study-option selected" : "study-option"}
                        disabled={show || busyId === item.id}
                        onClick={() => {
                          setSelected((current) => ({ ...current, [item.id]: option }));
                          setRevealed((current) => ({ ...current, [item.id]: true }));
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {item.type === "flashcard" && !show && (
                  <button type="button" className="secondary" onClick={() => setRevealed((current) => ({ ...current, [item.id]: true }))}>Revelar resposta</button>
                )}
                {show && (
                  <div className="study-answer-box">
                    <strong>{item.type === "question" ? (isCorrect ? "Resposta correta" : "Confira a resposta") : "Resposta"}</strong>
                    <p>{item.back}</p>
                    {item.explanation && <p><strong>Comentário:</strong> {item.explanation}</p>}
                    <div className="study-actions">
                      <button type="button" className="primary" disabled={busyId === item.id} onClick={() => void markReviewed(item, item.type === "question" ? isCorrect : true)}>
                        {busyId === item.id ? "Salvando…" : "Acertei"}
                      </button>
                      <button type="button" className="secondary" disabled={busyId === item.id} onClick={() => void markReviewed(item, false)}>Preciso revisar</button>
                    </div>
                    <small>Próxima revisão: {new Date(item.next_review_at).toLocaleDateString("pt-BR")}</small>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
