"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Subject } from "@/lib/types";

export default function Dashboard() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [freeNotebooks, setFreeNotebooks] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [subs, roots] = await Promise.all([
        supabase.from("subjects").select("*").order("position").order("created_at"),
        supabase.from("pages").select("id").is("parent_id", null),
      ]);
      if (subs.error || roots.error) return setError("Não foi possível carregar o painel.");
      const list = (subs.data ?? []) as Subject[];
      const linked = new Set(list.map((s) => s.notebook_page_id).filter(Boolean));
      setSubjects(list);
      setFreeNotebooks((roots.data ?? []).filter((r) => !linked.has(r.id)).length);
    })();
  }, []);

  return (
    <>
      <div className="head">
        <h1 className="display">Meu espaço</h1>
      </div>
      {error && <p className="notice">{error}</p>}
      {subjects === null && !error && <p className="muted">Carregando…</p>}

      {subjects && (
        <>
          <section>
            <div className="head">
              <h2>Disciplinas</h2>
              <Link className="open" href="/disciplinas">Ver todas</Link>
            </div>
            {subjects.length === 0 ? (
              <p className="empty">
                Você ainda não tem disciplinas. <Link href="/disciplinas">Criar a primeira</Link>
              </p>
            ) : (
              <div className="cards">
                {subjects.map((s) => (
                  <div key={s.id} className="dcard" style={{ ["--c" as string]: s.color }}>
                    <span className="dicon" aria-hidden>{s.icon || "📘"}</span>
                    <strong>{s.name}</strong>
                    <div className="row">
                      {s.notebook_page_id && <Link className="open" href={`/p/${s.notebook_page_id}`}>Caderno</Link>}
                      <Link className="open" href={`/disciplinas/${s.id}`}>Assuntos</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="subpages">
            <h2>Cadernos livres</h2>
            <p className="muted">
              {freeNotebooks === 0
                ? "Nenhum caderno fora das disciplinas."
                : `${freeNotebooks} ${freeNotebooks === 1 ? "caderno" : "cadernos"} sem disciplina, para anotações livres.`}
            </p>
            <Link className="open" href="/cadernos">Abrir cadernos</Link>
          </section>
        </>
      )}
    </>
  );
}
