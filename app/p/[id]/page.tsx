"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/upload";
import { LESSON_TEMPLATE, toDoc } from "@/lib/doc";
import type { PageRow } from "@/lib/types";
import PageAssistant from "@/components/PageAssistant";
import SubpagesTable from "@/components/SubpagesTable";
import PageMovePicker from "@/components/PageMovePicker";
import { deletePages, deletionMessage, movePage, planDeletion } from "@/lib/page-ops";

const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });

type Crumb = { id: string; title: string };

export default function PageRoute() {
  const { id } = useParams<{ id: string }>();
  return <PageView key={id} id={id} />;
}

function PageView({ id }: { id: string }) {
  const router = useRouter();
  const [page, setPage] = useState<PageRow | null>(null);
  const [children, setChildren] = useState<PageRow[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [movingSelf, setMovingSelf] = useState(false);

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function flush() {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from("pages").update(patch).eq("id", id);
    setError(error ? "Não foi possível salvar. Tente de novo." : null);
    setStatus("saved");
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  function save(patch: Record<string, unknown>) {
    pending.current = { ...pending.current, ...patch };
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 800);
  }

  function update(patch: Partial<PageRow>) {
    setPage((p) => (p ? { ...p, ...patch } : p));
    save(patch);
  }

  // Converte o texto da assistente (títulos ##, listas, **negrito**) em blocos do editor.
  function inlineNodes(text: string): JSONContent[] {
    const nodes: JSONContent[] = [];
    text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) nodes.push({ type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] });
      else nodes.push({ type: "text", text: part });
    });
    return nodes;
  }

  function insertAssistantText(text: string) {
    if (!page) return;
    const doc = toDoc(page.content);
    const blocks: JSONContent[] = [];
    let list: { type: "bulletList" | "orderedList"; items: JSONContent[] } | null = null;
    const flush = () => {
      if (list) blocks.push({ type: list.type, content: list.items });
      list = null;
    };
    for (const raw of text.split(/\n/)) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const numbered = line.match(/^\d+[.)]\s+(.*)$/);
      if (heading) {
        flush();
        blocks.push({ type: "heading", attrs: { level: Math.min(3, Math.max(2, heading[1].length)) }, content: inlineNodes(heading[2]) });
      } else if (bullet || numbered) {
        const kind = bullet ? "bulletList" : "orderedList";
        if (list && list.type !== kind) flush();
        if (!list) list = { type: kind, items: [] };
        list.items.push({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes((bullet ?? numbered)![1]) }] });
      } else {
        flush();
        blocks.push({ type: "paragraph", content: inlineNodes(line) });
      }
    }
    flush();
    const content = [...(doc.content ?? []), { type: "horizontalRule" }, ...blocks];
    const next = { ...doc, content };
    setPage((current) => current ? { ...current, content: next } : current);
    save({ content: next });
    setEditorVersion((version) => version + 1);
  }

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
      flushRef.current();
    };
  }, []);

  useEffect(() => {
    (async () => {
      const { data: row } = await supabase.from("pages").select("*").eq("id", id).maybeSingle();
      if (!row) return setNotFound(true);
      const current = row as PageRow;
      setPage(current);

      await loadChildren();

      const trail: Crumb[] = [];
      let parent = current.parent_id;
      for (let i = 0; i < 10 && parent; i++) {
        const { data: p } = await supabase.from("pages").select("id,title,parent_id").eq("id", parent).maybeSingle();
        if (!p) break;
        trail.unshift({ id: p.id, title: p.title });
        parent = p.parent_id;
      }
      setCrumbs(trail);
    })();
  }, [id, reloadKey]);

  async function loadChildren() {
    const { data: kids } = await supabase.from("pages").select("*").eq("parent_id", id).order("position").order("created_at");
    setChildren((kids ?? []) as PageRow[]);
  }

  async function addChild(kind: "lesson" | "page") {
    const row =
      kind === "lesson"
        ? { title: "Nova aula / tema", type: "lesson", content: LESSON_TEMPLATE }
        : { title: "Nova página", type: "page" };
    const { data, error } = await supabase
      .from("pages")
      .insert({ ...row, parent_id: id, position: children.length })
      .select("id")
      .single();
    if (error || !data) return setError("Não foi possível criar a página.");
    router.push(`/p/${data.id}`);
  }

  async function onCover(file: File | undefined) {
    if (!file) return;
    try {
      update({ cover_url: await uploadFile(file) });
    } catch {
      setError("Não foi possível enviar a capa. Confira se rodou o schema2.sql no Supabase.");
    }
  }

  async function remove() {
    if (!page) return;
    const plan = await planDeletion(id);
    if (!plan) return setError("Não foi possível conferir o que será excluído. Tente de novo.");
    if (!window.confirm(deletionMessage(page.title, plan))) return;
    pending.current = {};
    if (!(await deletePages(plan.ids))) return setError("Não foi possível excluir.");
    router.push(page.parent_id ? `/p/${page.parent_id}` : "/");
  }

  async function moveSelf(destination: string | null) {
    setMovingSelf(false);
    if (!(await movePage(id, destination))) return setError("Não foi possível mover esta página.");
    setError(null);
    setReloadKey((key) => key + 1);
  }

  if (notFound) return <p className="empty">Página não encontrada. <Link href="/">Voltar ao início</Link></p>;
  if (!page) return <p className="muted">Carregando…</p>;

  const isLesson = page.type === "lesson";

  const table = (
    <SubpagesTable
      parent={page}
      grandparent={crumbs.length ? crumbs[crumbs.length - 1] : null}
      items={children}
      setItems={(updater) => setChildren(updater)}
      reload={loadChildren}
      onAdd={addChild}
      onError={setError}
    />
  );

    const editor = (
    <Editor 
      key={`${page.id}-${editorVersion}`} 
      initial={toDoc(page.content)} 
      onChange={(doc: JSONContent) => {
        // Atualiza o estado da página local imediatamente para o PageAssistant receber o texto novo
        setPage((current) => current ? { ...current, content: doc } : current);
        // Mantém a função de salvamento com a lógica de espera (debounce) para o banco de dados
        save({ content: doc });
      }} 
    />
  );

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

      {page.cover_url ? (
        <div className="cover" style={{ backgroundImage: `url(${page.cover_url})` }}>
          <div className="cover-actions">
            <button className="secondary" onClick={() => coverInput.current?.click()}>Trocar capa</button>
            <button className="secondary" onClick={() => update({ cover_url: null })}>Remover</button>
          </div>
        </div>
      ) : (
        <button className="secondary small-btn" onClick={() => coverInput.current?.click()}>Adicionar capa</button>
      )}
      <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => { onCover(e.target.files?.[0]); e.target.value = ""; }} />

      <div className="titlebar">
  {page.icon && (
    <button
      className="icon-btn"
      aria-label="Trocar ícone"
      onClick={() => {
        const v = window.prompt("Digite um emoji para o ícone", page.icon ?? "");
        if (v !== null) update({ icon: v.trim() || null });
      }}
    >
      {page.icon}
    </button>
  )}

  <input
    className="title-input display"
    value={page.title}
    placeholder="Sem título"
    onChange={(e) => update({ title: e.target.value })}
    aria-label="Título da página"
  />
</div>
      <p className="muted small">{status === "saving" ? "Salvando…" : "Salvo"}</p>
      {error && <p className="notice">{error}</p>}

      {isLesson && (
        <div className="props">
          <label>Data
            <input type="date" value={page.props?.date ?? ""} onChange={(e) => update({ props: { ...page.props, date: e.target.value } })} />
          </label>
          <label>Disciplina
            <input value={page.props?.discipline ?? ""} placeholder="Ex.: Tutoria" onChange={(e) => update({ props: { ...page.props, discipline: e.target.value } })} />
          </label>
          <label>Sala
            <input value={page.props?.room ?? ""} placeholder="Ex.: 314 — Bloco D" onChange={(e) => update({ props: { ...page.props, room: e.target.value } })} />
          </label>
        </div>
      )}

      {isLesson ? <>{editor}{table}</> : <>{table}{editor}</>}
      <PageAssistant pageId={id} title={page.title} content={toDoc(page.content)} onInsert={insertAssistantText} />
      <div className="page-footer-actions">
        <button className="secondary" onClick={() => setMovingSelf(true)}>Mover esta página…</button>
        <button className="danger" onClick={remove}>Excluir página</button>
      </div>
      {movingSelf && <PageMovePicker mode="move" moving={{ id: page.id, title: page.title, icon: page.icon, type: page.type, parent_id: page.parent_id }} onClose={() => setMovingSelf(false)} onPick={(destination) => void moveSelf(destination)} />}
    </>
  );
}
