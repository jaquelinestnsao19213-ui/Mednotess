"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Hit = { kind: "caderno" | "flashcard" | "question"; id: string; page_id: string | null; title: string; snippet: string | null };

const GROUPS: { kind: Hit["kind"]; label: string }[] = [
  { kind: "caderno", label: "Cadernos" },
  { kind: "flashcard", label: "Flashcards" },
  { kind: "question", label: "Questões" },
];

const hrefOf = (h: Hit) => (h.kind === "caderno" ? `/p/${h.id}` : h.page_id ? `/p/${h.page_id}` : "/revisoes");

function mark(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"todos" | Hit["kind"]>("todos");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc("search_study", { term, max_per_group: 8 });
      if (stale) return;
      setError(!!err);
      setHits(err ? [] : ((data ?? []) as Hit[]));
      setLoading(false);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [term]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, []);

  const count = (k: Hit["kind"]) => hits.filter((h) => h.kind === k).length;

  return (
    <div className="gs" ref={box}>
      <div className="gs-field">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar assunto…"
          aria-label="Buscar em cadernos, flashcards e questões"
        />
        {q && <button type="button" onClick={() => { setQ(""); setHits([]); }} aria-label="Limpar busca">×</button>}
      </div>

      {open && term.length >= 2 && (
        <div className="gs-panel">
          <div className="gs-tabs">
            <button type="button" className={tab === "todos" ? "on" : ""} onClick={() => setTab("todos")}>Tudo {hits.length}</button>
            {GROUPS.map((g) => (
              <button key={g.kind} type="button" className={tab === g.kind ? "on" : ""} onClick={() => setTab(g.kind)}>{g.label} {count(g.kind)}</button>
            ))}
          </div>

          {loading && <p className="gs-empty">Buscando…</p>}
          {!loading && error && <p className="gs-empty">A busca ainda não foi ativada. Rode o schema17.sql no Supabase.</p>}
          {!loading && !error && hits.length === 0 && <p className="gs-empty">Nada encontrado para “{term}”.</p>}

          {!loading && !error && GROUPS.filter((g) => tab === "todos" || tab === g.kind).map((g) => {
            const rows = hits.filter((h) => h.kind === g.kind);
            if (!rows.length) return null;
            return (
              <section key={g.kind}>
                <h4>{g.label}</h4>
                {rows.map((h) => (
                  <Link key={`${h.kind}-${h.id}`} href={hrefOf(h)} className="gs-item" onClick={() => setOpen(false)}>
                    <span>{mark(h.title || "Sem título", term)}</span>
                    {h.snippet && <small>{mark(h.snippet, term)}</small>}
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <style>{`
        .gs{position:relative;max-width:720px;margin:0 auto;padding:4px 20px 8px}
        .gs-field{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);transition:border-color .15s}
        .gs-field:focus-within{border-color:var(--ink);color:var(--ink)}
        .gs-field input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;color:var(--ink)}
        .gs-field button{border:0;background:none;color:var(--muted);font-size:1.25rem;line-height:1;cursor:pointer}
        .gs-panel{position:absolute;left:20px;right:20px;top:calc(100% - 2px);z-index:60;max-height:70vh;overflow:auto;padding:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(27,36,48,.1)}
        .gs-tabs{display:flex;gap:4px;padding-bottom:8px;border-bottom:1px solid var(--line);overflow-x:auto}
        .gs-tabs button{border:0;background:none;padding:6px 10px;border-radius:8px;color:var(--muted);font:inherit;font-size:.9rem;white-space:nowrap;cursor:pointer}
        .gs-tabs button.on{background:var(--bg);color:var(--ink);font-weight:600}
        .gs-panel section{padding-top:8px}
        .gs-panel h4{margin:0;padding:4px 10px;font-size:.8rem;font-weight:600;color:var(--muted)}
        .gs-item{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:8px;text-decoration:none;color:var(--ink)}
        .gs-item:hover,.gs-item:focus-visible{background:var(--bg);outline:0}
        .gs-item small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gs-item mark{background:color-mix(in srgb,var(--accent) 16%,transparent);color:inherit;border-radius:3px;padding:0 1px}
        .gs-empty{margin:0;padding:14px 10px;color:var(--muted)}
      `}</style>
    </div>
  );
}
