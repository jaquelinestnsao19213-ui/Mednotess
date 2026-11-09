"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LESSON_TEMPLATE } from "@/lib/doc";
import type { Subject, Topic, TopicLink } from "@/lib/types";
import { ColorPicker, IconPicker } from "@/components/SubjectBits";
import PageMovePicker from "@/components/PageMovePicker";
import ImportToTopic, { NEW_TOPIC } from "@/components/ImportToTopic";
import { loadTreePages, movePage } from "@/lib/page-ops";
import { TYPE_LABEL, pathLabel, type TreePage } from "@/lib/page-tree";
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

  async function load() {
    const { data: s } = await supabase.from("subjects").select("*").eq("id", id).maybeSingle();
    if (!s) return setNotFound(true);
    setSubject(s as Subject);
    const { data: t } = await supabase.from("topics").select("*").eq("subject_id", id).order("position").order("created_at");
    setTopics((t ?? []) as Topic[]);

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
      .insert({ subject_id: id, name: clean, position: topics.length })
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

  async function removeTopic(t: Topic) {
    if (!window.confirm(`Excluir o assunto "${t.name}"? A página dele no caderno, se existir, continua no caderno.`)) return;
    const { error } = await supabase.from("topics").delete().eq("id", t.id);
    if (error) return setError("Não foi possível excluir o assunto.");
    setTopics((l) => l.filter((x) => x.id !== t.id));
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
        const { data, error } = await supabase.from("topics").insert({ subject_id: id, name: title, position: topics.length }).select("*").single();
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
        <h2>Assuntos</h2>
        <form className="row topic-add" onSubmit={(e) => { e.preventDefault(); addTopic(); }}>
          <input value={newTopic} placeholder="Novo assunto" aria-label="Nome do novo assunto" onChange={(e) => setNewTopic(e.target.value)} />
          <button className="secondary" type="submit" disabled={!newTopic.trim()}>Adicionar</button>
        </form>

        {topics.length === 0 ? (
          <p className="empty">Nenhum assunto ainda. Adicione os temas desta disciplina.</p>
        ) : (
          <ul className="topics topic-cards">
            {topics.map((t) => {
              const ids = topicPageIds(t, linksOf(t));
              return (
                <li key={t.id} className="topic-card">
                  <div className="topic-line">
                    <input defaultValue={t.name} aria-label="Nome do assunto" onBlur={(e) => renameTopic(t, e.target.value)} />
                    {t.page_id ? (
                      <Link className="open" href={`/p/${t.page_id}`}>Abrir página</Link>
                    ) : (
                      <button className="open" disabled={!subject.notebook_page_id} onClick={() => createTopicPage(t)}>Criar página</button>
                    )}
                    <button className="icon-del" aria-label={`Excluir assunto ${t.name}`} onClick={() => removeTopic(t)}>✕</button>
                  </div>
                  <p className="topic-meta">{countLabel(ids.length)}</p>
                  {ids.length > 0 && (
                    <details className="topic-related">
                      <summary>Conteúdos relacionados</summary>
                      <ul>
                        {ids.map((pid) => {
                          const page = treePages?.find((p) => p.id === pid);
                          const where = treePages && page ? pathLabel(treePages, pid) : "";
                          return (
                            <li key={pid}>
                              <Link href={`/p/${pid}`}>
                                <span aria-hidden="true">{page?.icon || (page?.type === "notebook" ? "📓" : page?.type === "lesson" ? "📚" : "📄")}</span>
                                <span className="tr-text"><strong>{page?.title || "Sem título"}</strong>{where && <small>{where}</small>}</span>
                                {page && <span className="pm-tag">{TYPE_LABEL[page.type] ?? ""}</span>}
                              </Link>
                              <button type="button" className="tr-unlink" aria-label={`Tirar ${page?.title || "página"} do assunto ${t.name}`} onClick={() => unlink(t, pid)}>Desvincular</button>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                  <button type="button" className="secondary small" onClick={() => setPicking({ topicId: t.id })}>＋ Importar página</button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="row topic-import">
          <button type="button" className="secondary" onClick={() => setPicking({ topicId: null })}>⤓ Importar de outro caderno</button>
        </div>
      </section>

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
