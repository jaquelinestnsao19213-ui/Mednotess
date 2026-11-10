"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ApiError, errorMessage, postJson } from "@/lib/api";
import {
  type AnswerLite, type MasteryStatus, type SubjectStat, type TaggedAnswer, type TopicMastery,
  RETENTION_DAYS, STATUS_TEXT, bySubject, formatDuration, monthlySeries, studyStreak, tagRetention, topicMastery, totalsOf,
} from "@/lib/mastery";
import { makeSubjectResolver } from "@/lib/subject-resolver";
import { fromDateKey, toDateKey } from "@/lib/exam-plan";

const PALETTE = ["#0f766e", "#3156a4", "#7550a4", "#c2410c", "#be185d", "#4d7c0f", "#0369a1"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
const SETUP_HINT = "Para ver o painel, rode schema10.sql e schema11.sql no Supabase (SQL Editor → Run). Depois é só voltar aqui.";

type CardInfo = { id: string; page_id: string | null; topic: string | null; due_at: string };
type SubjectRow = { id: string; name: string; color: string | null; notebook_page_id: string | null };
type Loaded = {
  answers: AnswerLite[];
  cards: CardInfo[];
  subjects: SubjectRow[];
  resolverInput: Parameters<typeof makeSubjectResolver>[0];
  exams: { title: string; exam_date: string }[];
};

/** Lê todas as linhas de uma tabela em páginas de 1000 (limite do Supabase). */
async function fetchAll<T>(table: string, columns: string, max = 20_000): Promise<{ rows: T[]; error: { code?: string; message?: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("created_at", { ascending: true, nullsFirst: true }).range(from, from + 999);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

async function loadAll(): Promise<{ data: Loaded | null; setup: boolean }> {
  const answers = await fetchAll<AnswerLite>("review_answers", "attempt_id,card_id,topic,topic_key,correct,seconds,created_at");
  if (answers.error) return { data: null, setup: true };
  const [cards, subjects, topics, links, pages, exams] = await Promise.all([
    fetchAll<CardInfo>("study_cards", "id,page_id,topic,due_at,created_at"),
    supabase.from("subjects").select("id,name,color,notebook_page_id").order("position"),
    supabase.from("topics").select("id,subject_id,name,page_id"),
    supabase.from("topic_pages").select("topic_id,page_id"), // pode não existir (schema15): então só ignoramos
    fetchAll<{ id: string; parent_id: string | null }>("pages", "id,parent_id,created_at"),
    supabase.from("study_exams").select("title,exam_date"), // pode não existir (schema18)
  ]);
  const subjectRows = (subjects.data ?? []) as SubjectRow[];
  return {
    setup: false,
    data: {
      answers: answers.rows,
      cards: cards.rows,
      subjects: subjectRows,
      resolverInput: {
        subjects: subjectRows,
        topics: (topics.data ?? []) as { id: string; subject_id: string; name: string; page_id: string | null }[],
        links: links.error ? [] : ((links.data ?? []) as { topic_id: string; page_id: string }[]),
        pages: pages.rows,
        cards: cards.rows,
      },
      exams: exams.error ? [] : ((exams.data ?? []) as { title: string; exam_date: string }[]),
    },
  };
}

/* ---------- gráficos (SVG simples, sem biblioteca) ---------- */

function AreaChart({ points, color }: { points: { label: string; percent: number; total: number }[]; color: string }) {
  const W = 320, H = 150, L = 28, R = 8, T = 10, B = 24;
  if (points.length < 2) {
    return (
      <p className="pf-empty">
        {points.length === 1 ? `Só há respostas em ${points[0].label}. A linha de evolução aparece a partir do segundo mês.` : "Sem respostas nesse recorte ainda."}
      </p>
    );
  }
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (p: number) => T + ((100 - p) * (H - T - B)) / 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const step = Math.ceil(points.length / 6);
  return (
    <svg className="pf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Aproveitamento por mês">
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="#e3e7ec" strokeWidth="1" />
          <text x={L - 5} y={y(g) + 3} textAnchor="end" className="pf-axis">{g}</text>
        </g>
      ))}
      <path d={area} fill={color} opacity=".14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.percent)} r="3.2" fill="#fff" stroke={color} strokeWidth="2"><title>{`${p.label}: ${p.percent}% (${p.total} respostas)`}</title></circle>
          {i % step === 0 && <text x={x(i)} y={H - 7} textAnchor="middle" className="pf-axis">{p.label}</text>}
        </g>
      ))}
    </svg>
  );
}

function Donut({ slices }: { slices: { id: string; name: string; color: string; value: number }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 44, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="pf-donut" viewBox="0 0 120 120" role="img" aria-label="Tempo em revisões por disciplina">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#eef1f4" strokeWidth="16" />
      {slices.map((s) => {
        const len = (s.value / total) * c;
        const el = <circle key={s.id} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{s.name}</title></circle>;
        offset += len;
        return el;
      })}
      <text x="60" y="58" textAnchor="middle" className="pf-donut-num">{formatDuration(total)}</text>
      <text x="60" y="73" textAnchor="middle" className="pf-axis">em revisões</text>
    </svg>
  );
}

const STATUS_CLASS: Record<MasteryStatus, string> = { "poucos-dados": "is-few", aprendendo: "is-learning", dominado: "is-mastered", reforco: "is-weak" };

type InsightState = { summary: string; next: string[] };
const INSIGHT_KEY = "mednotes-painel-insight-v1";

export default function PerformanceDashboard() {
  const [state, setState] = useState<{ loading: boolean; setup: boolean; data: Loaded | null; failed: boolean }>({ loading: true, setup: false, data: null, failed: false });
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [tab, setTab] = useState<"reforco" | "erros" | "dominado" | "aparente">("reforco");
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [insight, setInsight] = useState<InsightState | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  useEffect(() => {
    loadAll().then(({ data, setup }) => setState({ loading: false, setup, data, failed: false })).catch(() => setState({ loading: false, setup: false, data: null, failed: true }));
  }, []);

  const model = useMemo(() => {
    const data = state.data;
    if (!data) return null;
    const tagged = tagRetention(data.answers);
    const resolve = makeSubjectResolver(data.resolverInput);
    const subjectOf = (a: TaggedAnswer) => resolve(a);
    const subjects = data.subjects.map((s, i) => ({ id: s.id, name: s.name, color: s.color || PALETTE[i % PALETTE.length] }));
    const subjectStats: SubjectStat[] = bySubject(tagged, subjectOf, subjects);
    const topics = topicMastery(tagged);
    return { tagged, subjectOf, subjects, subjectStats, topics, totals: totalsOf(tagged), streak: studyStreak(tagged), data };
  }, [state.data]);

  // evolução mensal do recorte escolhido
  const chart = useMemo(() => {
    if (!model) return { points: [], color: PALETTE[0] };
    const rows = subjectFilter === "all" ? model.tagged : model.tagged.filter((a) => model.subjectOf(a) === subjectFilter);
    const color = model.subjects.find((s) => s.id === subjectFilter)?.color ?? PALETTE[0];
    return { points: monthlySeries(rows).map((p) => ({ label: monthLabel(p.month), percent: p.percent, total: p.total })), color };
  }, [model, subjectFilter]);

  const lists = useMemo(() => {
    const topics = model?.topics ?? [];
    const byWrong = [...topics].filter((t) => t.wrong > 0).sort((a, b) => b.wrong - a.wrong || a.percent - b.percent);
    return {
      reforco: topics.filter((t) => t.status === "reforco").sort((a, b) => a.percent - b.percent),
      erros: byWrong,
      dominado: topics.filter((t) => t.status === "dominado").sort((a, b) => b.total - a.total),
      aparente: topics.filter((t) => t.apparent).sort((a, b) => b.percent - a.percent),
    };
  }, [model]);

  // calendário: revisões que vencem em cada dia (as atrasadas contam em hoje) e datas de prova
  const calendar = useMemo(() => {
    if (!model) return null;
    const today = toDateKey(new Date());
    const due = new Map<string, number>();
    for (const card of model.data.cards) {
      let key = toDateKey(new Date(card.due_at));
      if (key < today) key = today;
      due.set(key, (due.get(key) ?? 0) + 1);
    }
    const exams = new Map(model.data.exams.map((e) => [e.exam_date, e.title]));
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= days; d++) cells.push(toDateKey(new Date(month.getFullYear(), month.getMonth(), d)));
    return { today, due, exams, cells };
  }, [model, month]);

  const generateInsight = async () => {
    if (!model) return;
    setInsightBusy(true);
    setInsightError(null);
    const payload = {
      totals: model.totals,
      subjects: model.subjectStats.map((s) => ({ name: s.name, total: s.total, percent: s.percent, retentionTotal: s.retentionTotal, retentionPercent: s.retentionPercent })),
      topics: [...model.topics].sort((a, b) => b.total - a.total).slice(0, 40).map((t) => ({ topic: t.topic, status: t.status, total: t.total, percent: t.percent, retentionTotal: t.retentionTotal, retentionPercent: t.retentionPercent, apparent: t.apparent })),
      months: monthlySeries(model.tagged).slice(-12),
    };
    const signature = JSON.stringify(payload);
    try {
      const cached = JSON.parse(localStorage.getItem(INSIGHT_KEY) ?? "null") as { sig: string; insight: InsightState } | null;
      if (cached && cached.sig === signature) { setInsight(cached.insight); setInsightBusy(false); return; }
    } catch { /* sem cache: segue para a IA */ }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new ApiError("Sua sessão expirou. Entre novamente para continuar.", 401);
      const result = await postJson<InsightState>("/api/dashboard/insight", payload, {
        token: session.access_token,
        timeoutMs: 60_000,
        validate: (d) => {
          const i = d.insight as InsightState | undefined;
          return i && typeof i.summary === "string" && Array.isArray(i.next) ? i : null;
        },
      });
      setInsight(result);
      try { localStorage.setItem(INSIGHT_KEY, JSON.stringify({ sig: signature, insight: result })); } catch { /* sem armazenamento: tudo bem */ }
    } catch (cause) {
      setInsightError(errorMessage(cause, "Não foi possível gerar a análise agora."));
    } finally {
      setInsightBusy(false);
    }
  };

  if (state.loading) return <main className="shell"><p className="muted">Carregando seu desempenho…</p></main>;
  if (state.setup) return <main className="shell pf-page"><h1 className="display">Desempenho</h1><p className="notice">{SETUP_HINT}</p></main>;
  if (state.failed || !model) return <main className="shell pf-page"><h1 className="display">Desempenho</h1><p className="notice">Não foi possível carregar seus dados agora. Tente de novo em instantes.</p></main>;

  const { totals, subjectStats, streak } = model;
  const timeSlices = subjectStats.filter((s) => s.seconds > 0).map((s) => ({ id: s.id, name: s.name, color: s.color, value: s.seconds }));
  const empty = totals.total === 0;
  const activeList: TopicMastery[] = lists[tab];
  const unclassified = model.tagged.filter((a) => !model.subjectOf(a)).length;

  const TABS = [
    { id: "reforco", label: "Reforço" },
    { id: "erros", label: "Mais erros" },
    { id: "dominado", label: "Dominados" },
    { id: "aparente", label: "Domínio aparente" },
  ] as const;
  const EMPTY_TEXT: Record<typeof tab, string> = {
    reforco: "Nenhum assunto com dificuldade persistente por enquanto.",
    erros: "Ainda não há erros registrados.",
    dominado: `Nenhum assunto com acertos mantidos depois de ${RETENTION_DAYS} dias ou mais, em pelo menos 2 revisões. Isso aparece com o tempo.`,
    aparente: "Nenhum assunto nessa situação agora.",
  };

  return (
    <main className="shell pf-page">
      <header className="pf-head">
        <div>
          <span className="eyebrow">EVOLUÇÃO AO LONGO DO TEMPO</span>
          <h1 className="display">Desempenho</h1>
        </div>
        <Link href="/revisoes" className="text-link">Ir para Revisões →</Link>
      </header>

      {empty ? (
        <section className="pf-card pf-empty-card">
          <strong>Seu painel começa com a primeira revisão.</strong>
          <p>Quando você responder quizzes ou flashcards em Revisões, os números aparecem aqui, sem dados de exemplo.</p>
          <Link href="/revisoes" className="welcome-action">Abrir Revisões</Link>
        </section>
      ) : (
        <>
          <section className="pf-kpis" aria-label="Resumo">
            <div className="pf-kpi pf-kpi-main"><span>Aproveitamento</span><strong>{totals.percent}%</strong><small>{totals.total} respostas</small></div>
            <div className="pf-kpi"><span>Retenção ({RETENTION_DAYS}+ dias)</span><strong>{totals.retentionPercent === null ? "—" : `${totals.retentionPercent}%`}</strong><small>{totals.retentionTotal ? `${totals.retentionTotal} respostas` : "ainda sem revisões espaçadas"}</small></div>
            <div className="pf-kpi"><span>Tempo em revisões</span><strong>{formatDuration(totals.seconds)}</strong><small>só quizzes e flashcards</small></div>
            <div className="pf-kpi"><span>Dias seguidos</span><strong>{streak}</strong><small>{streak ? "com revisões" : "estude hoje para começar"}</small></div>
          </section>

          <section className="pf-card">
            <div className="pf-card-head"><h2>Evolução mensal</h2><span className="pf-sub">% de acertos por mês</span></div>
            <div className="pf-chips" role="tablist" aria-label="Disciplina">
              <button className={subjectFilter === "all" ? "on" : ""} onClick={() => setSubjectFilter("all")}>Geral</button>
              {subjectStats.map((s) => <button key={s.id} className={subjectFilter === s.id ? "on" : ""} onClick={() => setSubjectFilter(s.id)}>{s.name}</button>)}
            </div>
            <AreaChart points={chart.points} color={chart.color} />
          </section>

          <div className="pf-two">
            <section className="pf-card">
              <div className="pf-card-head"><h2>Aproveitamento por disciplina</h2></div>
              {subjectStats.length ? (
                <ul className="pf-bars">
                  {[...subjectStats].sort((a, b) => b.percent - a.percent).map((s) => (
                    <li key={s.id}>
                      <div className="pf-bar-top"><span>{s.name}</span><b>{s.percent}%</b></div>
                      <div className="pf-track"><i style={{ width: `${s.percent}%`, background: s.color }} /></div>
                      <small>{s.total} respostas · retenção {s.retentionPercent === null ? "sem dados" : `${s.retentionPercent}% (${s.retentionTotal})`}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="pf-empty">As respostas ainda não estão ligadas a nenhuma disciplina. Vincule os cadernos ou assuntos em Disciplinas.</p>}
              {unclassified > 0 && subjectStats.length > 0 && <p className="pf-note">{unclassified} respostas sem disciplina identificada entram só nos totais gerais.</p>}
            </section>

            <section className="pf-card">
              <div className="pf-card-head"><h2>Tempo por disciplina</h2><span className="pf-sub">em revisões</span></div>
              {timeSlices.length ? (
                <div className="pf-donut-wrap">
                  <Donut slices={timeSlices} />
                  <ul className="pf-legend">
                    {timeSlices.map((s) => <li key={s.id}><i style={{ background: s.color }} /><span>{s.name}</span><b>{formatDuration(s.value)}</b></li>)}
                  </ul>
                </div>
              ) : <p className="pf-empty">O tempo é registrado a cada revisão feita. Ainda não há duração por disciplina.</p>}
            </section>
          </div>

          <section className="pf-card">
            <div className="pf-card-head"><h2>Assuntos</h2><span className="pf-sub">domínio só vale com retenção</span></div>
            <div className="pf-chips">
              {TABS.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label} <em>{lists[t.id].length}</em></button>)}
            </div>
            {activeList.length ? (
              <ul className="pf-topics">
                {activeList.slice(0, 8).map((t) => (
                  <li key={t.key}>
                    <div className="pf-topic-main"><strong>{t.topic}</strong><span className={`pf-badge ${STATUS_CLASS[t.status]}`}>{t.apparent ? "Domínio aparente" : STATUS_TEXT[t.status]}</span></div>
                    <small>
                      {t.percent}% de acerto em {t.total} respostas · {t.wrong} {t.wrong === 1 ? "erro" : "erros"}
                      {" · "}{t.retentionPercent === null ? `sem revisão após ${RETENTION_DAYS}+ dias` : `retenção ${t.retentionPercent}% (${t.retentionTotal})`}
                    </small>
                  </li>
                ))}
              </ul>
            ) : <p className="pf-empty">{EMPTY_TEXT[tab]}</p>}
            <p className="pf-note">Dominado = acertos mantidos em revisões feitas {RETENTION_DAYS}+ dias depois (mínimo de 2). Acertar várias vezes na mesma semana é só domínio aparente.</p>
          </section>

          {calendar && (
            <section className="pf-card">
              <div className="pf-card-head">
                <h2>Revisões agendadas</h2>
                <div className="pf-cal-nav">
                  <button aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
                  <span>{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(month)}</span>
                  <button aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
                </div>
              </div>
              <div className="pf-cal">
                {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <b key={i}>{d}</b>)}
                {calendar.cells.map((key, i) => {
                  if (!key) return <span key={`e${i}`} />;
                  const count = calendar.due.get(key) ?? 0;
                  const exam = calendar.exams.get(key);
                  const cls = ["pf-day", key === calendar.today ? "is-today" : "", exam ? "is-exam" : "", count ? "has-due" : ""].join(" ");
                  return (
                    <span key={key} className={cls} title={[count ? `${count} para revisar` : "", exam ?? ""].filter(Boolean).join(" · ") || undefined}>
                      {fromDateKey(key).getDate()}
                      {count > 0 && <small>{count}</small>}
                    </span>
                  );
                })}
              </div>
              <p className="pf-note">Número no dia = itens de Revisões que vencem nele (os atrasados contam em hoje). Contorno roxo = avaliação cadastrada.</p>
            </section>
          )}

          <section className="pf-card pf-ai">
            <div className="pf-card-head"><h2>Análise da Maria</h2><span className="pf-sub">gerada a partir dos números acima</span></div>
            {insight ? (
              <>
                <p className="pf-ai-text">{insight.summary}</p>
                {insight.next.length > 0 && <ul className="pf-next">{insight.next.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              </>
            ) : <p className="pf-empty">{totals.total < 5 ? "Com pelo menos 5 respostas já dá para gerar uma análise." : "A análise compara aproveitamento e retenção, sem inventar conteúdo que não esteja nos seus dados."}</p>}
            {insightError && <p className="notice">{insightError}</p>}
            <button className="pf-ai-btn" onClick={generateInsight} disabled={insightBusy || totals.total < 5}>{insightBusy ? "Analisando…" : insight ? "Gerar de novo" : "Gerar análise"}</button>
          </section>
        </>
      )}
    </main>
  );
}
