"use client";

import { useState } from "react";
import {
  type Report,
  ATTENTION_BELOW,
  attentionTopics,
  formatDuration,
  masteredTopics,
  mistakesOf,
  reportToText,
} from "@/lib/review-report";

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
}: {
  report: Report;
  planLoading?: boolean;
  onRedoMistakes?: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const quiz = report.mode === "quiz";
  const mistakes = mistakesOf(report);
  const mastered = masteredTopics(report);
  const attention = attentionTopics(report);
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.finishedAt));

  async function copy() {
    const ok = await copyText(reportToText(report));
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied(null), 3000);
  }

  return (
    <div className="rp">
      <header className="rp-head">
        <span className="eyebrow">{quiz ? "RESULTADO DO QUIZ" : "RESULTADO DOS FLASHCARDS"}</span>
        <h1 className="display">{report.reason === "tempo" ? "Tempo esgotado" : report.reason === "encerrado" ? "Revisão encerrada" : "Revisão concluída"}</h1>
        <p className="muted">{report.title || "Revisão"} · {when}</p>
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

      <section className="rp-block" aria-labelledby="rp-topics">
        <h2 id="rp-topics">Desempenho por assunto</h2>
        <ul className="rp-topics">
          {report.topics.map((t) => (
            <li key={t.topic}>
              <div><span>{t.topic}</span><b>{t.percent}%</b></div>
              <div className="rp-bar" aria-hidden="true">
                <span className={t.percent >= 80 ? "good" : t.percent >= ATTENTION_BELOW ? "mid" : "low"} style={{ width: `${Math.max(3, t.percent)}%` }} />
              </div>
              <small>{t.correct} de {t.total}</small>
            </li>
          ))}
        </ul>
      </section>

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
        <h2 id="rp-mastered">Conteúdos com bom domínio</h2>
        {mastered.length ? (
          <p className="rp-chips">{mastered.map((t) => <span key={t.topic} className="rp-chip good">{t.topic} · {t.percent}%</span>)}</p>
        ) : (
          <p className="muted">Nenhum assunto chegou a 80% de acerto nesta sessão.</p>
        )}
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
