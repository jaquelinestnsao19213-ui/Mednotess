"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/upload";
import { LESSON_TEMPLATE, toDoc } from "@/lib/doc";
import type { PageRow } from "@/lib/types";
import PageAssistant from "@/components/PageAssistant";
import InPageTranscriber from "@/components/InPageTranscriber";

const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });
type Crumb = { id: string; title: string };
function contentText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown };
  const own = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content) ? node.content.map(contentText).join(" ") : "";
  return [own, children].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
function markdownBlocks(markdown: string): JSONContent[] {
  const result: JSONContent[] = [];
  let listType: "bulletList" | "orderedList" | null = null;
  let listItems: JSONContent[] = [];
  const flushList = () => { if (listType && listItems.length) result.push({ type: listType, content: listItems }); listType = null; listItems = []; };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushList(); result.push({ type: "heading", attrs: { level: heading[1].length }, content: [{ type: "text", text: heading[2] }] }); continue; }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const itemText = bullet?.[1] ?? ordered?.[1];
    if (itemText) {
      const nextType = bullet ? "bulletList" : "orderedList";
      if (listType !== nextType) flushList();
      listType = nextType;
      listItems.push({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: itemText.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1") }] }] });
      continue;
    }
    flushList(); result.push({ type: "paragraph", content: [{ type: "text", text: line.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1") }] });
  }
  flushList(); return result;
}
function replaceInNode(node: JSONContent, target: string, replacement: string): { node: JSONContent; count: number } {
  if (node.type === "text" && typeof node.text === "string") {
    const first = node.text.indexOf(target);
    if (first < 0 || node.text.indexOf(target, first + target.length) >= 0) return { node, count: 0 };
    const text = node.text.slice(0, first) + replacement + node.text.slice(first + target.length);
    return { node: { ...node, text }, count: 1 };
  }
  if (!node.content) return { node, count: 0 };
  let count = 0;
  const content = node.content.map((child) => {
    const result = replaceInNode(child, target, replacement);
    count += result.count;
    return result.node;
  });
  return { node: { ...node, content }, count };
}

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
  const [selectedText, setSelectedText] = useState("");
  const selectedTextRef = useRef("");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function flush() {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    const { error: saveError } = await supabase.from("pages").update(patch).eq("id", id);
    if (saveError) {
      // Do not lose unsaved editor data on transient Supabase/network errors.
      pending.current = { ...patch, ...pending.current };
      setError("Não foi possível salvar. Suas alterações continuam pendentes; tente novamente.");
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushRef.current(), 2500);
      return;
    }
    if (pending.current === patch) pending.current = {};
    else Object.keys(patch).forEach((key) => { if (pending.current[key] === patch[key]) delete pending.current[key]; });
    setError(null);
    setStatus(Object.keys(pending.current).length ? "saving" : "saved");
    if (Object.keys(pending.current).length && !timer.current) timer.current = setTimeout(() => void flushRef.current(), 800);
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  function save(patch: Record<string, unknown>) {
    pending.current = { ...pending.current, ...patch };
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 800);
  }
  function update(patch: Partial<PageRow>) { setPage((current) => current ? { ...current, ...patch } : current); save(patch); }

  const insertAssistantText = useCallback((text: string) => {
    setPage((current) => {
      if (!current) return current;
      const doc = toDoc(current.content);
      const next = { ...doc, content: [...(doc.content ?? []), ...markdownBlocks(text)] };
      save({ content: next });
      return { ...current, content: next };
    });
    setEditorVersion((version) => version + 1);
  }, []);

  const replaceSelectedText = useCallback((markdown: string) => {
    const target = selectedTextRef.current.trim();
    if (!target) return false;
    let replacedCount = 0;
    setPage((current) => {
      if (!current) return current;
      const doc = toDoc(current.content);
      const plain = markdown.replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
      const replacement = replaceInNode(doc, target, plain);
      replacedCount = replacement.count;
      if (replacedCount !== 1) return current;
      save({ content: replacement.node });
      return { ...current, content: replacement.node };
    });
    if (replacedCount !== 1) return false;
    selectedTextRef.current = "";
    setSelectedText("");
    setEditorVersion((version) => version + 1);
    return true;
  }, []);

  useEffect(() => {
    const trackSelection = () => {
      const selection = window.getSelection();
      const root = document.querySelector(".tiptap");
      const text = selection?.toString().trim() ?? "";
      if (root && selection?.anchorNode && selection?.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode) && text) {
        selectedTextRef.current = text;
        setSelectedText(text);
      }
    };
    document.addEventListener("selectionchange", trackSelection);
    return () => document.removeEventListener("selectionchange", trackSelection);
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flushRef.current(); };
    document.addEventListener("visibilitychange", onHide); window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); if (timer.current) clearTimeout(timer.current); void flushRef.current(); };
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: row } = await supabase.from("pages").select("*").eq("id", id).maybeSingle();
      if (!alive) return;
      if (!row) { setNotFound(true); return; }
      const current = row as PageRow; setPage(current);
      const { data: kids } = await supabase.from("pages").select("*").eq("parent_id", id).order("position").order("created_at");
      if (alive) setChildren((kids ?? []) as PageRow[]);
      const trail: Crumb[] = []; let parent = current.parent_id;
      for (let index = 0; index < 10 && parent; index++) {
        const { data: ancestor } = await supabase.from("pages").select("id,title,parent_id").eq("id", parent).maybeSingle();
        if (!ancestor) break;
        trail.unshift({ id: ancestor.id, title: ancestor.title }); parent = ancestor.parent_id;
      }
      if (alive) setCrumbs(trail);
    })();
    return () => { alive = false; };
  }, [id]);

  async function addChild(kind: "lesson" | "page") {
    const row = kind === "lesson" ? { title: "Nova aula / tema", type: "lesson", content: LESSON_TEMPLATE } : { title: "Nova página", type: "page" };
    const { data, error: insertError } = await supabase.from("pages").insert({ ...row, parent_id: id }).select("id").single();
    if (insertError || !data) { setError("Não foi possível criar a página."); return; }
    router.push(`/p/${data.id}`);
  }
  async function updateChild(childId: string, patch: Partial<PageRow>) {
    const { error: updateError } = await supabase.from("pages").update(patch).eq("id", childId);
    if (updateError) setError("Não foi possível salvar a alteração na tabela.");
  }
  function editChildLocal(childId: string, patch: Partial<PageRow>) { setChildren((list) => list.map((child) => child.id === childId ? { ...child, ...patch } : child)); }
  async function onCover(file: File | undefined) {
    if (!file) return;
    try { update({ cover_url: await uploadFile(file) }); } catch { setError("Não foi possível enviar a capa. Confira se rodou o schema2.sql no Supabase."); }
  }
  async function remove() {
    if (!page) return;
    const ok = window.confirm(children.length ? "Excluir esta página e todas as páginas dentro dela? Isso não pode ser desfeito." : "Excluir esta página? Isso não pode ser desfeito.");
    if (!ok) return;
    pending.current = {};
    const { error: deleteError } = await supabase.from("pages").delete().eq("id", id);
    if (deleteError) { setError("Não foi possível excluir."); return; }
    router.push(page.parent_id ? `/p/${page.parent_id}` : "/");
  }
  if (notFound) return <p className="empty">Página não encontrada. <Link href="/">Voltar ao início</Link></p>;
  if (!page) return <p className="muted">Carregando…</p>;
  const isLesson = page.type === "lesson";
  const table = <section className="subpages"><div className="head"><h2>{isLesson ? "Páginas dentro desta aula" : "Aulas e páginas"}</h2><div className="row"><button className="primary" onClick={() => void addChild("lesson")}>Nova aula</button><button className="secondary" onClick={() => void addChild("page")}>Nova página</button></div></div>{!children.length ? <p className="empty">Nada aqui ainda. Crie uma aula para registrar tema, data e anotações.</p> : <div className="table-wrap"><table className="data"><thead><tr><th>Aula / tema</th><th>Data</th><th></th></tr></thead><tbody>{children.map((child) => <tr key={child.id}><td><input value={child.title} aria-label="Título" onChange={(event) => editChildLocal(child.id, { title: event.target.value })} onBlur={(event) => void updateChild(child.id, { title: event.target.value })} /></td><td><input type="date" value={child.props?.date ?? ""} aria-label="Data" onChange={(event) => { const props = { ...child.props, date: event.target.value }; editChildLocal(child.id, { props }); void updateChild(child.id, { props }); }} /></td><td><Link className="open" href={`/p/${child.id}`}>Abrir</Link></td></tr>)}</tbody></table></div>}</section>;
  const editor = <Editor key={`${page.id}-${editorVersion}`} initial={toDoc(page.content)} onChange={(doc: JSONContent) => { setPage((current) => current ? { ...current, content: doc } : current); save({ content: doc }); }} />;
  const transcriber = <InPageTranscriber pageTitle={page.title} pageContext={contentText(toDoc(page.content))} selectedText={selectedText} onInsert={insertAssistantText} onReplaceSelection={replaceSelectedText} />;
  return <>
    <nav className="crumbs" aria-label="Caminho"><Link href="/">Início</Link>{crumbs.map((crumb) => <span key={crumb.id}><span className="sep">/</span><Link href={`/p/${crumb.id}`}>{crumb.title || "Sem título"}</Link></span>)}</nav>
    {page.cover_url ? <div className="cover" style={{ backgroundImage: `url(${page.cover_url})` }}><div className="cover-actions"><button className="secondary" onClick={() => coverInput.current?.click()}>Trocar capa</button><button className="secondary" onClick={() => update({ cover_url: null })}>Remover</button></div></div> : <button className="secondary small-btn" onClick={() => coverInput.current?.click()}>Adicionar capa</button>}
    <input ref={coverInput} type="file" accept="image/*" hidden onChange={(event) => { void onCover(event.target.files?.[0]); event.target.value = ""; }} />
    <div className="titlebar">{page.icon && <button className="icon-btn" aria-label="Trocar ícone" onClick={() => { const value = window.prompt("Digite um emoji para o ícone", page.icon ?? ""); if (value !== null) update({ icon: value.trim() || null }); }}>{page.icon}</button>}<input className="title-input display" value={page.title} placeholder="Sem título" onChange={(event) => update({ title: event.target.value })} aria-label="Título da página" /></div>
    <p className="muted small">{status === "saving" ? "Salvando…" : "Salvo"}</p>{error && <p className="notice">{error}</p>}
    {isLesson && <div className="props"><label>Data<input type="date" value={page.props?.date ?? ""} onChange={(event) => update({ props: { ...page.props, date: event.target.value } })} /></label><label>Disciplina<input value={page.props?.discipline ?? ""} placeholder="Ex.: Tutoria" onChange={(event) => update({ props: { ...page.props, discipline: event.target.value } })} /></label><label>Sala<input value={page.props?.room ?? ""} placeholder="Ex.: 314 — Bloco D" onChange={(event) => update({ props: { ...page.props, room: event.target.value } })} /></label></div>}
    {isLesson ? <>{transcriber}{editor}{table}</> : <>{table}{transcriber}{editor}</>}
    <PageAssistant title={page.title} content={toDoc(page.content)} onInsert={insertAssistantText} />
    <button className="danger" onClick={() => void remove()}>Excluir página</button>
  </>;
}
