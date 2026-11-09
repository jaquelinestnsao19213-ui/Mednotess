"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FolderInput, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { deletePages, deletionMessage, movePage, planDeletion, saveOrder } from "@/lib/page-ops";
import { reorderIds } from "@/lib/page-tree";
import type { PageRow } from "@/lib/types";
import PageMovePicker from "@/components/PageMovePicker";
import PageRowMenu from "@/components/PageRowMenu";

export default function Home() {
  const router = useRouter();
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mode: "move"; page: PageRow } | { mode: "bring" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("pages").select("*").is("parent_id", null).order("position").order("created_at");
    if (loadError) setError("Não foi possível carregar os cadernos.");
    else setPages(data as PageRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createNotebook() {
    const { data, error: createError } = await supabase
      .from("pages")
      .insert({ title: "Novo caderno", type: "notebook", parent_id: null, position: pages?.length ?? 0 })
      .select("id")
      .single();
    if (createError || !data) return setError("Não foi possível criar o caderno.");
    router.push(`/p/${data.id}`);
  }

  async function reorder(index: number, direction: -1 | 1) {
    if (!pages || busy) return;
    const ids = reorderIds(pages.map((p) => p.id), index, direction);
    if (!ids) return;
    const previous = pages;
    const byId = new Map(pages.map((p) => [p.id, p]));
    setPages(ids.map((id, position) => ({ ...byId.get(id)!, position })));
    setError(null);
    if (!(await saveOrder(ids))) { setPages(previous); setError("Não foi possível salvar a nova ordem. Tente de novo."); }
  }

  async function relocate(pageId: string, destination: string | null) {
    setBusy(true);
    setError(null);
    if (!(await movePage(pageId, destination))) setError("Não foi possível mover. Tente de novo.");
    else await load();
    setBusy(false);
  }

  async function remove(page: PageRow) {
    setError(null);
    const plan = await planDeletion(page.id);
    if (!plan) return setError("Não foi possível conferir o que será excluído. Tente de novo.");
    if (!window.confirm(deletionMessage(page.title, plan))) return;
    setBusy(true);
    if (await deletePages(plan.ids)) setPages((list) => (list ? list.filter((p) => p.id !== page.id) : list));
    else setError("Não foi possível excluir. Tente de novo.");
    setBusy(false);
  }

  return (
    <>
      <div className="head">
        <h1 className="display">Seus cadernos</h1>
        <div className="row">
          <button className="secondary with-icon" onClick={() => setPicker({ mode: "bring" })}><FolderInput size={15} aria-hidden="true" /> Trazer caderno</button>
          <button className="primary" onClick={createNotebook}>Novo caderno</button>
        </div>
      </div>
      {error && <p className="notice">{error}</p>}
      {pages === null && !error && <p className="muted">Carregando…</p>}
      {pages?.length === 0 && (
        <p className="empty">Nenhum caderno ainda. Crie o primeiro para guardar suas aulas.</p>
      )}
      <ul className="list list-actions">
        {pages?.map((p, index) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`}>{p.icon ? `${p.icon} ` : ""}{p.title || "Sem título"}</Link>
            <PageRowMenu
              name={p.title || "Sem título"}
              canUp={index > 0 && !busy}
              canDown={index < pages.length - 1 && !busy}
              onUp={() => void reorder(index, -1)}
              onDown={() => void reorder(index, 1)}
              items={[
                { label: "Mover para dentro de…", icon: <FolderInput size={16} aria-hidden="true" />, onClick: () => setPicker({ mode: "move", page: p }) },
                { label: "Excluir", icon: <Trash2 size={16} aria-hidden="true" />, danger: true, onClick: () => void remove(p) },
              ]}
            />
          </li>
        ))}
      </ul>
      {picker?.mode === "move" && (
        <PageMovePicker mode="move" moving={{ id: picker.page.id, title: picker.page.title, icon: picker.page.icon, type: picker.page.type, parent_id: picker.page.parent_id }} onClose={() => setPicker(null)} onPick={(destination) => { setPicker(null); void relocate(picker.page.id, destination); }} />
      )}
      {picker?.mode === "bring" && (
        <PageMovePicker mode="bring" targetId={null} targetTitle="Cadernos principais" onClose={() => setPicker(null)} onPick={(pageId) => { setPicker(null); void relocate(pageId, null); }} />
      )}
    </>
  );
}
