"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { nextSchedule } from "@/lib/srs";
import type { AnswerRecord, ReviewMode } from "@/lib/review-report";
import type { StudyCard } from "@/lib/types";

export type SessionResult = { answers: AnswerRecord[]; seconds: number; reason: "completo" | "tempo" | "encerrado" };

function shuffled(length: number) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const LETTERS = "ABCDEF";

export default function ReviewSession({
  cards,
  mode,
  timeLimitMin,
  onFinish,
}: {
  cards: StudyCard[];
  mode: ReviewMode;
  timeLimitMin: number | null;
  onFinish: (result: SessionResult) => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // alternativa marcada (índice original)
  const [confirmed, setConfirmed] = useState(false); // depois de confirmar, a resposta fica travada
  const [flipped, setFlipped] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());
  const cardStartedAt = useRef(Date.now());
  const answers = useRef<AnswerRecord[]>([]);
  const finished = useRef(false);

  const card = cards[index];
  const order = useMemo(() => (card?.options ? shuffled(card.options.length) : []), [card?.id, card?.options?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const quiz = mode === "quiz";

  function finish(reason: SessionResult["reason"]) {
    if (finished.current) return;
    finished.current = true;
    onFinish({ answers: answers.current, seconds: Math.round((Date.now() - startedAt.current) / 1000), reason });
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      setElapsed(seconds);
      if (timeLimitMin && seconds >= timeLimitMin * 60) finish("tempo");
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLimitMin]);

  async function record(current: StudyCard, correct: boolean, extra: Pick<AnswerRecord, "chosen" | "correctAnswer" | "chosenNote">) {
    answers.current.push({
      cardId: current.id,
      kind: current.kind,
      question: current.question,
      chosen: extra.chosen,
      correctAnswer: extra.correctAnswer,
      explanation: current.explanation,
      chosenNote: extra.chosenNote,
      topic: current.topic?.trim() || current.source_title?.trim() || "Geral",
      concept: current.concept,
      correct,
      seconds: Math.max(1, Math.round((Date.now() - cardStartedAt.current) / 1000)),
    });
    // mantém a repetição espaçada: acertou volta mais tarde, errou volta logo
    const { error } = await supabase.from("study_cards").update(nextSchedule(current, correct ? 2 : 0)).eq("id", current.id);
    if (error) setSaveError(true);
  }

  function advance() {
    if (index + 1 >= cards.length) return finish("completo");
    setIndex(index + 1);
    setSelected(null);
    setConfirmed(false);
    setFlipped(false);
    cardStartedAt.current = Date.now();
  }

  function confirm() {
    if (!card || selected === null || confirmed || !card.options || card.correct_index === null) return;
    const position = (original: number) => `${LETTERS[order.indexOf(original)]}) ${card.options![original]}`;
    const correct = selected === card.correct_index;
    setConfirmed(true); // trava antes de qualquer espera: não dá para mudar a resposta depois
    void record(card, correct, {
      chosen: position(selected),
      correctAnswer: position(card.correct_index),
      chosenNote: !correct ? card.option_notes?.[selected] || null : null,
    });
  }

  function know(knows: boolean) {
    if (!card || !flipped) return;
    void record(card, knows, { chosen: null, correctAnswer: card.answer, chosenNote: null });
    advance();
  }

  if (!card) return null;
  const isQuestion = quiz && card.kind === "question" && !!card.options && card.correct_index !== null;
  const remaining = timeLimitMin ? Math.max(0, timeLimitMin * 60 - elapsed) : null;
  const correct = confirmed && selected === card.correct_index;
  const last = index + 1 >= cards.length;

  return (
    <section className="rv-session" aria-label={quiz ? "Quiz" : "Flashcards"}>
      <div className="rv-bar">
        <span><b>{index + 1}</b> de {cards.length}</span>
        <span className={remaining !== null && remaining <= 30 ? "rv-timer low" : "rv-timer"} aria-label="Tempo">
          ⏱ {remaining !== null ? clock(remaining) : clock(elapsed)}
        </span>
        <button type="button" className="rv-quit" onClick={() => finish("encerrado")}>Encerrar</button>
      </div>
      <div className="rv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index + (confirmed ? 1 : 0)}>
        <span style={{ width: `${((index + (confirmed ? 1 : 0)) / cards.length) * 100}%` }} />
      </div>

      {isQuestion ? (
        <article className="rv-card">
          <div className="rv-meta">
            <span className="rv-tag question">Questão {index + 1}</span>
            {(card.topic || card.source_title) && <span className="rv-from">{card.topic || card.source_title}</span>}
          </div>
          <p className="rv-question">{card.question}</p>

          <ol className="rv-options">
            {order.map((original, position) => {
              let state = selected === original ? " sel" : "";
              if (confirmed) state = original === card.correct_index ? " ok" : original === selected ? " bad" : " dim";
              return (
                <li key={original}>
                  <button
                    type="button"
                    className={`rv-option${state}`}
                    disabled={confirmed}
                    aria-pressed={selected === original}
                    onClick={() => setSelected(original)}
                  >
                    <b>{LETTERS[position]}</b>
                    <span>{card.options![original]}</span>
                    {confirmed && original === card.correct_index && <i aria-label="correta">✓</i>}
                    {confirmed && original === selected && original !== card.correct_index && <i aria-label="errada">✕</i>}
                  </button>
                </li>
              );
            })}
          </ol>

          {!confirmed ? (
            <button type="button" className="rv-primary rv-wide" disabled={selected === null} onClick={confirm}>
              Confirmar resposta
            </button>
          ) : (
            <div className={`rv-feedback ${correct ? "ok" : "bad"}`} role="status" aria-live="polite">
              <strong>{correct ? "✓ Resposta correta!" : "✕ Resposta incorreta"}</strong>
              <p><b>Gabarito:</b> {LETTERS[order.indexOf(card.correct_index!)]}) {card.answer}</p>
              {card.explanation && <p><b>Por que está correta:</b> {card.explanation}</p>}
              {!correct && selected !== null && (
                <p>
                  <b>Sua resposta ({LETTERS[order.indexOf(selected)]}) está incorreta:</b>{" "}
                  {card.option_notes?.[selected] || "ela não responde ao que o enunciado pede. Compare com o gabarito acima."}
                </p>
              )}
              {card.concept && <p className="rv-concept"><b>Conceito-chave:</b> {card.concept}</p>}
              <button type="button" className="rv-primary rv-wide" onClick={advance}>
                {last ? "Ver resultado" : "Próxima questão"}
              </button>
            </div>
          )}
        </article>
      ) : (
        <>
          <button
            type="button"
            className={`rv-flip${flipped ? " flipped" : ""}`}
            onClick={() => setFlipped((v) => !v)}
            aria-label={flipped ? "Voltar para a pergunta" : "Virar o cartão para ver a resposta"}
          >
            <span className="rv-flip-inner">
              <span className="rv-flip-face front">
                <span className="rv-tag flashcard">Flashcard</span>
                <span className="rv-flip-text">{card.question}</span>
                <small>Toque para virar</small>
              </span>
              <span className="rv-flip-face back">
                <span className="rv-tag question">Resposta</span>
                <span className="rv-flip-text">{card.answer}</span>
                {card.explanation && <small className="rv-flip-note">{card.explanation}</small>}
              </span>
            </span>
          </button>
          {(card.topic || card.source_title) && <p className="rv-from rv-center">{card.topic || card.source_title}</p>}
          <div className={`rv-know${flipped ? "" : " off"}`}>
            <button type="button" className="rv-no" disabled={!flipped} onClick={() => know(false)}>✕ Não sei a resposta</button>
            <button type="button" className="rv-yes" disabled={!flipped} onClick={() => know(true)}>✓ Sei a resposta</button>
          </div>
          {!flipped && <p className="rv-ask rv-center">Vire o cartão para conferir e depois diga se você sabia.</p>}
        </>
      )}
      {saveError && <p className="notice">Não consegui salvar o agendamento de uma das respostas. Confira sua conexão.</p>}
    </section>
  );
}
