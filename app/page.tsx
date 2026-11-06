"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import HomeChat from "@/components/HomeChat";
import { supabase } from "@/lib/supabase";
import type { PageRow, StudyTask, Subject } from "@/lib/types";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export default function Dashboard() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [notebooks, setNotebooks] = useState<PageRow[]>([]);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const weekStart = mondayOf(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    (async () => {
      const [subjectResult, notebookResult, taskResult] = await Promise.all([
        supabase.from("subjects").select("*").order("position").order("created_at"),
        supabase
          .from("pages")
          .select(
            "id,title,icon,type,parent_id,cover_url,content,props,position,created_at,updated_at"
          )
          .eq("type", "notebook")
          .is("parent_id", null)
          .order("created_at", { ascending: true }),
        supabase
          .from("study_tasks")
          .select("*")
          .gte("scheduled_date", dateKey(weekStart))
          .lte("scheduled_date", dateKey(weekEnd))
          .order("time_label"),
      ]);

      if (subjectResult.error || notebookResult.error || taskResult.error) {
        setError(
          "Não foi possível carregar seu espaço. Confira se as tabelas do app estão configuradas no Supabase."
        );
        setSubjects([]);
        return;
      }

      setSubjects((subjectResult.data ?? []) as Subject[]);
      setNotebooks((notebookResult.data ?? []) as PageRow[]);
      setTasks((taskResult.data ?? []) as StudyTask[]);
    })();
  }, []);

  const today = dateKey(new Date());
  const todaysTasks = tasks
    .filter((task) => task.scheduled_date === today)
    .sort((a, b) => a.time_label.localeCompare(b.time_label));
  const done = tasks.filter((task) => task.completed).length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const subjectNames = new Map((subjects ?? []).map((subject) => [subject.id, subject.name]));

  return (
    <div className="dashboard-page">
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="eyebrow">SEU ESPAÇO DE APRENDIZAGEM</span>
          <h1 className="display">Estude com mais clareza.</h1>
          <p>Suas anotações, disciplinas e planos de estudo em um só lugar.</p>
          <Link className="welcome-action" href="/planejamento">
            Organizar minha semana <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <span>✦</span>
          <i>✎</i>
          <b>◷</b>
        </div>
      </section>

      <HomeChat />
      {error && <p className="notice">{error}</p>}

      <section className="workspace-section" aria-labelledby="workspace-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">COMECE POR AQUI</span>
            <h2 id="workspace-title">Meu espaço</h2>
          </div>
          <span className="section-hint">Tudo para manter seus estudos em movimento</span>
        </div>
        <div className="workspace-grid">
          <Link href="/cadernos" className="workspace-card workspace-notes">
            <span className="workspace-icon" aria-hidden="true">▤</span>
            <span className="workspace-label">ANOTAÇÕES</span>
            <strong>Cadernos</strong>
            <span>Matérias, aulas e resumos em um só lugar.</span>
            <span className="workspace-link">
              Abrir cadernos <b aria-hidden="true">↗</b>
            </span>
          </Link>

          <Link href="/disciplinas" className="workspace-card workspace-subjects">
            <span className="workspace-icon" aria-hidden="true">✳</span>
            <span className="workspace-label">SEU CONTEÚDO</span>
            <strong>Disciplinas</strong>
            <span>Organize temas e acesse cada caderno.</span>
            <span className="workspace-link">
              Ver disciplinas <b aria-hidden="true">↗</b>
            </span>
          </Link>

          <Link href="/planejamento" className="workspace-card workspace-planner">
            <span className="workspace-icon" aria-hidden="true">▦</span>
            <span className="workspace-label">PRÓXIMOS PASSOS</span>
            <strong>Planejamento semanal</strong>
            <span>Transforme seus objetivos em uma rotina possível.</span>
            <span className="workspace-link">
              Planejar estudos <b aria-hidden="true">↗</b>
            </span>
          </Link>

          <Link href="/reunioes" className="workspace-card workspace-planner">
            <span className="workspace-icon" aria-hidden="true">🎙</span>
            <span className="workspace-label">INTELIGÊNCIA ARTIFICIAL</span>
            <strong>Anotações IA</strong>
            <span>Grave reuniões e transforme áudio em anotações organizadas.</span>
            <span className="workspace-link">
              Abrir transcritor <b aria-hidden="true">↗</b>
            </span>
          </Link>
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="today-panel">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">SEU DIA</span>
              <h2>Hoje</h2>
            </div>
            <Link href="/planejamento" className="text-link">
              Ver semana <span aria-hidden="true">→</span>
            </Link>
          </div>

          {todaysTasks.length ? (
            <ul className="today-list">
              {todaysTasks.slice(0, 4).map((task) => (
                <li
                  key={task.id}
                  className={task.completed ? "today-task is-done" : "today-task"}
                >
                  <span className="today-dot" aria-hidden="true">
                    {task.completed ? "✓" : ""}
                  </span>
                  <span className="today-time">{task.time_label}</span>
                  <span className="today-task-copy">
                    <strong>{task.title}</strong>
                    <small>
                      {subjectNames.get(task.subject_id ?? "") ?? "Disciplina removida"}
                      {task.topic ? ` · ${task.topic}` : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="today-empty">
              <span aria-hidden="true">☀</span>
              <p>Um dia com espaço para aprender. Adicione uma atividade ao seu planejamento.</p>
              <Link href="/planejamento">Montar minha semana</Link>
            </div>
          )}
        </div>

        <aside className="progress-panel">
          <span className="eyebrow">RITMO DA SEMANA</span>
          <h2>Um passo de cada vez.</h2>
          <div className="progress-number">
            <strong>{done}</strong>
            <span>de {tasks.length} atividades concluídas</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progresso das atividades nesta semana"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>
            {tasks.length
              ? `${progress}% da sua semana de estudos concluída`
              : "Seu progresso aparece aqui quando planejar atividades."}
          </p>
          <Link href="/planejamento" className="progress-link">
            Acompanhar planejamento <span aria-hidden="true">→</span>
          </Link>
        </aside>
      </section>

      {subjects?.length ? (
        <section className="subject-shortcuts">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">SEUS TEMAS</span>
              <h2>Continue de onde parou</h2>
            </div>
            <Link href="/disciplinas" className="text-link">
              Todos <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="subject-shortcut-list">
            {subjects.slice(0, 4).map((subject) => (
              <Link
                key={subject.id}
                href={subject.notebook_page_id ? `/p/${subject.notebook_page_id}` : `/disciplinas/${subject.id}`}
                className="subject-shortcut"
              >
                <span className="subject-shortcut-icon" aria-hidden="true">
                  {subject.icon || "✦"}
                </span>
                <span>{subject.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {notebooks.length > 0 && (
        <p className="dashboard-footnote">
          Seus cadernos recentes estão disponíveis em <Link href="/cadernos">Cadernos</Link>.
        </p>
      )}
    </div>
  );
}
