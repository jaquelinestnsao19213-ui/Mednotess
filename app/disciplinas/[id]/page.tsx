"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LESSON_TEMPLATE } from "@/lib/doc";
import type { Subject, Topic, TopicLink } from "@/lib/types";
import { ColorPicker, IconPicker } from "@/components/SubjectBits";
import PageMovePicker from "@/components/PageMovePicker";
import ImportToTopic, { NEW_TOPIC } from "@/components/ImportToTopic";
import { loadTreePages, movePage } from "@/lib/page-ops";
import { pathLabel, type TreePage } from "@/lib/page-tree";
import TopicCard, { type PageItem } from "@/components/TopicCard";
import TopicParentPicker from "@/components/TopicParentPicker";
import { applyDrop, canNest, childrenOf, cleanParents, diffTopics, dropZone, moveTopic, nestTargets, shiftTopic, unnestTopic, type DropZone } from "@/lib/topic-tree";
import { countLabel, topicPageIds, transferCheck, type ImportMode } from "@/lib/topic-links";

type RootPage = { id: string; title: string };

export default function SubjectRoute() {
  const { id } = useParams<{ id: string }>();
  return <SubjectView key={id} id={id} />;
}

function SubjectView({ id }: { id: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [freeNotebooks, setFreeNotebooks] = useState<RootPage[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [editing, setEditing] = useState(false);
  const [links, setLinks] = useState<TopicLink[]>([]);
  const [treePages, setTreePages] = useState<TreePage[] | null>(null);
  const [picking, setPicking] = useState<null | { topicId: string | null }>(null);
  const [chosen, setChosen] = useState<null | { pageId: string; topicId: string | null }>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nesting, setNesting] = useState<Topic | null>(null);
  const [drag, setDrag] = useState<null | { id: string; target: string | null; zone: DropZone | null }>(null);
  const topicsRef = useRef<Topic[]>([]);
  topicsRef.current = topics;

  async function load() {
    const { data: s } = await supabase.from("subjects").select("*").eq("id", id).maybeSingle();
    if (!s) return setNotFound(true);
    setSubject(s as Subject);
    const { data: t } = await supabase.from("topics").select("*").eq("subject_id", id).order("position").order("created_at");
    setTopics(cleanParents((t ?? []) as Topic[]));

    // páginas vinculadas a cada assunto (tabela do schema15.sql; sem ela, a tela funciona como antes)
    const topicIds = ((t ?? []) as Topic[]).map((x) => x.id);
    if (topicIds.length) {
      const { data: tl, error: tlError } = await supabase.from("topic_pages").select("*").in("topic_id", topicIds);
      setLinks(tlError ? [] : ((tl ?? []) as TopicLink[]));
    } else setLinks([]);
    setTreePages(await loadTreePages());

    // cadernos que ainda não pertencem a nenhuma disciplina (para vincular)
    const [roots, subs] = await Promise.all([
      supabase.from("pages").select("id,title").is("parent_id", null),
      supabase.from("subjects").select("notebook_page_id"),
    ]);
    const used = new Set((subs.data ?? []).map((x) => x.notebook_page_id).filter(Boolean));
    setFreeNotebooks(((roots.data ?? []) as RootPage[]).filter((r) => !used.has(r.id)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateSubject(patch: Partial<Subject>) {
    setSubject((s) => (s ? { ...s, ...patch } : s));
    const { error } = await supabase.from("subjects").update(patch).eq("id", id);
    if (error) setError("Não foi possível salvar a alteração.");
  }

  async function createNotebook() {
    if (!subject) return;
    const { data, error } = await supabase
      .from("pages")
      .insert({ title: subject.name, type: "notebook", parent_id: null, icon: subject.icon })
      .select("id")
      .single();
    if (error || !data) return setError("Não foi possível criar o caderno.");
    await updateSubject({ notebook_page_id: data.id });
  }

  async function addTopic() {
    const clean = newTopic.trim();
    if (!clean) return;
    const { data, error } = await supabase
      .from("topics")
      .insert({ subject_id: id, name: clean, position: childrenOf(topics, null).length })
      .select("*")
      .single();
    if (error || !data) return setError("Não foi possível criar o assunto.");
    setTopics((list) => [...list, data as Topic]);
    setNewTopic("");
  }

  async function renameTopic(t: Topic, name: string) {
    const clean = name.trim();
    if (!clean || clean === t.name) return setTopics((l) => l.map((x) => (x.id === t.id ? { ...x, name: t.name } : x)));
    const { error } = await supabase.from("topics").update({ name: clean }).eq("id", t.id);
    if (error) setError("Não foi possível renomear o assunto.");
    else setTopics((l) => l.map((x) => (x.id === t.id ? { ...x, name: clean } : x)));
  }

  function askRename(t: Topic) {
    const name = window.prompt("Novo nome do assunto:", t.name);
    if (name !== null) renameTopic(t, name);
  }

  async function addSubtopic(parent: Topic) {
    const name = window.prompt(`Nome do subassunto de "${parent.name}":`)?.trim();
    if (!name) return;
    setError(null);
    const { data, error } = await supabase
      .from("topics")
      .insert({ subject_id: id, name, position: childrenOf(topics, parent.id).length, parent_id: parent.id })
      .select("*")
      .single();
    if (error || !data) return setError("Não foi possível criar o subassunto. Confira se o schema16.sql foi executado no Supabase.");
    setTopics((l) => [...l, data as Topic]);
    setExpanded((s) => new Set(s).add(parent.id));
  }

  // Grava só o que mudou. Se algo falhar, recarrega a tela para não mostrar uma ordem que não foi salva.
  async function persistMove(next: Topic[] | null) {
    if (!next) return;
    const changes = diffTopics(topicsRef.current, next);
    if (!changes.length) return;
    setTopics(next);
    const results = await Promise.all(changes.map((c) => supabase.from("topics").update(c.patch).eq("id", c.id)));
    if (results.some((r) => r.error)) {
      setError("Não foi possível salvar a nova organização. Se usou subassuntos, confirme que o schema16.sql foi executado.");
      await load();
    }
  }

  const toggle = (tid: string) => setExpanded((s) => { const n = new Set(s); if (n.has(tid)) n.delete(tid); else n.add(tid); return n; });

  // Arrastar pela alça ⠿: solta antes, depois ou dentro (meio do cartão) de outro assunto.
  function gripDown(e: React.PointerEvent<HTMLElement>, t: Topic) {
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* sem suporte: segue sem captura */ }
    let last: { id: string; target: string | null; zone: DropZone | null } = { id: t.id, target: null, zone: null };
    let y = e.clientY;
    setDrag(last);
    const pick = () => {
      const heads = Array.from(document.querySelectorAll<HTMLElement>("[data-topic-head]")).filter((h) => h.dataset.topicHead !== t.id);
      let best: { id: string; top: number; bottom: number; dist: number } | null = null;
      for (const h of heads) {
        const r = h.getBoundingClientRect();
        const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (!best || dist < best.dist) best = { id: h.dataset.topicHead!, top: r.top, bottom: r.bottom, dist };
      }
      if (!best) return;
      const zone = dropZone(best.top, best.bottom, y);
      const ok = applyDrop(topicsRef.current, t.id, best.id, zone) !== null;
      last = { id: t.id, target: ok ? best.id : null, zone: ok ? zone : null };
      setDrag(last);
    };
    const move = (ev: PointerEvent) => { y = ev.clientY; pick(); };
    const scroller = window.setInterval(() => {
      if (y < 80) window.scrollBy(0, -14);
      else if (y > window.innerHeight - 80) window.scrollBy(0, 14);
    }, 30);
    const end = (ev: PointerEvent, cancelled: boolean) => {
      window.clearInterval(scroller);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      if (!cancelled) {
        y = ev.clientY;
        pick();
        if (last.target && last.zone) {
          if (last.zone === "inside") setExpanded((s) => new Set(s).add(last.target!));
          void persistMove(applyDrop(topicsRef.current, t.id, last.target, last.zone));
        }
      }
      setDrag(null);
    };
    const up = (ev: PointerEvent) => end(ev, false);
    const cancel = (ev: PointerEvent) => end(ev, true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
  }

  async function removeTopic(t: Topic) {
    if (!window.confirm(`Excluir o assunto "${t.name}"? A página dele no caderno, se existir, continua no caderno.`)) return;
    const { error } = await supabase.from("topics").delete().eq("id", t.id);
    if (error) return setError("Não foi possível excluir o assunto.");
    // subassuntos não são apagados: viram assuntos principais (o banco faz isso sozinho)
    setTopics((l) => l.filter((x) => x.id !== t.id).map((x) => (x.parent_id === t.id ? { ...x, parent_id: null } : x)));
  }

  const linksOf = (t: Topic) => links.filter((l) => l.topic_id === t.id);

  // Tira a página do assunto. A página em si nunca é apagada.
  async function unlink(t: Topic, pageId: string) {
    if (!window.confirm("Tirar esta página do assunto?\n\nA página não é apagada: continua salva no caderno dela.")) return;
    setError(null);
    if (t.page_id === pageId) {
      const { error } = await supabase.from("topics").update({ page_id: null }).eq("id", t.id);
      if (error) return setError("Não foi possível tirar a página do assunto.");
      setTopics((l) => l.map((x) => (x.id === t.id ? { ...x, page_id: null } : x)));
    }
    if (links.some((l) => l.topic_id === t.id && l.page_id === pageId)) {
      const { error } = await supabase.from("topic_pages").delete().eq("topic_id", t.id).eq("page_id", pageId);
      if (error) return setError("Não foi possível tirar a página do assunto.");
      setLinks((l) => l.filter((x) => !(x.topic_id === t.id && x.page_id === pageId)));
    }
  }

  // Vincular: a página fica onde está e ganha um atalho no assunto. Transferir: além disso, muda para o caderno da disciplina.
  async function doImport(choice: string, mode: ImportMode) {
    if (!chosen || !subject) return;
    const page = treePages?.find((p) => p.id === chosen.pageId);
    if (!page) return;
    const title = page.title || "Sem título";
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "move") {
        const check = transferCheck(treePages ?? [], page.id, subject.notebook_page_id);
        if (!check.ok) return setError(check.reason ?? "Não dá para transferir esta página.");
      }
      let topic = topics.find((t) => t.id === choice) ?? null;
      if (choice === NEW_TOPIC) {
        const { data, error } = await supabase.from("topics").insert({ subject_id: id, name: title, position: childrenOf(topics, null).length }).select("*").single();
        if (error || !data) return setError("Não foi possível criar o assunto.");
        topic = data as Topic;
        setTopics((l) => [...l, data as Topic]);
      }
      if (!topic) return;
      const already = topicPageIds(topic, linksOf(topic)).includes(page.id);
      if (already && mode === "link") return setNotice("Esta página já está neste assunto.");

      let created: TopicLink | null = null;
      if (!already) {
        const { data, error } = await supabase
          .from("topic_pages")
          .insert({ topic_id: topic.id, page_id: page.id, position: linksOf(topic).length })
          .select("*")
          .single();
        if (error || !data) return setError("Não foi possível vincular. Confira se o schema15.sql foi executado no Supabase.");
        created = data as TopicLink;
      }
      if (mode === "move") {
        const ok = await movePage(page.id, subject.notebook_page_id);
        if (!ok) {
          if (created) await supabase.from("topic_pages").delete().eq("id", created.id); // desfaz o vínculo
          return setError("Não foi possível transferir a página. Nada foi alterado.");
        }
        setTreePages((l) => l && l.map((p) => (p.id === page.id ? { ...p, parent_id: subject.notebook_page_id } : p)));
      }
      if (created) setLinks((l) => [...l, created!]);
      setNotice(
        mode === "move"
          ? `“${title}” foi transferida para o caderno da disciplina e ligada a “${topic.name}”.`
          : `“${title}” foi vinculada a “${topic.name}”. Continua no caderno original.`
      );
      setChosen(null);
    } finally {
      setImporting(false);
    }
  }

  // Cria, dentro do caderno da disciplina, uma página de aula (com o molde de sempre) para este assunto.
  async function createTopicPage(t: Topic) {
    if (!subject?.notebook_page_id) return;
    const { data, error } = await supabase
      .from("pages")
      .insert({ title: t.name, type: "lesson", parent_id: subject.notebook_page_id, content: LESSON_TEMPLATE })
      .select("id")
      .single();
    if (error || !data) return setError("Não foi possível criar a página do assunto.");
    await supabase.from("topics").update({ page_id: data.id }).eq("id", t.id);
    router.push(`/p/${data.id}`);
  }

  async function removeSubject() {
    if (!subject) return;
    const n = topics.length;
    const ok = window.confirm(
      `Excluir a disciplina "${subject.name}"?\n\n` +
        `• ${n} ${n === 1 ? "assunto será excluído" : "assuntos serão excluídos"} (são só rótulos).\n` +
        `• O caderno e todas as páginas continuam salvos e passam a aparecer em Cadernos.\n` +
        `• Nada do que você escreveu é apagado.`
    );
    if (!ok) return;
    const { error } = await supabase.from("subjects").delete().eq("id", id);
    if (error) return setError("Não foi possível excluir a disciplina.");
    router.push("/disciplinas");
  }

  function renderTopic(t: Topic, isChild: boolean): React.ReactNode {
    const ids = topicPageIds(t, linksOf(t));
    const subs = childrenOf(topics, t.id);
    const pages: PageItem[] = ids.map((pid) => {
      const pg = treePages?.find((x) => x.id === pid);
      return { id: pid, title: pg?.title ?? "", icon: pg?.icon ?? null, type: pg?.type ?? "page", path: treePages && pg ? pathLabel(treePages, pid) : "" };
    });
    const sibs = childrenOf(topics, t.parent_id ?? null);
    const idx = sibs.findIndex((x) => x.id === t.id);
    const subtitle = [countLabel(ids.length), subs.length ? `${subs.length} ${subs.length === 1 ? "subassunto" : "subassuntos"}` : ""].filter(Boolean).join(" · ");
    const open = expanded.has(t.id);
    return (
      <TopicCard
        key={t.id}
        id={t.id}
        name={t.name}
        isChild={isChild}
        subtitle={subtitle}
        pages={pages}
        expanded={open}
        dragging={drag?.id === t.id}
        drop={drag && drag.target === t.id ? drag.zone : null}
        canUp={idx > 0}
        canDown={idx >= 0 && idx < sibs.length - 1}
        canNest={nestTargets(topics, t.id).length > 0}
        // um conteúdo só e nenhum subassunto: toque abre direto no caderno; senão, abre/fecha o assunto
        onHead={() => (ids.length === 1 && subs.length === 0 ? router.push(`/p/${ids[0]}`) : toggle(t.id))}
        onToggle={() => toggle(t.id)}
        onImport={() => setPicking({ topicId: t.id })}
        onAddSub={() => addSubtopic(t)}
        onRename={() => askRename(t)}
        onUp={() => persistMove(shiftTopic(topics, t.id, -1))}
        onDown={() => persistMove(shiftTopic(topics, t.id, 1))}
        onNest={() => setNesting(t)}
        onUnnest={() => persistMove(unnestTopic(topics, t.id))}
        onDelete={() => removeTopic(t)}
        onUnlink={(pid) => unlink(t, pid)}
        onGrip={(e) => gripDown(e, t)}
      >
        {subs.length > 0 ? subs.map((c) => renderTopic(c, true)) : null}
      </TopicCard>
    );
  }

  if (notFound) return <p className="empty">Disciplina não encontrada. <Link href="/disciplinas">Voltar às disciplinas</Link></p>;
  if (!subject) return <p className="muted">Carregando…</p>;

  return (
    <div style={{ ["--c" as string]: subject.color }}>
      <nav className="crumbs" aria-label="Caminho">
        <Link href="/disciplinas">Disciplinas</Link>
      </nav>

      <div className="subject-head">
        <span className="dicon big" aria-hidden>{subject.icon || "📘"}</span>
        <h1 className="display">{subject.name}</h1>
      </div>
      {error && <p className="notice">{error}</p>}
      {notice && <p className="notice ok" role="status">{notice}</p>}

      <div className="row">
        {subject.notebook_page_id ? (
          <Link className="primary btn-link" href={`/p/${subject.notebook_page_id}`}>Abrir caderno digital</Link>
        ) : (
          <button className="primary" onClick={createNotebook}>Criar caderno digital</button>
        )}
        <button className="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Fechar edição" : "Editar disciplina"}</button>
      </div>

      {!subject.notebook_page_id && freeNotebooks.length > 0 && (
        <label className="link-existing">
          Ou vincular um caderno que você já tem
          <select
            defaultValue=""
            onChange={(e) => e.target.value && updateSubject({ notebook_page_id: e.target.value })}
          >
            <option value="" disabled>Escolher caderno…</option>
            {freeNotebooks.map((p) => (
              <option key={p.id} value={p.id}>{p.title || "Sem título"}</option>
            ))}
          </select>
        </label>
      )}

      {editing && (
        <div className="panel">
          <label>
            Nome
            <input
              defaultValue={subject.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== subject.name && updateSubject({ name: e.target.value.trim() })}
            />
          </label>
          <p className="sheet-label">Cor</p>
          <ColorPicker value={subject.color} onChange={(c) => updateSubject({ color: c })} />
          <p className="sheet-label">Ícone</p>
          <IconPicker value={subject.icon ?? ""} onChange={(i) => updateSubject({ icon: i || null })} />
        </div>
      )}

      <section className="subpages">
        <h2>Conteúdo da disciplina</h2>
        <form className="row topic-add" onSubmit={(e) => { e.preventDefault(); addTopic(); }}>
          <input value={newTopic} placeholder="Novo assunto" aria-label="Nome do novo assunto" onChange={(e) => setNewTopic(e.target.value)} />
          <button className="secondary" type="submit" disabled={!newTopic.trim()}>Adicionar</button>
        </form>

        {topics.length === 0 ? (
          <p className="empty">Nenhum assunto ainda. Adicione os temas desta disciplina.</p>
        ) : (
          <ul className="topics topic-tree">{childrenOf(topics, null).map((t) => renderTopic(t, false))}</ul>
        )}

        <div className="row topic-import">
          <button type="button" className="secondary" onClick={() => setPicking({ topicId: null })}>⤓ Importar de outro caderno</button>
        </div>
      </section>

      {nesting && (
        <TopicParentPicker
          name={nesting.name}
          options={nestTargets(topics, nesting.id)}
          onClose={() => setNesting(null)}
          onPick={(parentId) => {
            const me = nesting;
            setNesting(null);
            setExpanded((x) => new Set(x).add(parentId));
            void persistMove(moveTopic(topicsRef.current, me.id, parentId, childrenOf(topicsRef.current, parentId).length));
          }}
        />
      )}

      {picking && (
        <PageMovePicker
          mode="pick"
          title="Importar de outro caderno"
          hint="Escolha a página ou aula que você já tem em qualquer caderno."
          excludeIds={picking.topicId ? topicPageIds(topics.find((t) => t.id === picking.topicId) ?? { page_id: null }, links.filter((l) => l.topic_id === picking.topicId)) : []}
          onPick={(pageId) => { setChosen({ pageId, topicId: picking.topicId }); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
      {chosen && treePages && treePages.some((p) => p.id === chosen.pageId) && (
        <ImportToTopic
          page={treePages.find((p) => p.id === chosen.pageId)!}
          pages={treePages}
          topics={topics}
          presetTopicId={chosen.topicId}
          notebookId={subject.notebook_page_id}
          busy={importing}
          onConfirm={doImport}
          onClose={() => setChosen(null)}
        />
      )}

      <button className="danger" onClick={removeSubject}>Excluir disciplina</button>
    </div>
  );
}
