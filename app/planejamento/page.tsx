"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Check, ChevronRight, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import HomeChat from "@/components/HomeChat";
import type { StudyTask, Subject } from "@/lib/types";

const DAY_NAMES = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
const DAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

type TaskForm = { title: string; subject_id: string; topic: string; time_label: string; scheduled_date: string };

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function weekStart(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}
function shiftDate(value: string, days: number) {
  const date = fromDateKey(value);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}
function formatRange(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long" });
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()}–${end.getDate()} de ${month.format(end)} ${end.getFullYear()}`
    : `${start.getDate()} ${month.format(start)} – ${end.getDate()} ${month.format(end)} ${end.getFullYear()}`;
}
const blankForm = (date: string): TaskForm => ({ title: "", subject_id: "", topic: "", time_label: "", scheduled_date: date });

export default function WeeklyPlanningPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [weekOffset, setWeekOffset] = useState(0);
  const [form, setForm] = useState<TaskForm>(() => blankForm(toDateKey(new Date())));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  const start = useMemo(() => {
    const date = weekStart(fromDateKey(toDateKey(new Date())));
    date.setDate(date.getDate() + weekOffset * 7);
    return date;
  }, [weekOffset]);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toDateKey(date);
  }), [start]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const weekTasks = useMemo(() => tasks.filter((task) => dates.includes(task.scheduled_date)), [tasks, dates]);
  const dayTasks = useMemo(() => weekTasks.filter((task) => task.scheduled_date === selectedDate).sort((a, b) => a.time_label.localeCompare(b.time_label)), [weekTasks, selectedDate]);
  const pendingTasks = useMemo(() => dayTasks.filter((task) => !task.completed), [dayTasks]);
  const doneTasks = useMemo(() => dayTasks.filter((task) => task.completed), [dayTasks]);
  const completedCount = weekTasks.filter((task) => task.completed).length;
  const progress = weekTasks.length ? Math.round((completedCount / weekTasks.length) * 100) : 0;

  async function load() {
    setLoading(true);
    setError(null);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const [subjectResult, taskResult] = await Promise.all([
      supabase.from("subjects").select("*").order("position").order("created_at"),
      supabase.from("study_tasks").select("*").gte("scheduled_date", toDateKey(start)).lte("scheduled_date", toDateKey(end)).order("time_label"),
    ]);
    if (subjectResult.error || taskResult.error) {
      setError("Não foi possível carregar o planejamento. Confira se executou o arquivo schema5.sql no Supabase.");
    } else {
      setSubjects((subjectResult.data ?? []) as Subject[]);
      setTasks((taskResult.data ?? []) as StudyTask[]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); /* refresh when navigating weeks */ }, [weekOffset]);

  function startCreate() {
    setEditingId(null);
    setForm(blankForm(selectedDate));
    setNotice(null);
    setShowForm(true);
  }
  function startEdit(task: StudyTask) {
    setEditingId(task.id);
    setForm({ title: task.title, subject_id: task.subject_id ?? "", topic: task.topic ?? "", time_label: task.time_label, scheduled_date: task.scheduled_date });
    setSelectedDate(task.scheduled_date);
    setNotice(null);
    setShowForm(true);
  }
  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(blankForm(selectedDate));
  }
  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.subject_id || !form.time_label.trim() || saving) return;
    setSaving(true);
    setError(null);
    const data = {
      title: form.title.trim(),
      subject_id: form.subject_id,
      topic: form.topic.trim() || null,
      time_label: form.time_label.trim(),
      scheduled_date: form.scheduled_date,
    };
    const result = editingId
      ? await supabase.from("study_tasks").update(data).eq("id", editingId)
      : await supabase.from("study_tasks").insert(data);
    if (result.error) {
      setError("Não foi possível salvar a atividade. Tente novamente.");
    } else {
      const taskDate = form.scheduled_date;
      setWeekOffset(Math.round((weekStart(fromDateKey(taskDate)).getTime() - weekStart(new Date()).getTime()) / (7 * 24 * 60 * 60 * 1000)));
      setSelectedDate(taskDate);
      cancelForm();
      setNotice(editingId ? "Atividade atualizada." : "Atividade adicionada à semana.");
      await load();
    }
    setSaving(false);
  }
  async function toggleTask(task: StudyTask) {
    const next = !task.completed;
    // a tarefa muda de lista na hora; se o salvamento falhar, voltamos ao estado anterior
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: next } : item));
    const { error: updateError } = await supabase.from("study_tasks").update({ completed: next }).eq("id", task.id);
    if (updateError) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: task.completed } : item));
      setError("Não foi possível atualizar o progresso.");
    }
  }
  async function deleteTask(task: StudyTask) {
    if (!window.confirm(`Excluir a atividade “${task.title}”?`)) return;
    const { error: deleteError } = await supabase.from("study_tasks").delete().eq("id", task.id);
    if (deleteError) setError("Não foi possível excluir a atividade.");
    else {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      if (editingId === task.id) cancelForm();
    }
  }

  function renderTask(task: StudyTask) {
    const subject = subjectById.get(task.subject_id ?? "");
    const color = subject?.color ?? "#64748b";
    return (
      <article className={`study-task${task.completed ? " completed" : ""}`} key={task.id} style={{ ["--task-color" as string]: color }}>
        <button type="button" className="task-check" aria-label={task.completed ? `Marcar ${task.title} como pendente` : `Concluir ${task.title}`} aria-pressed={task.completed} onClick={() => void toggleTask(task)}>{task.completed && <Check size={14} strokeWidth={3} aria-hidden />}</button>
        <div className="task-body">
          <h3>{task.title}</h3>
          {task.topic && <p className="task-note">{task.topic}</p>}
          <div className="task-meta">
            <span className="task-time"><Clock size={12} aria-hidden /> {task.time_label}</span>
            <span className="task-subject"><i aria-hidden />{subject?.icon ? `${subject.icon} ` : ""}{subject?.name ?? "Disciplina removida"}</span>
          </div>
        </div>
        <div className="task-actions">
          <button type="button" aria-label={`Editar ${task.title}`} title="Editar" onClick={() => startEdit(task)}><Pencil size={15} aria-hidden /></button>
          <button type="button" className="danger" aria-label={`Excluir ${task.title}`} title="Excluir" onClick={() => void deleteTask(task)}><Trash2 size={15} aria-hidden /></button>
        </div>
      </article>
    );
  }

  return (
    <div className="planner-page">
      <section className="planner-hero">
        <div><span className="eyebrow">UM PLANO QUE CABE NA SUA ROTINA</span><h1 className="display">Planejamento semanal</h1><p>Organize seus estudos com leveza. Cada pequena tarefa concluída conta.</p></div>
        <button className="planner-add-button" type="button" onClick={startCreate}><Plus size={16} aria-hidden /> Nova atividade</button>
      </section>

      <section className="planner-progress-card" aria-label="Progresso semanal">
        <div className="planner-progress-copy"><span className="progress-icon" aria-hidden>✦</span><div><strong>Seu progresso nesta semana</strong><span>{completedCount} de {weekTasks.length} atividades concluídas</span></div></div>
        <div className="planner-progress-bar" role="progressbar" aria-label="Atividades concluídas nesta semana" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
        <strong className="planner-progress-percent">{progress}%</strong>
      </section>

      <section className="planner-week" aria-label="Dias da semana">
        <div className="planner-week-heading"><div><span className="eyebrow">SUA ROTINA</span><h2>{formatRange(start)}</h2></div><div className="week-controls"><button type="button" className="week-nav-button" aria-label="Semana anterior" onClick={() => setWeekOffset((offset) => offset - 1)}>←</button><button type="button" className="week-today-button" onClick={() => { setWeekOffset(0); setSelectedDate(toDateKey(new Date())); }}>Esta semana</button><button type="button" className="week-nav-button" aria-label="Próxima semana" onClick={() => setWeekOffset((offset) => offset + 1)}>→</button></div></div>
        <div className="week-day-strip">
          {dates.map((date, index) => {
            const dateTasks = weekTasks.filter((task) => task.scheduled_date === date);
            const isToday = date === toDateKey(new Date());
            return <button type="button" key={date} className={`week-day${date === selectedDate ? " selected" : ""}${isToday ? " today" : ""}`} aria-pressed={date === selectedDate} onClick={() => { setSelectedDate(date); if (showForm && !editingId) setForm((current) => ({ ...current, scheduled_date: date })); }}><span>{DAY_SHORT[index]}</span><strong>{fromDateKey(date).getDate()}</strong><small>{!dateTasks.length ? "Livre" : dateTasks.every((task) => task.completed) ? "Tudo feito" : `${dateTasks.filter((task) => !task.completed).length} pendente${dateTasks.filter((task) => !task.completed).length === 1 ? "" : "s"}`}</small></button>;
          })}
        </div>
      </section>

      {error && <p className="notice" role="alert">{error}</p>}
      {notice && <p className="planner-notice" role="status">{notice}</p>}

      {showForm && (
        <form className="planner-form" onSubmit={submitTask}>
          <div className="planner-form-heading"><div><span className="eyebrow">{editingId ? "AJUSTE SEU PLANO" : "UM NOVO PASSO"}</span><h2>{editingId ? "Editar atividade" : "Adicionar atividade"}</h2></div><button type="button" className="form-close" aria-label="Fechar formulário" onClick={cancelForm}>×</button></div>
          <label className="planner-field planner-field-wide">Atividade<input autoFocus required maxLength={140} placeholder="Ex.: Revisar o sistema cardiovascular" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <div className="planner-form-grid">
            <label className="planner-field">Disciplina<select required value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value })}><option value="">Escolha uma disciplina</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            <label className="planner-field">Assunto <span className="optional-label">(opcional)</span><input maxLength={100} placeholder="Ex.: Alterações cardiovasculares" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} /></label>
            <label className="planner-field">Horário ou período<input required maxLength={40} placeholder="08:00 ou Manhã" value={form.time_label} onChange={(event) => setForm({ ...form, time_label: event.target.value })} /></label>
            <label className="planner-field">Dia<input required type="date" value={form.scheduled_date} onChange={(event) => { setForm({ ...form, scheduled_date: event.target.value }); if (event.target.value) setSelectedDate(event.target.value); }} /></label>
          </div>
          {!subjects.length && <p className="form-helper">Crie uma disciplina antes de adicionar atividades. <a href="/disciplinas">Ir para disciplinas</a></p>}
          <div className="row planner-form-actions"><button className="planner-add-button" type="submit" disabled={saving || !subjects.length}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Adicionar à semana"}</button><button className="secondary" type="button" onClick={cancelForm}>Cancelar</button></div>
        </form>
      )}

      <section className="day-plan" aria-live="polite">
        <div className="day-plan-heading"><div><span className="eyebrow">SEU DIA DE ESTUDO</span><h2>{DAY_NAMES[(fromDateKey(selectedDate).getDay() + 6) % 7]} <span>{fromDateKey(selectedDate).getDate()} de {new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(fromDateKey(selectedDate))}</span></h2></div><button type="button" className="add-inline-button" onClick={startCreate}><Plus size={16} aria-hidden /> <span>Adicionar</span></button></div>
        {loading ? <p className="muted">Carregando atividades…</p> : (
          <>
            {pendingTasks.length ? (
              <div className="task-list">{pendingTasks.map((task) => renderTask(task))}</div>
            ) : dayTasks.length ? (
              <div className="day-empty day-empty-done"><span aria-hidden="true"><Check size={20} /></span><div><strong>Tudo feito por hoje.</strong><p>Todas as atividades deste dia estão concluídas. Bom trabalho!</p></div></div>
            ) : (
              <div className="day-empty"><span aria-hidden="true">✦</span><div><strong>Um espaço em branco também faz parte do plano.</strong><p>Adicione uma tarefa de estudo para este dia quando quiser.</p></div><button type="button" className="secondary" onClick={startCreate}><Plus size={14} aria-hidden /> Adicionar atividade</button></div>
            )}
            {doneTasks.length > 0 && (
              <div className={`done-section${doneOpen ? " open" : ""}`}>
                <button type="button" className="done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen((open) => !open)}><ChevronRight size={16} aria-hidden /><span>Tarefas concluídas</span><em>{doneTasks.length}</em></button>
                {doneOpen && <div className="task-list">{doneTasks.map((task) => renderTask(task))}</div>}
              </div>
            )}
          </>
        )}
      </section>
      <HomeChat scope="planner" onChanged={() => void load()} />

      <p className="planner-footnote">Seu planejamento é privado e salvo na sua conta. <a href="/disciplinas">Gerenciar disciplinas</a></p>
    </div>
  );
}
