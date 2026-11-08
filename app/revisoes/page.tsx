"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ReviewReport from "@/components/ReviewReport";
import ReviewSession, { type SessionResult } from "@/components/ReviewSession";
import { sanitizeCards } from "@/lib/cards";
import { REVIEW_TABLE_HINT, isMissingTable, saveCardsToReview } from "@/lib/cards-db";
import { type Report, type ReviewMode, buildReport, formatDuration, mistakesOf } from "@/lib/review-report";
import { type CardStatus, statusOf } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import type { StudyCard } from "@/lib/types";
import { uploadFile } from "@/lib/upload";

type Settings = { limit: number; minutes: number; includeUpToDate: boolean; mode: ReviewMode; source: string };
const DEFAULTS: Settings = { limit: 20, minutes: 0, includeUpToDate: false, mode: "quiz", source: "all" };
const STORAGE_KEY = "mednotes.review.settings.v2";

type PageOption = { id: string; title: string; type: string; icon: string | null };
type AttemptRow = { id: string; mode: ReviewMode; title: string; total: number; correct: number; wrong: number; percent: number; seconds: number; created_at: string };
type View = { name: "home" } | { name: "session"; cards: StudyCard[]; mode: ReviewMode; title: string } | { name: "result"; report: Report; attemptId: string | null; cards: StudyCard[]; planLoading: boolean; warning: string | null } | { name: "attempt"; report: Report; id: string };

const STATUS_LABEL: Record<CardStatus, string> = { nova: "Nova", revisar: "Para revisar", "em-dia": "Em dia" };
const TYPE_LABEL: Record<string, string> = { page: "Página", notebook: "Caderno", lesson: "Aula", diary: "Diário", task: "Tarefa", exam: "Prova" };

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const sourceKey = (card: StudyCard) => card.page_id ?? `titulo:${card.source_title}`;

function dueLabel(card: StudyCard) {
  const status = statusOf(card);
  if (status === "nova") return "Nova — ainda não revisada";
  if (status === "revisar") return "Pronta para revisar";
  return `Próxima: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(card.due_at))}`;
}

async function authToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  return session.access_token;
}

export default function ReviewsPage() {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [tab, setTab] = useState<"praticar" | "historico">("praticar");
  const [view, setView] = useState<View>({ name: "home" });
  const [filter, setFilter] = useState<"todos" | CardStatus>("todos");
  const [open, setOpen] = useState<string | null>(null);

  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);

  // geração por IA
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [genKind, setGenKind] = useState<"question" | "flashcard">("question");
  const [genCount, setGenCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const timeLimit = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSettings({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Settings>) });
    } catch {
      /* usa o padrão */
    }
    void load();
    void loadAttempts();
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

  async function loadAttempts() {
    const { data, error: loadError } = await supabase
      .from("review_attempts")
      .select("id,mode,title,total,correct,wrong,percent,seconds,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (loadError) {
      setAttemptsError(isMissingTable(loadError) ? REVIEW_TABLE_HINT : "Não foi possível carregar o histórico agora.");
      setAttempts([]);
      return;
    }
    setAttemptsError(null);
    setAttempts((data ?? []) as AttemptRow[]);
  }

  async function loadPages() {
    if (pages) return;
    const { data } = await supabase.from("pages").select("id,title,type,icon").order("updated_at", { ascending: false }).limit(300);
    setPages((data ?? []) as PageOption[]);
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

  const wantedKind = settings.mode === "quiz" ? "question" : "flashcard";
  const kindTotals = useMemo(() => ({
    question: (cards ?? []).filter((c) => c.kind === "question" && c.options && c.correct_index !== null).length,
    flashcard: (cards ?? []).filter((c) => c.kind === "flashcard").length,
  }), [cards]);

  const pool = useMemo(() => {
    return (cards ?? [])
      .filter((card) => card.kind === wantedKind && (wantedKind === "flashcard" || (card.options && card.correct_index !== null)))
      .filter((card) => (settings.source === "all" ? true : sourceKey(card) === settings.source))
      .filter((card) => settings.includeUpToDate || statusOf(card) !== "em-dia")
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  }, [cards, settings, wantedKind]);

  const picked = settings.limit > 0 ? pool.slice(0, settings.limit) : pool;
  const visible = (cards ?? []).filter((card) => filter === "todos" || statusOf(card) === filter);

  function start(list: StudyCard[], mode: ReviewMode, title: string) {
    if (!list.length) return;
    timeLimit.current = settings.minutes > 0 ? settings.minutes : null;
    setView({ name: "session", cards: list, mode, title });
    window.scrollTo({ top: 0 });
  }

  async function finishSession(result: SessionResult, sessionCards: StudyCard[], mode: ReviewMode, title: string) {
    if (!result.answers.length) {
      setView({ name: "home" });
      void load();
      return;
    }
    const report = buildReport(result.answers, { mode, title, seconds: result.seconds, reason: result.reason });
    setView({ name: "result", report, attemptId: null, cards: sessionCards, planLoading: true, warning: null });
    window.scrollTo({ top: 0 });
    void load();

    // 1) guarda a tentativa (nunca perde o resultado: ele continua na tela mesmo se falhar)
    let attemptId: string | null = null;
    let warning: string | null = null;
    const { data, error: saveError } = await supabase
      .from("review_attempts")
      .insert({ mode, title: title.slice(0, 200), total: report.total, correct: report.correct, wrong: report.wrong, percent: report.percent, seconds: report.seconds, report })
      .select("id")
      .single();
    if (saveError) warning = isMissingTable(saveError) ? REVIEW_TABLE_HINT : "Não consegui guardar este resultado no histórico.";
    else attemptId = (data as { id: string }).id;
    setView((v) => (v.name === "result" && v.report === report ? { ...v, attemptId, warning } : v));
    void loadAttempts();

    // 2) pede à IA o plano de revisão personalizado e anexa ao relatório
    let withPlan = report;
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authToken()}` },
        body: JSON.stringify({
          action: "plan",
          mode,
          title,
          topics: report.topics,
          mistakes: mistakesOf(report).map(({ question, chosen, correctAnswer, topic, concept }) => ({ question, chosen, correctAnswer, topic, concept })),
        }),
      });
      const payload = (await response.json()) as { plan?: Report["aiPlan"] };
      if (response.ok && payload.plan) {
        withPlan = { ...report, aiPlan: payload.plan };
        if (attemptId) await supabase.from("review_attempts").update({ report: withPlan }).eq("id", attemptId);
      }
    } catch {
      /* fica com o plano local, calculado a partir dos erros */
    }
    setView((v) => (v.name === "result" && v.report === report ? { ...v, report: withPlan, planLoading: false } : v));
  }

  async function openAttempt(id: string) {
    const { data, error: readError } = await supabase.from("review_attempts").select("report").eq("id", id).single();
    if (readError || !data) return setAttemptsError("Não foi possível abrir este relatório.");
    setView({ name: "attempt", report: (data as { report: Report }).report, id });
    window.scrollTo({ top: 0 });
  }

  async function removeAttempt(id: string) {
    if (!window.confirm("Excluir este relatório do histórico?")) return;
    const { error: deleteError } = await supabase.from("review_attempts").delete().eq("id", id);
    if (deleteError) return setAttemptsError("Não foi possível excluir agora.");
    setAttempts((current) => (current ?? []).filter((a) => a.id !== id));
    setView({ name: "home" });
  }

  function redoMistakes(report: Report, sessionCards: StudyCard[]) {
    const wrongIds = new Set(mistakesOf(report).map((a) => a.cardId));
    const list = (cards ?? sessionCards).filter((c) => wrongIds.has(c.id));
    if (!list.length) return setError("Esses itens não estão mais em Revisões.");
    start(list, report.mode, `${report.title} (refazer erros)`);
  }

  async function handlePdf(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setGenError("Envie um arquivo PDF.");
    if (file.size > 20 * 1024 * 1024) return setGenError("O PDF passa de 20 MB.");
    setGenError(null);
    setUploading(true);
    try {
      setPdf({ url: await uploadFile(file), name: file.name });
    } catch {
      setGenError("Não consegui enviar o PDF agora.");
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (generating || (!chosen.length && !pdf)) return;
    setGenerating(true);
    setGenError(null);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authToken()}` },
        body: JSON.stringify({ action: "generate", pageIds: chosen, pdfs: pdf ? [pdf] : [], kind: genKind, count: genCount }),
      });
      const result = (await response.json()) as { cards?: unknown[]; title?: string; pageId?: string | null; error?: string };
      if (!response.ok || !result.cards?.length) throw new Error(result.error ?? "Não foi possível gerar agora.");
      const clean = sanitizeCards(result.cards);
      const title = result.title || pdf?.name || "Revisão";
      const saved = await saveCardsToReview(clean, result.pageId ?? null, title);
      await load();
      const mode: ReviewMode = genKind === "question" ? "quiz" : "flashcards";
      if (!saved.rows.length) throw new Error("Esses itens já estavam em Revisões. Escolha outro material ou outra quantidade.");
      start(saved.rows, mode, title);
    } catch (cause) {
      setGenError(cause instanceof Error ? cause.message : "Não foi possível gerar agora.");
    } finally {
      setGenerating(false);
    }
  }

  /* ---------- telas ---------- */

  if (view.name === "session") {
    return <ReviewSession cards={view.cards} mode={view.mode} timeLimitMin={timeLimit.current} onFinish={(result) => void finishSession(result, view.cards, view.mode, view.title)} />;
  }

  if (view.name === "result") {
    return (
      <>
        {view.warning && <p className="notice">{view.warning}</p>}
        <ReviewReport
          report={view.report}
          planLoading={view.planLoading}
          onRedoMistakes={() => redoMistakes(view.report, view.cards)}
          onBack={() => { setView({ name: "home" }); }}
        />
      </>
    );
  }

  if (view.name === "attempt") {
    return (
      <>
        <ReviewReport report={view.report} onRedoMistakes={() => redoMistakes(view.report, [])} onBack={() => { setView({ name: "home" }); setTab("historico"); }} backLabel="Voltar ao histórico" />
        <p className="rp-footer"><button type="button" className="rv-secondary danger-text" onClick={() => void removeAttempt(view.id)}>Excluir este relatório</button></p>
      </>
    );
  }

  const filteredPages = (pages ?? []).filter((p) => p.title.toLowerCase().includes(pageSearch.trim().toLowerCase()));

  return (
    <div className="rv-page">
      <div className="head">
        <div>
          <span className="eyebrow">MEMÓRIA</span>
          <h1 className="display">Revisões</h1>
        </div>
      </div>

      <div className="rv-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "praticar"} className={tab === "praticar" ? "on" : ""} onClick={() => setTab("praticar")}>Praticar</button>
        <button type="button" role="tab" aria-selected={tab === "historico"} className={tab === "historico" ? "on" : ""} onClick={() => { setTab("historico"); void loadAttempts(); }}>
          Histórico{attempts && attempts.length ? ` (${attempts.length})` : ""}
        </button>
      </div>

      {error && <p className="notice">{error}</p>}

      {tab === "historico" && (
        <section aria-labelledby="rv-hist">
          <h2 id="rv-hist" className="sr-only">Histórico de desempenho</h2>
          {attemptsError && <p className="notice">{attemptsError}</p>}
          {attempts && attempts.length === 0 && !attemptsError && (
            <div className="rv-empty"><p>Nenhum relatório ainda.</p><p className="muted">Termine um quiz ou uma sessão de flashcards e o resultado fica guardado aqui.</p></div>
          )}
          <ul className="rv-list">
            {(attempts ?? []).map((a) => (
              <li key={a.id} className="rv-item">
                <button type="button" className="rh-row" onClick={() => void openAttempt(a.id)}>
                  <span className={`rh-score ${a.percent >= 80 ? "good" : a.percent >= 60 ? "mid" : "low"}`}>{a.percent}%</span>
                  <span className="rh-main">
                    <span className="rv-badges"><span className={`rv-tag ${a.mode === "quiz" ? "question" : "flashcard"}`}>{a.mode === "quiz" ? "Quiz" : "Flashcards"}</span></span>
                    <span className="rv-item-q">{a.title || "Revisão"}</span>
                    <small>{a.correct} certos · {a.wrong} erros · {formatDuration(a.seconds)} · {dateLabel(a.created_at)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "praticar" && (
        <>
          <p className="muted">Quiz e flashcards criados pela IA a partir das suas páginas, aulas e PDFs, com relatório de desempenho no final.</p>

          <div className="rv-counts">
            <div><strong>{counts.revisar}</strong><span>para revisar</span></div>
            <div><strong>{counts.nova}</strong><span>novos</span></div>
            <div><strong>{counts["em-dia"]}</strong><span>em dia</span></div>
          </div>

          <details className="rv-gen" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void loadPages(); }}>
            <summary>✦ Gerar novo quiz ou flashcards com IA</summary>
            <div className="rv-gen-body">
              <div className="rv-fields">
                <label>O que gerar
                  <select value={genKind} onChange={(e) => setGenKind(e.target.value as "question" | "flashcard")}>
                    <option value="question">Quiz (múltipla escolha)</option>
                    <option value="flashcard">Flashcards</option>
                  </select>
                </label>
                <label>Quantidade
                  <select value={genCount} onChange={(e) => setGenCount(Number(e.target.value))}>
                    {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} itens</option>)}
                  </select>
                </label>
              </div>

              <div>
                <p className="rv-sub">Páginas, aulas ou cadernos ({chosen.length} escolhidas, máx. 8)</p>
                <input className="rv-search" type="search" placeholder="Buscar página…" value={pageSearch} onChange={(e) => setPageSearch(e.target.value)} />
                <ul className="rv-pages">
                  {pages === null && <li className="muted">Carregando…</li>}
                  {pages !== null && filteredPages.length === 0 && <li className="muted">Nenhuma página encontrada.</li>}
                  {filteredPages.map((p) => {
                    const on = chosen.includes(p.id);
                    return (
                      <li key={p.id}>
                        <label className={on ? "on" : ""}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!on && chosen.length >= 8}
                            onChange={() => setChosen((current) => (on ? current.filter((id) => id !== p.id) : [...current, p.id]))}
                          />
                          <span>{p.icon ? `${p.icon} ` : ""}{p.title || "Sem título"}</span>
                          <small>{TYPE_LABEL[p.type] ?? p.type}</small>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="rv-hint">PDFs anexados dentro das páginas escolhidas também são lidos pela IA.</p>
              </div>

              <div>
                <p className="rv-sub">Ou envie um PDF</p>
                <input type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(e) => { void handlePdf(e.target.files?.[0]); e.target.value = ""; }} />
                {uploading && <p className="muted">Enviando…</p>}
                {pdf && <p className="rv-pdf">📄 {pdf.name} <button type="button" className="rv-link" onClick={() => setPdf(null)}>remover</button></p>}
              </div>

              {genError && <p className="notice">{genError}</p>}
              <button type="button" className="rv-primary" disabled={generating || uploading || (!chosen.length && !pdf)} onClick={() => void generate()}>
                {generating ? "A IA está criando… (pode levar até 1 min)" : "Gerar e começar"}
              </button>
            </div>
          </details>

          {cards && cards.length === 0 && !error && (
            <div className="rv-empty">
              <p>Você ainda não tem itens aqui.</p>
              <p className="muted">Abra <b>Gerar novo quiz ou flashcards com IA</b> acima, ou abra uma página, toque em <b>✦ Agente</b> e peça “Crie 8 flashcards desta página”.</p>
              <Link className="rv-primary" href="/cadernos">Abrir meus cadernos</Link>
            </div>
          )}

          {cards && cards.length > 0 && (
            <>
              <section className="rv-setup" aria-labelledby="rv-setup-title">
                <h2 id="rv-setup-title">Começar uma revisão</h2>
                <div className="rv-modes" role="radiogroup" aria-label="Tipo de revisão">
                  <button type="button" role="radio" aria-checked={settings.mode === "quiz"} className={settings.mode === "quiz" ? "on" : ""} onClick={() => update({ mode: "quiz" })}>
                    <b>Quiz</b><small>{kindTotals.question} questões</small>
                  </button>
                  <button type="button" role="radio" aria-checked={settings.mode === "flashcards"} className={settings.mode === "flashcards" ? "on" : ""} onClick={() => update({ mode: "flashcards" })}>
                    <b>Flashcards</b><small>{kindTotals.flashcard} cartões</small>
                  </button>
                </div>
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
                <button type="button" className="rv-primary" disabled={!picked.length} onClick={() => start(picked, settings.mode, settings.source === "all" ? "Todas as páginas" : sources.find(([k]) => k === settings.source)?.[1] ?? "Revisão")}>
                  {picked.length ? `Começar ${settings.mode === "quiz" ? "quiz" : "flashcards"} (${picked.length})` : "Nada para revisar agora"}
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
                            {card.topic && <span className="rv-status">{card.topic}</span>}
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
                              <button type="button" className="rv-primary" onClick={() => start([card], card.kind === "question" ? "quiz" : "flashcards", card.source_title || "Revisão")}>Revisar este</button>
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
        </>
      )}
    </div>
  );
}
