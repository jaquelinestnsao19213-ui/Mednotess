"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LESSON_TEMPLATE } from "@/lib/doc";
import type { Subject, Topic } from "@/lib/types";
import { ColorPicker, IconPicker } from "@/components/SubjectBits";

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

  async function load() {
    const { data: s } = await supabase.from("subjects").select("*").eq("id", id).maybeSingle();
    if (!s) return setNotFound(true);
    setSubject(s as Subject);
    const { data: t } = await supabase.from("topics").select("*").eq("subject_id", id).order("position").order("created_at");
    setTopics((t ?? []) as Topic[]);

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
          <ul className="topics">
            {topics.map((t) => (
              <li key={t.id}>
                <input defaultValue={t.name} aria-label="Nome do assunto" onBlur={(e) => renameTopic(t, e.target.value)} />
                {t.page_id ? (
                  <Link className="open" href={`/p/${t.page_id}`}>Abrir página</Link>
                ) : (
                  <button className="open" disabled={!subject.notebook_page_id} onClick={() => createTopicPage(t)}>Criar página</button>
                )}
                <button className="icon-del" aria-label={`Excluir assunto ${t.name}`} onClick={() => removeTopic(t)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="danger" onClick={removeSubject}>Excluir disciplina</button>
    </div>
  );
}
