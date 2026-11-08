"use client";

import { useEffect, useRef } from "react";
import { CalendarDays, Check, Clock, Pencil, Trash2, X } from "lucide-react";
import Markdown from "@/components/Markdown";
import type { StudyTask, StudyTaskStep, Subject } from "@/lib/types";

type Props = {
  task: StudyTask;
  subject: Subject | undefined;
  steps: StudyTaskStep[];
  dateLabel: string;
  onClose: () => void;
  onToggleTask: (task: StudyTask) => void;
  onToggleStep: (step: StudyTaskStep) => void;
  onEdit: (task: StudyTask) => void;
  onDelete: (task: StudyTask) => void;
};

/** Visualização completa de uma atividade: notas, etapas e progresso, sem abrir o formulário de edição. */
export default function TaskDetail({ task, subject, steps, dateLabel, onClose, onToggleTask, onToggleStep, onEdit, onDelete }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const done = steps.filter((step) => step.completed).length;
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const notes = task.notes?.trim() ?? "";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="task-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" tabIndex={-1} ref={dialog} style={{ ["--task-color" as string]: subject?.color ?? "#64748b" }}>
        <header className="task-dialog-head">
          <div>
            <span className="task-subject"><i aria-hidden />{subject?.icon ? `${subject.icon} ` : ""}{subject?.name ?? (task.subject_id ? "Disciplina removida" : "Sem disciplina")}</span>
            <h2 id="task-dialog-title">{task.title}</h2>
            {task.topic && <p className="task-note">{task.topic}</p>}
          </div>
          <button type="button" className="form-close" aria-label="Fechar" onClick={onClose}><X size={18} aria-hidden /></button>
        </header>

        <div className="task-dialog-facts">
          <span><CalendarDays size={14} aria-hidden /> {dateLabel}</span>
          <span><Clock size={14} aria-hidden /> {task.time_label}</span>
          <button type="button" className={`task-status${task.completed ? " done" : ""}`} aria-pressed={task.completed} onClick={() => onToggleTask(task)}>
            <Check size={13} strokeWidth={3} aria-hidden /> {task.completed ? "Concluída" : "Marcar como concluída"}
          </button>
        </div>

        <div className="task-dialog-body">
          {steps.length > 0 && (
            <section aria-label="Etapas">
              <div className="dialog-section-title"><h3>Etapas</h3><span>{done}/{steps.length} etapas concluídas</span></div>
              <div className="steps-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso das etapas"><span style={{ width: `${percent}%` }} /></div>
              <ul className="step-checklist">
                {steps.map((step) => (
                  <li key={step.id} className={step.completed ? "done" : ""}>
                    <button type="button" className="task-check" aria-pressed={step.completed} aria-label={step.completed ? `Desmarcar etapa: ${step.text}` : `Concluir etapa: ${step.text}`} onClick={() => onToggleStep(step)}>{step.completed && <Check size={14} strokeWidth={3} aria-hidden />}</button>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Notas e planejamento">
            <div className="dialog-section-title"><h3>Notas e planejamento</h3></div>
            {notes ? <div className="task-notes-view"><Markdown text={notes} /></div> : <p className="muted dialog-empty">Nenhuma nota ainda. Toque em “Editar” para escrever o planejamento desta atividade.</p>}
          </section>
        </div>

        <footer className="task-dialog-actions">
          <button type="button" className="secondary danger-ghost" onClick={() => onDelete(task)}><Trash2 size={15} aria-hidden /> Excluir</button>
          <button type="button" className="planner-add-button" onClick={() => onEdit(task)}><Pencil size={15} aria-hidden /> Editar</button>
        </footer>
      </div>
    </div>
  );
}
