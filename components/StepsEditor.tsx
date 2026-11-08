"use client";

import { useRef } from "react";
import { Plus, X } from "lucide-react";

export type FormStep = { key: string; id?: string; text: string; completed: boolean };
export const MAX_STEPS = 50;
const newKey = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const blankStep = (text = ""): FormStep => ({ key: newKey(), text, completed: false });

/** Lista editável de etapas (checklist) dentro do formulário da tarefa. */
export default function StepsEditor({ steps, onChange }: { steps: FormStep[]; onChange: (steps: FormStep[]) => void }) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusLater = (key: string) => requestAnimationFrame(() => inputs.current.get(key)?.focus());

  const update = (key: string, patch: Partial<FormStep>) => onChange(steps.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  const remove = (key: string) => onChange(steps.filter((step) => step.key !== key));
  function addAfter(key: string | null) {
    if (steps.length >= MAX_STEPS) return;
    const step = blankStep();
    const at = key === null ? steps.length : steps.findIndex((item) => item.key === key) + 1;
    onChange([...steps.slice(0, at), step, ...steps.slice(at)]);
    focusLater(step.key);
  }
  function onPaste(key: string, text: string) {
    const parts = text.split(/\r?\n/).map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, "").trim()).filter(Boolean);
    if (parts.length < 2) return false;
    const at = steps.findIndex((item) => item.key === key);
    const room = MAX_STEPS - steps.length + 1;
    const [first, ...others] = parts.slice(0, room);
    const next = steps.map((step) => (step.key === key ? { ...step, text: first.slice(0, 300) } : step));
    next.splice(at + 1, 0, ...others.map((part) => blankStep(part.slice(0, 300))));
    onChange(next);
    return true;
  }

  const done = steps.filter((step) => step.completed && step.text.trim()).length;
  const total = steps.filter((step) => step.text.trim()).length;

  return (
    <div className="steps-editor">
      {steps.length > 0 && <ul className="step-rows">
        {steps.map((step, index) => (
          <li key={step.key} className={`step-row${step.completed ? " done" : ""}`}>
            <input type="checkbox" className="step-box" checked={step.completed} aria-label={`Etapa ${index + 1} concluída`} onChange={(event) => update(step.key, { completed: event.target.checked })} />
            <input
              ref={(el) => { if (el) inputs.current.set(step.key, el); else inputs.current.delete(step.key); }}
              className="step-input"
              value={step.text}
              maxLength={300}
              placeholder={`Etapa ${index + 1}`}
              aria-label={`Texto da etapa ${index + 1}`}
              onChange={(event) => update(step.key, { text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); if (step.text.trim()) addAfter(step.key); }
                if (event.key === "Backspace" && !step.text) { event.preventDefault(); const prev = steps[index - 1]; remove(step.key); if (prev) focusLater(prev.key); }
              }}
              onPaste={(event) => { if (onPaste(step.key, event.clipboardData.getData("text"))) event.preventDefault(); }}
            />
            <button type="button" className="step-remove" aria-label={`Excluir etapa ${index + 1}`} title="Excluir etapa" onClick={() => remove(step.key)}><X size={15} aria-hidden /></button>
          </li>
        ))}
      </ul>}
      <div className="steps-footer">
        <button type="button" className="step-add" disabled={steps.length >= MAX_STEPS} onClick={() => addAfter(null)}><Plus size={15} aria-hidden /> Adicionar etapa</button>
        {total > 0 && <span className="steps-count">{done}/{total} concluídas</span>}
      </div>
    </div>
  );
}
