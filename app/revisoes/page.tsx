"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReviewSession, { type SessionSummary } from "@/components/ReviewSession";
import { REVIEW_TABLE_HINT, isMissingTable } from "@/lib/cards-db";
import { type CardStatus, statusOf } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import type { StudyCard } from "@/lib/types";

type Settings = { limit: number; minutes: number; includeUpToDate: boolean; kind: "all" | "flashcard" | "question"; source: string };
const DEFAULTS: Settings = { limit: 20, minutes: 0, includeUpToDate: false, kind: "all", source: "all" };
const STORAGE_KEY = "mednotes.review.settings";

const STATUS_LABEL: Record<CardStatus, string> = { nova: "Nova", revisar: "Para revisar", "em-dia": "Em dia" };

function dueLabel(card: StudyCard) {
  const status = statusOf(card);
  if (status === "nova") return "Nova — ainda não revisada";
  if (status === "revisar") return "Pronta para revisar";
  return `Próxima: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(card.due_at))}`;
}

function sourceKey(card: StudyCard) {
  return card.page_id ?? `titulo:${card.source_title}`;
}

export default function ReviewsPage() {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [filter, setFilter] = useState<"todos" | CardStatus>("todos");
  const [open, setOpen] = useState<string | null>(null);
  const [session, setSession] = useState<StudyCard[] | null>(null);
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSettings({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Settings>) });
    } catch {
      /* usa o padrão */
    }
    void load();
  }, []);

  function update(patch: Partial<Settings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* sem armazenamento local */
      }
      return next;
    });
  }

  async function load() {
    const { data, error: loadError } = await supabase.from("study_cards").select("*").order("created_at", { ascending: false }).limit(2000);
    if (loadError) {
      setError(isMissingTable(loadError) ? REVIEW_TABLE_HINT : "Não foi possível carregar suas revisões agora.");
      setCards([]);
      return;
    }
    setError(null);
    setCards((data ?? []) as StudyCard[]);
  }

  async function remove(card: StudyCard) {
    if (!window.confirm("Excluir este item das Revisões?")) return;
    const { error: deleteError } = await supabase.from("study_cards").delete().eq("id", card.id);
    if (deleteError) return setError("Não foi possível excluir agora.");
    setCards((current) => (current ?? []).filter((item) => item.id !== card.id));
  }

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards ?? []) map.set(sourceKey(card), card.source_title || "Sem página");
    return [...map.entries()];
  }, [cards]);

  const counts = useMemo(() => {
    const result = { nova: 0, revisar: 0, "em-dia": 0 };
    for (const card of cards ?? []) result[statusOf(card)] += 1;
    return result;
  }, [cards]);

  const pool = useMemo(() => {
    return (cards ?? [])
      .filter((card) => (settings.kind === "all" ? true : card.kind === settings.kind))
      .filter((card) => (settings.source === "all" ? true : sourceKey(card) === settings.source))
      .filter((card) => settings.includeUpToDate || statusOf(card) !== "em-dia")
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  }, [cards, settings]);

  const picked = settings.limit > 0 ? pool.slice(0, settings.limit) : pool;
  const visible = (cards ?? []).filter((card) => filter === "todos" || statusOf(card) === filter);

  function start(list: StudyCard[]) {
    if (!list.length) return;
    setSummary(null);
    setTimeLimit(settings.minutes > 0 ? settings.minutes : null);
    setSession(list);
    window.scrollTo({ top: 0 });
  }

  function finish(result: SessionSummary) {
    setSession(null);
    setSummary(result);
    void load();
  }

  if (session) return <ReviewSession cards={session} timeLimitMin={timeLimit} onFinish={finish} />;

  return (
    <div className="rv-page">
      <div className="head">
        <div>
          <span className="eyebrow">MEMÓRIA</span>
          <h1 className="display">Revisões</h1>
        </div>
      </div>
      <p className="muted">Flashcards e questões que a Maria criou a partir das suas páginas, num só lugar para revisar.</p>

      {error && <p className="notice">{error}</p>}

      {summary && (
        <section className="rv-summary" aria-live="polite">
          <h2>{summary.reason === "tempo" ? "⏱ Tempo esgotado" : summary.reason === "completo" ? "✓ Revisão concluída" : "Revisão encerrada"}</h2>
          <p>
            {summary.reviewed} {summary.reviewed === 1 ? "item revisado" : "itens revisados"} · {summary.correct} certos · {summary.wrong} para repetir · {Math.max(1, Math.round(summary.seconds / 60))} min
          </p>
        </section>
      )}

      <div className="rv-counts">
        <div><strong>{counts.revisar}</strong><span>para revisar</span></div>
        <div><strong>{counts.nova}</strong><span>novos</span></div>
        <div><strong>{counts["em-dia"]}</strong><span>em dia</span></div>
      </div>

      {cards && cards.length === 0 && !error && (
        <div className="rv-empty">
          <p>Você ainda não tem itens aqui.</p>
          <p className="muted">Abra uma página, toque em <b>✦ Agente</b> e peça “Crie 8 flashcards desta página”. Depois toque em <b>Salvar em Revisões</b>.</p>
          <Link className="rv-primary" href="/cadernos">Abrir meus cadernos</Link>
        </div>
      )}

      {cards && cards.length > 0 && (
        <>
          <section className="rv-setup" aria-labelledby="rv-setup-title">
            <h2 id="rv-setup-title">Começar uma revisão</h2>
            <div className="rv-fields">
              <label>Quantidade
                <select value={settings.limit} onChange={(e) => update({ limit: Number(e.target.value) })}>
                  <option value={10}>10 itens</option>
                  <option value={20}>20 itens</option>
                  <option value={30}>30 itens</option>
                  <option value={0}>Todos</option>
                </select>
              </label>
              <label>Tempo limite
                <select value={settings.minutes} onChange={(e) => update({ minutes: Number(e.target.value) })}>
                  <option value={0}>Sem limite</option>
                  <option value={5}>5 minutos</option>
                  <option value={10}>10 minutos</option>
                  <option value={20}>20 minutos</option>
                  <option value={30}>30 minutos</option>
                </select>
              </label>
              <label>Tipo
                <select value={settings.kind} onChange={(e) => update({ kind: e.target.value as Settings["kind"] })}>
                  <option value="all">Flashcards e questões</option>
                  <option value="flashcard">Só flashcards</option>
                  <option value="question">Só questões</option>
                </select>
              </label>
              <label>Origem
                <select value={settings.source} onChange={(e) => update({ source: e.target.value })}>
                  <option value="all">Todas as páginas</option>
                  {sources.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                </select>
              </label>
            </div>
            <label className="rv-check">
              <input type="checkbox" checked={settings.includeUpToDate} onChange={(e) => update({ includeUpToDate: e.target.checked })} />
              Incluir itens que ainda estão em dia
            </label>
            <button type="button" className="rv-primary" disabled={!picked.length} onClick={() => start(picked)}>
              {picked.length ? `Começar revisão (${picked.length})` : "Nada para revisar agora"}
            </button>
          </section>

          <section aria-labelledby="rv-list-title">
            <div className="rv-listhead">
              <h2 id="rv-list-title">Todos os itens ({visible.length})</h2>
              <select aria-label="Filtrar por status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="todos">Todos</option>
                <option value="revisar">Para revisar</option>
                <option value="nova">Novos</option>
                <option value="em-dia">Em dia</option>
              </select>
            </div>
            <ul className="rv-list">
              {visible.map((card) => {
                const status = statusOf(card);
                const expanded = open === card.id;
                return (
                  <li key={card.id} className="rv-item">
                    <button type="button" className="rv-item-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : card.id)}>
                      <span className="rv-badges">
                        <span className={`rv-tag ${card.kind}`}>{card.kind === "flashcard" ? "Flashcard" : "Questão"}</span>
                        <span className={`rv-status ${status}`}>{STATUS_LABEL[status]}</span>
                      </span>
                      <span className="rv-item-q">{card.question}</span>
                      <small>{dueLabel(card)}{card.source_title ? ` · ${card.source_title}` : ""}</small>
                    </button>
                    {expanded && (
                      <div className="rv-item-body">
                        {card.options && (
                          <ol className="rv-opts">
                            {card.options.map((option, i) => <li key={i} className={i === card.correct_index ? "ok" : undefined}>{option}{i === card.correct_index ? " ✓" : ""}</li>)}
                          </ol>
                        )}
                        <p><b>Resposta:</b> {card.answer}</p>
                        {card.explanation && <p><b>Explicação:</b> {card.explanation}</p>}
                        <div className="rv-item-actions">
                          <button type="button" className="rv-primary" onClick={() => start([card])}>Revisar este</button>
                          {card.page_id && <Link className="rv-secondary" href={`/p/${card.page_id}`}>Abrir página</Link>}
                          <button type="button" className="rv-secondary danger-text" onClick={() => void remove(card)}>Excluir</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
