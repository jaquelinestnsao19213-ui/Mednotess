"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Subject } from "@/lib/types";
import { COLORS, ColorPicker, ICONS, IconPicker } from "@/components/SubjectBits";

export default function Subjects() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);

  useEffect(() => {
    supabase
      .from("subjects")
      .select("*")
      .order("position")
      .order("created_at")
      .then(({ data, error }) => {
        if (error) setError("Não foi possível carregar as disciplinas. Confira se rodou o schema4.sql no Supabase.");
        else setSubjects((data ?? []) as Subject[]);
      });
  }, []);

  async function create() {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    // 1) cria o caderno da disciplina (uma página, como as que você já usa)
    const { data: page, error: e1 } = await supabase
      .from("pages")
      .insert({ title: clean, type: "notebook", parent_id: null, icon: icon || null })
      .select("id")
      .single();
    if (e1 || !page) {
      setBusy(false);
      return setError("Não foi possível criar o caderno da disciplina.");
    }
    // 2) cria a disciplina apontando para esse caderno
    const { data: sub, error: e2 } = await supabase
      .from("subjects")
      .insert({ name: clean, color, icon: icon || null, notebook_page_id: page.id, position: subjects?.length ?? 0 })
      .select("id")
      .single();
    if (e2 || !sub) {
      await supabase.from("pages").delete().eq("id", page.id); // desfaz, para não sobrar caderno solto
      setBusy(false);
      return setError("Não foi possível criar a disciplina. Confira se rodou o schema4.sql no Supabase.");
    }
    router.push(`/disciplinas/${sub.id}`);
  }

  return (
    <>
      <div className="head">
        <h1 className="display">Minhas disciplinas</h1>
        {!creating && <button className="primary" onClick={() => setCreating(true)}>Nova disciplina</button>}
      </div>
      {error && <p className="notice">{error}</p>}

      {creating && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <label>
            Nome
            <input value={name} autoFocus placeholder="Ex.: Farmacologia" onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="sheet-label">Cor</p>
          <ColorPicker value={color} onChange={setColor} />
          <p className="sheet-label">Ícone</p>
          <IconPicker value={icon} onChange={setIcon} />
          <div className="row">
            <button className="primary" type="submit" disabled={!name.trim() || busy}>Criar disciplina</button>
            <button className="secondary" type="button" onClick={() => setCreating(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {subjects === null && !error && <p className="muted">Carregando…</p>}
      {subjects?.length === 0 && !creating && (
        <p className="empty">Nenhuma disciplina ainda. Cada uma ganha o seu caderno digital e os seus assuntos.</p>
      )}
      <div className="cards">
        {subjects?.map((s) => (
          <Link key={s.id} href={`/disciplinas/${s.id}`} className="dcard link" style={{ ["--c" as string]: s.color }}>
            <span className="dicon" aria-hidden>{s.icon || "📘"}</span>
            <strong>{s.name}</strong>
          </Link>
        ))}
      </div>
    </>
  );
}
