"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { StudyExam, Subject, Topic, TopicLink } from "@/lib/types";
import {
  type CardLite, type TopicCoverage, STATUS_LABEL, PLAN_LABEL,
  buildPlan, coverageFor, daysUntil, fromDateKey, readiness, toDateKey,
} from "@/lib/exam-plan";
import "../avaliacoes.css";

const KINDS = ["Prova", "Simulado oficial", "Prova prática", "Seminário", "Outra"];
const SETUP_HINT = "Para ativar a Central de Avaliações, rode o arquivo schema18.sql no Supabase (SQL Editor → Run).";
const isMissingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /study_exams/i.test(e.message ?? ""));

const fmtLong = (key: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(fromDateKey(key));
const fmtShort = (key: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).format(fromDateKey(key)).replace(".", "");

type Form = { id: string | null; title: string; kind: string; exam_date: string; topic_ids: string[] };
type Note = { id: string; title: string };

function Ring({ value }: { value: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg className="av-ring" viewBox="0 0 120 120" role="img" aria-label={`Prontidão ${value}%`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" className="av-ring-num">{value}%</text>
      <text x="60" y="76" textAnchor="middle" className="av-ring-lbl">prontidão</text>
    </svg>
  );
}

export default function AvaliacoesPage() {
  const [ready, setReady] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [links, setLinks] = useState<TopicLink[]>([]);
  const [cards, setCards] = useState<CardLite[]>([]);
  const [exams, setExams] = useState<StudyExam[]>([]);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = toDateKey(new Date());

  const load = useCallback(async () => {
    const ex = await supabase.from("study_exams").select("*").order("exam_date");
    if (ex.error) {
      if (isMissingTable(ex.error)) setSetupNeeded(true); else setError("Não foi possível carregar as avaliações.");
      setReady(true);
      return;
    }
    setExams((ex.data ?? []) as StudyExam[]);

    const [s, t, l] = await Promise.all([
      supabase.from("subjects").select("*").order("position"),
      supabase.from("topics").select("*").order("position"),
      supabase.from("topic_links").select("*"),
    ]);
    setSubjects((s.data ?? []) as Subject[]);
    setTopics((t.data ?? []) as Topic[]);
    setLinks(l.error ? [] : ((l.data ?? []) as TopicLink[]));

    const all: CardLite[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data } = await supabase
        .from("study_cards")
        .select("id,page_id,topic,kind,due_at,interval_days,reps,lapses,last_reviewed_at")
        .range(from, from + 999);
      all.push(...((data ?? []) as CardLite[]));
      if ((data ?? []).length < 1000) break;
    }
    setCards(all);

    const ids = [...new Set([...(t.data ?? []).map((x: Topic) => x.page_id), ...(l.data ?? []).map((x: TopicLink) => x.page_id)].filter((x): x is string => !!x))];
    const map = new Map<string, Note>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("pages").select("id,title").in("id", ids.slice(i, i + 100));
      for (const p of (data ?? []) as Note[]) map.set(p.id, p);
    }
    setNotes(map);
    setReady(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // prova selecionada: a próxima que ainda não passou, ou a mais recente
  const current = useMemo(() => {
    if (!exams.length) return null;
    return exams.find((e) => e.id === selected)
      ?? exams.find((e) => e.exam_date >= today)
      ?? exams[exams.length - 1];
  }, [exams, selected, today]);

  const subjectOf = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const coverage: TopicCoverage[] = useMemo(() => {
    if (!current) return [];
    const wanted = new Set(current.topic_ids);
    return topics.filter((t) => wanted.has(t.id)).map((t) => {
      const pageIds = [t.page_id, ...links.filter((l) => l.topic_id === t.id).map((l) => l.page_id)].filter((x): x is string => !!x);
      return coverageFor(t, [...new Set(pageIds)], cards);
    });
  }, [current, topics, links, cards]);

  const score = readiness(coverage);
  const daysLeft = current ? daysUntil(current.exam_date, today) : 0;
  const plan = useMemo(
    () => (current ? buildPlan(coverage.map((c) => ({ id: c.topic.id, name: c.topic.name, score: c.score })), current.exam_date, today) : []),
    [current, coverage, today],
  );
  const todayItems = plan.filter((p) => p.date === today);
  const nextItems = todayItems.length ? todayItems : plan.slice(0, 1);
  const dueTotal = coverage.reduce((n, c) => n + c.due, 0);
  const gaps = coverage.filter((c) => c.status === "sem-notas" || c.status === "sem-cards" || c.status === "nao-estudado");
  const bySubject = useMemo(() => {
    const groups = new Map<string, TopicCoverage[]>();
    for (const c of coverage) groups.set(c.topic.subject_id, [...(groups.get(c.topic.subject_id) ?? []), c]);
    return [...groups.entries()];
  }, [coverage]);
  const weeks = useMemo(() => {
    const result = new Map<string, typeof plan>();
    for (const item of plan) {
      const d = fromDateKey(item.date);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = toDateKey(d);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return [...result.entries()];
  }, [plan]);

  /* ---------- ações ---------- */

  const openNew = () => setForm({ id: null, title: "", kind: "Prova", exam_date: "", topic_ids: [] });
  const openEdit = (e: StudyExam) => setForm({ id: e.id, title: e.title, kind: e.kind, exam_date: e.exam_date, topic_ids: e.topic_ids });

  async function save() {
    if (!form || !form.title.trim() || !form.exam_date) return;
    setBusy(true);
    setMessage(null);
    const payload = { title: form.title.trim(), kind: form.kind, exam_date: form.exam_date, topic_ids: form.topic_ids };
    const res = form.id
      ? await supabase.from("study_exams").update(payload).eq("id", form.id).select().single()
      : await supabase.from("study_exams").insert(payload).select().single();
    setBusy(false);
    if (res.error) { setMessage("Não foi possível salvar a avaliação. Tente de novo."); return; }
    setForm(null);
    setSelected((res.data as StudyExam).id);
    await load();
  }

  async function remove(e: StudyExam) {
    if (!confirm(`Excluir a avaliação “${e.title}”? Suas anotações e revisões não são apagadas.`)) return;
    const { error: err } = await supabase.from("study_exams").delete().eq("id", e.id);
    if (err) { setMessage("Não foi possível excluir."); return; }
    setSelected(null);
    await load();
  }

  async function sendToPlanner() {
    if (!current || !plan.length) return;
    if (current.planned_at && !confirm("Este cronograma já foi enviado ao Planejamento. Enviar de novo cria tarefas repetidas. Continuar?")) return;
    setBusy(true);
    setMessage(null);
    const byId = new Map(topics.map((t) => [t.id, t]));
    const rows = plan.map((item) => {
      const topic = item.topicId ? byId.get(item.topicId) : null;
      return {
        title: `${item.title} · ${current.title}`.slice(0, 200),
        subject_id: topic?.subject_id ?? null,
        topic: topic?.name ?? null,
        time_label: "Dia todo",
        scheduled_date: item.date,
      };
    });
    const { error: err } = await supabase.from("study_tasks").insert(rows);
    if (err) { setBusy(false); setMessage("Não foi possível enviar ao Planejamento."); return; }
    await supabase.from("study_exams").update({ planned_at: new Date().toISOString() }).eq("id", current.id);
    setBusy(false);
    setMessage(`${rows.length} tarefas adicionadas ao Planejamento.`);
    await load();
  }

  /* ---------- telas ---------- */

  if (!ready) return <p className="muted">Carregando…</p>;
  if (setupNeeded) return <div className="av"><h1 className="display">Central de Avaliações</h1><p className="notice">{SETUP_HINT}</p></div>;
  if (error) return <div className="av"><p className="notice">{error}</p></div>;

  return (
    <div className="av">
      <header className="av-head">
        <div>
          <h1 className="display">Central de Avaliações</h1>
          <p className="muted">Prepare cada prova com anotações, revisões e um cronograma até a data.</p>
        </div>
        <button className="primary" onClick={openNew}><Plus size={16} /> Nova avaliação</button>
      </header>

      {message && <p className="notice" role="status">{message}</p>}

      {!current ? (
        <div className="av-empty">
          <CalendarDays size={28} />
          <h2>Cadastre sua primeira avaliação</h2>
          <p className="muted">Escolha a data e os assuntos cobrados. O Mednotes mostra o que falta estudar e monta o cronograma regressivo.</p>
          <button className="primary" onClick={openNew}><Plus size={16} /> Nova avaliação</button>
        </div>
      ) : (
        <>
          <div className="av-chips" role="tablist" aria-label="Avaliações">
            {exams.map((e) => (
              <button key={e.id} role="tab" aria-selected={e.id === current.id} className={e.id === current.id ? "on" : ""} onClick={() => setSelected(e.id)}>
                {e.title}<small>{e.exam_date < today ? "passou" : `${daysUntil(e.exam_date, today)}d`}</small>
              </button>
            ))}
          </div>

          <section className="av-hero">
            <div className="av-hero-main">
              <span className="av-eyebrow">{current.kind}</span>
              <h2>{current.title}</h2>
              <p className="av-hero-date"><CalendarDays size={15} /> {fmtLong(current.exam_date)}</p>
              <div className="av-count">
                <strong>{Math.max(daysLeft, 0)}</strong>
                <span>{daysLeft < 0 ? "dias desde a prova" : daysLeft === 0 ? "dias — é hoje!" : daysLeft === 1 ? "dia restante" : "dias restantes"}</span>
              </div>
              <div className="av-hero-actions">
                <button className="av-ghost" onClick={() => openEdit(current)}><Pencil size={14} /> Editar</button>
                <button className="av-ghost" onClick={() => remove(current)}><Trash2 size={14} /> Excluir</button>
              </div>
            </div>
            <Ring value={score} />
          </section>

          <div className="av-kpis">
            <div className="av-kpi"><span>Assuntos</span><strong>{coverage.length}</strong><small>cobrados na prova</small></div>
            <div className="av-kpi"><span>Consolidados</span><strong className="ok">{coverage.filter((c) => c.status === "consolidado").length}</strong><small>de {coverage.length}</small></div>
            <div className="av-kpi"><span>Lacunas</span><strong className={gaps.length ? "warn" : "ok"}>{gaps.length}</strong><small>sem estudo ou revisão</small></div>
            <div className="av-kpi"><span>Cards a revisar</span><strong>{dueTotal}</strong><small>vencidos hoje</small></div>
          </div>

          <div className="av-grid">
            <section className="av-today">
              <span className="av-eyebrow">Plano de hoje</span>
              {daysLeft <= 0 ? (
                <p>{daysLeft === 0 ? "A prova é hoje. Boa sorte!" : "Esta avaliação já passou."}</p>
              ) : nextItems.length ? (
                <>
                  <ul>{nextItems.map((i, k) => <li key={k}>{i.title}</li>)}</ul>
                  {!todayItems.length && <small>Próxima tarefa em {fmtShort(nextItems[0].date)}</small>}
                </>
              ) : <p>Escolha assuntos para gerar o plano.</p>}
              <Link href="/revisoes" className="av-today-btn">Revisar agora <ArrowRight size={15} /></Link>
            </section>

            <section className="av-card">
              <h3>Lacunas a resolver</h3>
              {gaps.length === 0 ? <p className="muted">Nenhuma lacuna: todos os assuntos têm anotações e já foram revisados.</p> : (
                <ul className="av-gaps">
                  {gaps.map((g) => (
                    <li key={g.topic.id}>
                      <span className={`av-pill s-${g.status}`}>{STATUS_LABEL[g.status]}</span>
                      <b>{g.topic.name}</b>
                      <small>{subjectOf.get(g.topic.subject_id)?.name}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="av-card">
            <h3>Mapa de conteúdo</h3>
            {coverage.length === 0 && <p className="muted">Nenhum assunto selecionado. Toque em Editar para escolher os conteúdos cobrados.</p>}
            {bySubject.map(([subjectId, list]) => (
              <div key={subjectId} className="av-subject">
                <h4><i style={{ background: subjectOf.get(subjectId)?.color ?? "var(--accent)" }} />{subjectOf.get(subjectId)?.name ?? "Disciplina"}</h4>
                {list.map((c) => {
                  const isOpen = open === c.topic.id;
                  return (
                    <div key={c.topic.id} className="av-topic">
                      <button className="av-topic-row" onClick={() => setOpen(isOpen ? null : c.topic.id)} aria-expanded={isOpen}>
                        <span className="av-topic-name">{c.topic.name}</span>
                        <span className={`av-pill s-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                        <span className="av-bar" aria-hidden="true"><i style={{ width: `${c.score}%` }} /></span>
                        <span className="av-score">{c.score}%</span>
                        <ChevronDown size={16} className={isOpen ? "flip" : ""} />
                      </button>
                      {isOpen && (
                        <div className="av-topic-body">
                          <p><b>{c.pageIds.length}</b> {c.pageIds.length === 1 ? "anotação" : "anotações"} · <b>{c.cards.length}</b> cards · <b>{c.due}</b> para revisar hoje</p>
                          {c.pageIds.length > 0 && (
                            <ul>{c.pageIds.map((id) => <li key={id}><Link href={`/p/${id}`}>{notes.get(id)?.title || "Sem título"}</Link></li>)}</ul>
                          )}
                          {c.pageIds.length === 0 && <p className="muted">Nenhuma anotação ligada a este assunto ainda.</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          <section className="av-card">
            <div className="av-card-head">
              <h3>Cronograma regressivo</h3>
              {plan.length > 0 && (
                <button className="secondary" disabled={busy} onClick={sendToPlanner}>
                  <Check size={14} /> {current.planned_at ? "Enviar de novo ao Planejamento" : "Enviar ao Planejamento"}
                </button>
              )}
            </div>
            {plan.length === 0 ? <p className="muted">{daysLeft <= 0 ? "A data da prova já chegou." : "Escolha os assuntos cobrados para gerar o cronograma."}</p> : (
              <>
                <p className="muted av-note">Os assuntos mais fracos vêm primeiro. Depois você revisa tudo de novo, e os últimos dias ficam para revisão geral e simulado.</p>
                {weeks.map(([weekKey, items]) => (
                  <div key={weekKey} className="av-week">
                    <h4>Semana de {fmtShort(weekKey)}</h4>
                    {items.map((i, k) => (
                      <div key={k} className={`av-day k-${i.kind} ${i.date === today ? "today" : ""}`}>
                        <time>{fmtShort(i.date)}</time>
                        <span>{i.title}</span>
                        <em>{PLAN_LABEL[i.kind]}</em>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </section>
        </>
      )}

      {form && <ExamForm form={form} setForm={setForm} subjects={subjects} topics={topics} busy={busy} onSave={save} />}
    </div>
  );
}

function ExamForm({ form, setForm, subjects, topics, busy, onSave }: {
  form: Form; setForm: (f: Form | null) => void; subjects: Subject[]; topics: Topic[]; busy: boolean; onSave: () => void;
}) {
  const picked = new Set(form.topic_ids);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setForm({ ...form, topic_ids: [...next] });
  };
  const depth = (t: Topic) => { let d = 0, p = t.parent_id; const m = new Map(topics.map((x) => [x.id, x])); while (p && d < 4) { d++; p = m.get(p)?.parent_id ?? null; } return d; };

  return (
    <div className="av-modal" role="dialog" aria-modal="true" aria-label="Avaliação">
      <div className="av-sheet">
        <div className="av-card-head">
          <h3>{form.id ? "Editar avaliação" : "Nova avaliação"}</h3>
          <button className="av-x" onClick={() => setForm(null)} aria-label="Fechar"><X size={18} /></button>
        </div>
        <label>Nome<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Prova de Anatomia — P1" /></label>
        <div className="av-two">
          <label>Tipo<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Data<input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} /></label>
        </div>
        <p className="av-pick-title">Conteúdos cobrados <span className="muted">({form.topic_ids.length} selecionados)</span></p>
        <div className="av-pick">
          {subjects.length === 0 && <p className="muted">Crie disciplinas e assuntos em Disciplinas para escolher aqui.</p>}
          {subjects.map((s) => {
            const list = topics.filter((t) => t.subject_id === s.id);
            if (!list.length) return null;
            const all = list.every((t) => picked.has(t.id));
            return (
              <fieldset key={s.id}>
                <legend><i style={{ background: s.color }} />{s.name}</legend>
                <label className="av-check all"><input type="checkbox" checked={all} onChange={(e) => toggle(list.map((t) => t.id), e.target.checked)} /> Selecionar a disciplina inteira</label>
                {list.map((t) => (
                  <label key={t.id} className="av-check" style={{ paddingLeft: depth(t) * 18 }}>
                    <input type="checkbox" checked={picked.has(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} /> {t.name}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !form.title.trim() || !form.exam_date} onClick={onSave}>Salvar</button>
          <button className="secondary" onClick={() => setForm(null)}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
