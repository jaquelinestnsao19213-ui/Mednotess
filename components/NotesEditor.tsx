"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bold, Heading1, Heading2, Italic, List, ListOrdered, Maximize2, Minimize2 } from "lucide-react";
import { continueList, toggleLinePrefix, wrapSelection, type LineKind, type TextEdit } from "@/lib/notes-format";

export const NOTES_MAX = 50000;

type Props = { value: string; onChange: (value: string) => void; id?: string };

/** Editor de notas: textarea que cresce com o texto, barra de formatação (Markdown simples) e modo ampliado. */
export default function NotesEditor({ value, onChange, id }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    if (pending.current) {
      el.setSelectionRange(pending.current.start, pending.current.end);
      pending.current = null;
    }
  }, [value, expanded]);

  function apply(edit: TextEdit) {
    pending.current = { start: edit.start, end: edit.end };
    onChange(edit.value.slice(0, NOTES_MAX));
    ref.current?.focus();
  }
  function selection() {
    const el = ref.current;
    return { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  }
  const wrap = (marker: string) => { const s = selection(); apply(wrapSelection(value, s.start, s.end, marker)); };
  const line = (kind: LineKind) => { const s = selection(); apply(toggleLinePrefix(value, s.start, s.end, kind)); };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "b") { event.preventDefault(); wrap("**"); return; }
    if (mod && event.key.toLowerCase() === "i") { event.preventDefault(); wrap("*"); return; }
    if (event.key === "Enter" && !event.shiftKey && !mod && !event.nativeEvent.isComposing) {
      const s = selection();
      if (s.start !== s.end) return;
      const edit = continueList(value, s.start);
      if (edit) { event.preventDefault(); apply(edit); }
    }
  }

  const tools: { label: string; icon: typeof Bold; run: () => void }[] = [
    { label: "Negrito (Ctrl+B)", icon: Bold, run: () => wrap("**") },
    { label: "Itálico (Ctrl+I)", icon: Italic, run: () => wrap("*") },
    { label: "Título", icon: Heading1, run: () => line("h1") },
    { label: "Subtítulo", icon: Heading2, run: () => line("h2") },
    { label: "Lista com marcadores", icon: List, run: () => line("ul") },
    { label: "Lista numerada", icon: ListOrdered, run: () => line("ol") },
  ];

  return (
    <div className={`notes-editor${expanded ? " expanded" : ""}`}>
      <div className="notes-toolbar" role="toolbar" aria-label="Formatação do texto">
        {tools.map(({ label, icon: Icon, run }) => (
          <button key={label} type="button" title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={run}><Icon size={16} aria-hidden /></button>
        ))}
        <span className="notes-toolbar-spacer" />
        <button type="button" title={expanded ? "Reduzir editor" : "Ampliar editor"} aria-label={expanded ? "Reduzir editor" : "Ampliar editor"} aria-pressed={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}</button>
      </div>
      <textarea
        id={id}
        ref={ref}
        className="notes-area"
        value={value}
        maxLength={NOTES_MAX}
        placeholder={"Escreva o planejamento, resumos ou lembretes desta atividade…\n\nDica: use # para título, - para lista e **negrito**."}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
