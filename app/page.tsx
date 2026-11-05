"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PageRow } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("pages")
      .select("*")
      .is("parent_id", null)
      .order("position")
      .order("created_at")
      .then(({ data, error }) => {
        if (error) setError("Não foi possível carregar os cadernos.");
        else setPages(data as PageRow[]);
      });
  }, []);

  async function createNotebook() {
    const { data, error } = await supabase
      .from("pages")
      .insert({ title: "Novo caderno", type: "notebook", parent_id: null })
      .select("id")
      .single();
    if (error || !data) return setError("Não foi possível criar o caderno.");
    router.push(`/p/${data.id}`);
  }

  return (
    <>
      <div className="head">
        <h1 className="display">Seus cadernos</h1>
        <button className="primary" onClick={createNotebook}>Novo caderno</button>
      </div>
      {error && <p className="notice">{error}</p>}
      {pages === null && !error && <p className="muted">Carregando…</p>}
      {pages?.length === 0 && (
        <p className="empty">Nenhum caderno ainda. Crie o primeiro para guardar suas aulas.</p>
      )}
      <ul className="list">
        {pages?.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`}>{p.title || "Sem título"}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
