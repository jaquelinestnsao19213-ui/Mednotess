"use client";

import { useState } from "react";
import type { TopicEvolution } from "@/lib/progress";
import {
  type Difficulty,
  type Report,
  ATTENTION_BELOW,
  DIFFICULTY_LABEL,
  TREND_LABEL,
  attentionTopics,
  formatDuration,
  knownOf,
  masteredTopics,
  mistakesOf,
  reportToText,
  situationOf,
  weakFocusOf,
} from "@/lib/review-report";

export type FocusRequest = { kind: "question" | "flashcard"; count: number };
const COUNTS = [5, 10, 15, 20];
const barClass = (percent: number) => (percent >= 80 ? "good" : percent >= ATTENTION_BELOW ? "mid" : "low");

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // alternativa para navegadores que bloqueiam a área de transferência
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

export default function ReviewReport({
  report,
  planLoading,
  onRedoMistakes,
  onBack,
  backLabel = "Voltar às revisões",
  evolution = [],
  onFocus,
  focusBusy = false,
  focusError = null,
  focusDifficulty = 1,
}: {
  report: Report;
  planLoading?: boolean;
  onRedoMistakes?: () => void;
  onBack: () => void;
  backLabel?: string;
  evolution?: TopicEvolution[];
  onFocus?: (request: FocusRequest) => void;
  focusBusy?: boolean;
  focusError?: string | null;
  focusDifficulty?: Difficulty;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusKind, setFocusKind] = useState<"question" | "flashcard">(report.mode === "quiz" ? "question" : "flashcard");
  const [focusCount, setFocusCount] = useState(10);
  const quiz = report.mode === "quiz";
  const mistakes = mistakesOf(report);
  const known = knownOf(report);
  const weak = weakFocusOf(report);
  const mastered = masteredTopics(report);
  const attention = attentionTopics(report);
  const evolved = evolution.filter((e) => e.points.length >= 2);
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.finishedAt));

  async function copy() {
    const ok = await copyText(reportToText(report, evolution));
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied(null), 3000);
  }

  return (
    <div className="rp">
      <header className="rp-head">
        <span className="eyebrow">{quiz ? "RESULTADO DO QUIZ" : "RESULTADO DOS FLASHCARDS"}</span>
        <h1 className="display">{report.reason === "tempo" ? "Tempo esgotado" : report.reason === "encerrado" ? "Revisão encerrada" : "Revisão concluída"}</h1>
        <p className="muted">{report.title || "Revisão"} · {when}</p>
        {report.focus && <p className="rp-chips"><span className="rp-chip rev">Pontos fracos · nível {DIFFICULTY_LABEL[report.focus.difficulty].toLowerCase()}</span></p>}
      </header>

      <section className="rp-score" aria-label="Resumo geral">
        <div className={`rp-ring ${report.percent >= 80 ? "good" : report.percent >= ATTENTION_BELOW ? "mid" : "low"}`}>
          <strong>{report.percent}%</strong>
          <span>aproveitamento</span>
        </div>
        <dl className="rp-stats">
          <div><dt>{quiz ? "Respondidas" : "Revisados"}</dt><dd>{report.total}</dd></div>
          <div><dt>{quiz ? "Acertos" : "Sei"}</dt><dd className="ok">{report.correct}</dd></div>
          <div><dt>{quiz ? "Erros" : "Não sei"}</dt><dd className="bad">{report.wrong}</dd></div>
          <div><dt>Tempo</dt><dd>{formatDuration(report.seconds)}</dd></div>
        </dl>
      </section>

      <div className="rp-actions">
        <button type="button" className="rv-primary" onClick={() => void copy()}>
          {copied === "ok" ? "✓ Relatório copiado" : "Copiar relatório"}
        </button>
        {onRedoMistakes && mistakes.length > 0 && (
          <button type="button" className="rv-secondary" onClick={onRedoMistakes}>Refazer só os erros ({mistakes.length})</button>
        )}
        <button type="button" className="rv-secondary" onClick={onBack}>{backLabel}</button>
      </div>
      {copied === "fail" && <p className="notice">Não consegui copiar automaticamente. Selecione o texto do relatório e copie manualmente.</p>}
      <p className="rp-hint">Cole o relatório numa conversa com a IA para pedir uma revisão direcionada só aos seus erros.</p>

      {onFocus && weak.length > 0 && (
        <section className="rp-focus" aria-labelledby="rp-focus-title">
          <h2 id="rp-focus-title">Reforce o que ainda não fixou</h2>
          <p className="rp-chips">{weak.map((t) => <span key={t.topic} className="rp-chip rev">{t.topic} · {t.percent}%</span>)}</p>
          {!focusOpen ? (
            <button type="button" className="rv-primary rp-focus-btn" onClick={() => setFocusOpen(true)}>Revisar meus pontos fracos</button>
          ) : (
            <div className="rp-focus-form">
              <p className="rp-focus-note">Questões novas, só sobre esses assuntos, no nível <b>{DIFFICULTY_LABEL[focusDifficulty].toLowerCase()}</b>, feitas a partir do seu material original.</p>
              <div className="rp-seg" role="radiogroup" aria-label="Tipo de atividade">
                <button type="button" role="radio" aria-checked={focusKind === "question"} className={focusKind === "question" ? "on" : ""} disabled={focusBusy} onClick={() => setFocusKind("question")}>Quiz</button>
                <button type="button" role="radio" aria-checked={focusKind === "flashcard"} className={focusKind === "flashcard" ? "on" : ""} disabled={focusBusy} onClick={() => setFocusKind("flashcard")}>Flashcards</button>
              </div>
              <div className="rp-seg" role="radiogroup" aria-label="Quantidade de itens">
                {COUNTS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={focusCount === n} className={focusCount === n ? "on" : ""} disabled={focusBusy} onClick={() => setFocusCount(n)}>{n}</button>
                ))}
              </div>
              <button type="button" className="rv-primary rp-focus-btn" disabled={focusBusy} onClick={() => onFocus({ kind: focusKind, count: focusCount })}>
                {focusBusy ? "A IA está criando… (até 1 min)" : `Gerar ${focusCount} ${focusKind === "question" ? "questões" : "flashcards"}`}
              </button>
            </div>
          )}
          {focusError && <p className="notice" role="alert">{focusError}</p>}
        </section>
      )}

      <section className="rp-block" aria-labelledby="rp-topics">
        <h2 id="rp-topics">Desempenho por assunto</h2>
        <ul className="rp-topics">
          {report.topics.map((t) => (
            <li key={t.topic}>
              <div><span>{t.topic}</span><b>{t.percent}%</b></div>
              <div className="rp-bar" aria-hidden="true">
                <span className={barClass(t.percent)} style={{ width: `${Math.max(3, t.percent)}%` }} />
              </div>
              <small>{t.correct} de {t.total} · <span className={`rp-sit ${situationOf(t) === "Poucos dados" ? "few" : barClass(t.percent)}`}>{situationOf(t)}</span></small>
            </li>
          ))}
        </ul>
      </section>

      {evolved.length > 0 && (
        <section className="rp-block" aria-labelledby="rp-evo">
          <h2 id="rp-evo">Evolução por assunto</h2>
          <ul className="rp-evo">
            {evolved.map((e) => (
              <li key={e.key}>
                <span>{e.topic}</span>
                <b>{e.points.map((p) => `${p.percent}%`).join(" → ")}</b>
                <span className={`rp-trend ${e.trend}`}>{e.trend === "insuficiente" ? "poucos dados" : TREND_LABEL[e.trend]}{e.confirmed ? " · bom desempenho confirmado" : ""}</span>
              </li>
            ))}
          </ul>
          <p className="muted rp-hint">Cada número é uma atividade diferente. Um resultado isolado não prova domínio: a evolução só é comparada entre atividades com pelo menos 2 respostas no assunto.</p>
        </section>
      )}

      {!quiz && (
        <section className="rp-block" aria-labelledby="rp-known">
          <h2 id="rp-known">Cartões que você sabe ({known.length})</h2>
          {!known.length ? (
            <p className="muted">Nenhum cartão foi marcado como conhecido nesta sessão.</p>
          ) : (
            <details>
              <summary>Ver cartões conhecidos</summary>
              <ul className="rp-list">{known.map((a) => <li key={a.cardId + a.question}>{a.question.length > 110 ? `${a.question.slice(0, 110)}…` : a.question}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <section className="rp-block" aria-labelledby="rp-mistakes">
        <h2 id="rp-mistakes">{quiz ? `Análise dos erros (${mistakes.length})` : `Cartões para revisar (${mistakes.length})`}</h2>
        {!mistakes.length && <p className="muted">Nenhum erro nesta sessão. Ótimo trabalho!</p>}
        <ol className="rp-mistakes">
          {mistakes.map((a) => (
            <li key={a.cardId + a.question} className="rp-mistake">
              <p className="rp-q">{a.question}</p>
              {quiz && a.chosen && <p className="rp-line bad"><b>Sua resposta:</b> {a.chosen}</p>}
              <p className="rp-line ok"><b>{quiz ? "Gabarito" : "Resposta"}:</b> {a.correctAnswer}</p>
              {a.explanation && <p className="rp-line"><b>Explicação:</b> {a.explanation}</p>}
              {quiz && a.chosenNote && <p className="rp-line"><b>Por que a sua alternativa está errada:</b> {a.chosenNote}</p>}
              <p className="rp-chips">
                <span className="rp-chip">{a.topic}</span>
                <span className="rp-chip rev">Revisar: {a.concept || a.topic}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rp-block" aria-labelledby="rp-mastered">
        <h2 id="rp-mastered">Bom desempenho nesta sessão</h2>
        {mastered.length ? (
          <p className="rp-chips">{mastered.map((t) => <span key={t.topic} className="rp-chip good">{t.topic} · {t.percent}%</span>)}</p>
        ) : (
          <p className="muted">Nenhum assunto chegou a 80% de acerto nesta sessão.</p>
        )}
        <p className="muted rp-hint">Uma única sessão não comprova domínio definitivo; o acompanhamento confirma isso ao longo das revisões.</p>
      </section>

      <section className="rp-block" aria-labelledby="rp-plan">
        <h2 id="rp-plan">Plano de revisão</h2>
        {planLoading && <p className="muted">A IA está montando o seu plano personalizado…</p>}
        {report.aiPlan?.summary && <p>{report.aiPlan.summary}</p>}
        <h3>Estudar de novo</h3>
        {report.aiPlan?.priorities.length ? (
          <ul className="rp-list">
            {report.aiPlan.priorities.map((p) => <li key={p.topic}><b>{p.topic}:</b> {p.focus}</li>)}
          </ul>
        ) : attention.length ? (
          <ul className="rp-list">{attention.map((t) => <li key={t.topic}><b>{t.topic}</b> ({t.percent}%)</li>)}</ul>
        ) : (
          <p className="muted">Nada urgente. Continue com revisões espaçadas.</p>
        )}
        {mistakes.length > 0 && (
          <>
            <h3>Refazer</h3>
            <ul className="rp-list">{mistakes.map((a) => <li key={a.cardId + a.question}>{a.question.length > 110 ? `${a.question.slice(0, 110)}…` : a.question}</li>)}</ul>
          </>
        )}
        {report.aiPlan?.strengths.length ? (
          <>
            <h3>Já dominado</h3>
            <ul className="rp-list">{report.aiPlan.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
