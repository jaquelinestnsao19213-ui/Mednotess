"use client";

import { useMemo, useState } from "react";
import { type TreePage, TYPE_LABEL, norm, pathLabel } from "@/lib/page-tree";

/** Lista pesquisável das anotações (cadernos, aulas e páginas). Serve para escolher fontes ou vincular um conceito. */
export default function PagePicker({ pages, selected, onChange, multiple = true, max = 12, height = 260 }: {
  pages: TreePage[];
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  max?: number;
  height?: number;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = norm(query);
    return pages
      .filter((p) => p.type !== "task" && p.type !== "exam")
      .map((p) => ({ page: p, path: pathLabel(pages, p.id) }))
      .filter(({ page, path }) => !q || norm(`${page.title} ${path}`).includes(q))
      .slice(0, 200);
  }, [pages, query]);

  const toggle = (id: string) => {
    if (!multiple) return onChange(selected[0] === id ? [] : [id]);
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < max) onChange([...selected, id]);
  };

  return (
    <div className="mm-picker">
      <input className="mm-input" type="search" placeholder="Buscar anotação, aula ou caderno…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="mm-picker-list" style={{ maxHeight: height }}>
        {rows.map(({ page, path }) => {
          const on = selected.includes(page.id);
          const blocked = multiple && !on && selected.length >= max;
          return (
            <li key={page.id}>
              <button type="button" className={on ? "on" : ""} disabled={blocked} onClick={() => toggle(page.id)} aria-pressed={on}>
                <span className="mm-picker-check" aria-hidden="true">{on ? "✓" : ""}</span>
                <span className="mm-picker-text">
                  <strong>{page.icon ? `${page.icon} ` : ""}{page.title || "Sem título"}</strong>
                  <small>{TYPE_LABEL[page.type] ?? "Página"}{path ? ` · ${path}` : ""}</small>
                </span>
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="mm-empty">Nenhuma anotação encontrada.</li>}
      </ul>
      {multiple && <small className="mm-hint">{selected.length} de {max} escolhidas</small>}
    </div>
  );
}
