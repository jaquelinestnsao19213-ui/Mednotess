"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PageRow } from "@/lib/types";

type Crumb = { id: string; title: string };

export default function PageView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [page, setPage] = useState<PageRow | null>(null);
  const [children, setChildren] = useState<PageRow[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data: row } = await supabase.from("pages").select("*").eq("id", id).maybeSingle();
    if (!row) return setNotFound(true);
    const current = row as PageRow;
    setPage(current);
    setTitle(current.title);
    setText(current.content?.[0]?.text ?? "");

    const { data: kids } = await supabase
      .from("pages")
      .select("*")
      .eq("parent_id", id)
      .order("position")
      .order("created_at");
    setChildren((kids ?? []) as PageRow[]);

    const trail: Crumb[] = [];
    let parent = current.parent_id;
    for (let i = 0; i < 10 && parent; i++) {
      const { data: p } = await supabase.from("pages").select("id,title,parent_id").eq("id", parent).maybeSingle();
      if (!p) break;
      trail.unshift({ id: p.id, title: p.title });
      parent = p.parent_id;
    }
    setCrumbs(trail);
  }, [id]);

  useEffect(() => {
    setPage(null);
    setNotFound(false);
    load();
  }, [load]);

  function scheduleSave(nextTitle: string, nextText: string) {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("pages")
        .update({ title: nextTitle, content: [{ type: "text", text: nextText }] })
        .eq("id", id);
      if (error) setError("Não foi possível salvar. Tente de novo.");
      else setError(null);
      setStatus("saved");
    }, 800);
  }

  async function createSubpage() {
    const { data, error } = await supabase
      .from("pages")
      .insert({ title: "Nova página", type: "page", parent_id: id })
      .select("id")
      .single();
    if (error || !data) return setError("Não foi possível criar a subpágina.");
    router.push(`/p/${data.id}`);
  }

  async function remove() {
    if (!page) return;
    const hasKids = children.length > 0;
    const ok = window.confirm(
      hasKids
        ? "Excluir esta página e todas as subpáginas dela? Isso não pode ser desfeito."
        : "Excluir esta página? Isso não pode ser desfeito."
    );
    if (!ok) return;
    const { error } = await supabase.from("pages").delete().eq("id", id);
    if (error) return setError("Não foi possível excluir.");
    router.push(page.parent_id ? `/p/${page.parent_id}` : "/");
  }

  if (notFound) return <p className="empty">Página não encontrada. <Link href="/">Voltar ao início</Link></p>;
  if (!page) return <p className="muted">Carregando…</p>;

  return (
    <>
      <nav className="crumbs" aria-label="Caminho">
        <Link href="/">Início</Link>
        {crumbs.map((c) => (
          <span key={c.id}>
            <span className="sep">/</span>
            <Link href={`/p/${c.id}`}>{c.title || "Sem título"}</Link>
          </span>
        ))}
      </nav>

      <input
        className="title-input display"
        value={title}
        placeholder="Sem título"
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave(e.target.value, text);
        }}
        aria-label="Título da página"
      />
      <p className="muted small">{status === "saving" ? "Salvando…" : "Salvo"}</p>
      {error && <p className="notice">{error}</p>}

      <textarea
        className="body-input"
        value={text}
        placeholder="Escreva aqui as suas anotações…"
        onChange={(e) => {
          setText(e.target.value);
          scheduleSave(title, e.target.value);
        }}
        aria-label="Anotações"
      />

      <section className="subpages">
        <div className="head">
          <h2>Subpáginas</h2>
          <button className="secondary" onClick={createSubpage}>Nova subpágina</button>
        </div>
        {children.length === 0 ? (
          <p className="empty">Sem subpáginas. Use para separar aulas, temas ou resumos.</p>
        ) : (
          <ul className="list">
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/p/${c.id}`}>{c.title || "Sem título"}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="danger" onClick={remove}>Excluir página</button>
    </>
  );
}
