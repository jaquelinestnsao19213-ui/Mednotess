"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { RATING_LABELS, type Rating, intervalLabel, nextSchedule } from "@/lib/srs";
import type { StudyCard } from "@/lib/types";

export type SessionSummary = { reviewed: number; correct: number; wrong: number; seconds: number; reason: "completo" | "tempo" | "encerrado" };

function shuffled(length: number) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export default function ReviewSession({
  cards,
  timeLimitMin,
  onFinish,
}: {
  cards: StudyCard[];
  timeLimitMin: number | null;
  onFinish: (summary: SessionSummary) => void;
}) {
  const [queue, setQueue] = useState<StudyCard[]>(cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [stats, setStats] = useState({ reviewed: 0, correct: 0, wrong: 0 });
  const [saveError, setSaveError] = useState(false);
  const startedAt = useRef(Date.now());
  const requeued = useRef(new Set<string>());
  const finished = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const card = queue[index];
  const order = useMemo(() => (card?.options ? shuffled(card.options.length) : []), [card?.id, card?.options?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(reason: SessionSummary["reason"], finalStats = stats) {
    if (finished.current) return;
    finished.current = true;
    onFinish({ ...finalStats, seconds: Math.round((Date.now() - startedAt.current) / 1000), reason });
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      setElapsed(seconds);
      if (timeLimitMin && seconds >= timeLimitMin * 60) finish("tempo");
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLimitMin, stats]);

  async function rate(rating: Rating) {
    if (!card) return;
    const patch = nextSchedule(card, rating);
    const nextStats = {
      reviewed: stats.reviewed + 1,
      correct: stats.correct + (rating >= 2 ? 1 : 0),
      wrong: stats.wrong + (rating === 0 ? 1 : 0),
    };
    setStats(nextStats);
    const { error } = await supabase.from("study_cards").update(patch).eq("id", card.id);
    if (error) setSaveError(true);

    let nextQueue = queue;
    if (rating === 0 && !requeued.current.has(card.id)) {
      requeued.current.add(card.id); // errou: o item volta uma vez ao fim desta sessão
      nextQueue = [...queue, { ...card, ...patch }];
      setQueue(nextQueue);
    }
    if (index + 1 >= nextQueue.length) return finish("completo", nextStats);
    setIndex(index + 1);
    setRevealed(false);
    setPicked(null);
  }

  if (!card) return null;
  const isQuestion = card.kind === "question" && card.options && card.correct_index !== null;
  const remaining = timeLimitMin ? Math.max(0, timeLimitMin * 60 - elapsed) : null;
  const correct = picked !== null && picked === card.correct_index;

  return (
    <section className="rv-session" aria-label="Sessão de revisão">
      <div className="rv-bar">
        <span>Item {Math.min(index + 1, queue.length)} de {queue.length}</span>
        <span className={remaining !== null && remaining <= 30 ? "rv-timer low" : "rv-timer"} aria-label="Tempo">
          ⏱ {remaining !== null ? clock(remaining) : clock(elapsed)}
        </span>
        <button type="button" className="rv-quit" onClick={() => finish("encerrado")}>Encerrar</button>
      </div>
      <div className="rv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}>
        <span style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>

      <article className="rv-card">
        <div className="rv-meta">
          <span className={`rv-tag ${card.kind}`}>{card.kind === "flashcard" ? "Flashcard" : "Questão"}</span>
          {card.source_title && <span className="rv-from">{card.source_title}</span>}
        </div>
        <p className="rv-question">{card.question}</p>

        {isQuestion ? (
          <>
            <ol className="rv-options">
              {order.map((original, position) => {
                const state = picked === null ? "" : original === card.correct_index ? " ok" : original === picked ? " bad" : "";
                return (
                  <li key={original}>
                    <button
                      type="button"
                      className={`rv-option${state}`}
                      disabled={picked !== null}
                      onClick={() => { setPicked(original); setRevealed(true); }}
                    >
                      <b>{"ABCDEF"[position]}</b>
                      <span>{card.options![original]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {revealed && (
              <div className="rv-answer" role="status">
                <strong>{correct ? "✓ Você acertou!" : "✗ Resposta correta:"}</strong>
                {!correct && <p>{card.answer}</p>}
                {card.explanation && <p><b>Explicação:</b> {card.explanation}</p>}
                <button type="button" className="rv-primary" onClick={() => void rate(correct ? 2 : 0)}>Continuar</button>
              </div>
            )}
          </>
        ) : !revealed ? (
          <button type="button" className="rv-primary" onClick={() => setRevealed(true)}>Mostrar resposta</button>
        ) : (
          <>
            <div className="rv-answer" role="status">
              <strong>Resposta</strong>
              <p>{card.answer}</p>
              {card.explanation && <p><b>Explicação:</b> {card.explanation}</p>}
            </div>
            <p className="rv-ask">Como foi?</p>
            <div className="rv-rates">
              {([0, 1, 2, 3] as Rating[]).map((rating) => (
                <button key={rating} type="button" className={`rv-rate r${rating}`} onClick={() => void rate(rating)}>
                  {RATING_LABELS[rating]}
                  <small>{intervalLabel(card, rating)}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </article>
      {saveError && <p className="notice">Não consegui salvar uma das respostas. Confira sua conexão.</p>}
    </section>
  );
}
