"use client";

import Link from "next/link";
import { useState } from "react";
import { CornerLeftUp, FolderInput, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { deletePages, deletionMessage, movePage, planDeletion, saveOrder } from "@/lib/page-ops";
import { reorderIds } from "@/lib/page-tree";
import type { PageRow } from "@/lib/types";
import PageMovePicker from "@/components/PageMovePicker";
import PageRowMenu from "@/components/PageRowMenu";

type Props = {
  parent: PageRow;
  /** Quem contém a página atual (null se ela é um caderno principal). Para onde "subir um nível" leva. */
  grandparent: { id: string; title: string } | null;
  items: PageRow[];
  setItems: (updater: (current: PageRow[]) => PageRow[]) => void;
  reload: () => Promise<void>;
  onAdd: (kind: "lesson" | "page") => void;
  onError: (message: string | null) => void;
};

/** Tabela "Aulas e páginas": editar título e data, subir/descer, mover, trazer de outro lugar e excluir. */
export default function SubpagesTable({ parent, grandparent, items, setItems, reload, onAdd, onError }: Props) {
  const isLesson = parent.type === "lesson";
  const [picker, setPicker] = useState<{ mode: "move"; page: PageRow } | { mode: "bring" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function updateChild(childId: string, patch: Partial<PageRow>) {
    const { error } = await supabase.from("pages").update(patch).eq("id", childId);
    if (error) onError("Não foi possível salvar a alteração na tabela.");
  }
  const editLocal = (childId: string, patch: Partial<PageRow>) => setItems((list) => list.map((c) => (c.id === childId ? { ...c, ...patch } : c)));

  async function reorder(index: number, direction: -1 | 1) {
    const ids = reorderIds(items.map((c) => c.id), index, direction);
    if (!ids || busy) return;
    const previous = items;
    const byId = new Map(items.map((c) => [c.id, c]));
    setItems(() => ids.map((id, position) => ({ ...byId.get(id)!, position })));
    onError(null);
    if (!(await saveOrder(ids))) { setItems(() => previous); onError("Não foi possível salvar a nova ordem. Tente de novo."); }
  }

  async function relocate(pageId: string, destinationId: string | null, success: string) {
    setBusy(true);
    onError(null);
    const ok = await movePage(pageId, destinationId);
    if (!ok) onError("Não foi possível mover. Tente de novo.");
    else await reload();
    setBusy(false);
    return ok ? success : null;
  }

  async function remove(page: PageRow) {
    onError(null);
    const plan = await planDeletion(page.id);
    if (!plan) return onError("Não foi possível conferir o que será excluído. Tente de novo.");
    if (!window.confirm(deletionMessage(page.title, plan))) return;
    setBusy(true);
    if (await deletePages(plan.ids)) setItems((list) => list.filter((c) => c.id !== page.id));
    else onError("Não foi possível excluir. Tente de novo.");
    setBusy(false);
  }

  return (
    <section className="subpages">
      <div className="head">
        <h2>{isLesson ? "Páginas dentro desta aula" : "Aulas e páginas"}</h2>
        <div className="row">
          <button className="primary" onClick={() => onAdd("lesson")}>Nova aula</button>
          <button className="secondary" onClick={() => onAdd("page")}>Nova página</button>
          <button className="secondary with-icon" onClick={() => setPicker({ mode: "bring" })}><FolderInput size={15} aria-hidden="true" /> Trazer para cá</button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="empty">Nada aqui ainda. Crie uma aula para registrar tema, data e anotações, ou traga uma página de outro lugar.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Aula / tema</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {items.map((c, index) => {
                const canLift = grandparent !== null || c.type === "notebook";
                return (
                  <tr key={c.id}>
                    <td><input value={c.title} aria-label="Título" onChange={(e) => editLocal(c.id, { title: e.target.value })} onBlur={(e) => updateChild(c.id, { title: e.target.value })} /></td>
                    <td>
                      <input type="date" value={c.props?.date ?? ""} aria-label="Data" onChange={(e) => { const props = { ...c.props, date: e.target.value }; editLocal(c.id, { props }); updateChild(c.id, { props }); }} />
                    </td>
                    <td className="row-actions">
                      <Link className="open" href={`/p/${c.id}`}>Abrir</Link>
                      <PageRowMenu
                        name={c.title || "Sem título"}
                        canUp={index > 0 && !busy}
                        canDown={index < items.length - 1 && !busy}
                        onUp={() => void reorder(index, -1)}
                        onDown={() => void reorder(index, 1)}
                        items={[
                          { label: "Mover para…", icon: <FolderInput size={16} aria-hidden="true" />, onClick: () => setPicker({ mode: "move", page: c }) },
                          { label: grandparent ? `Subir para "${grandparent.title || "Sem título"}"` : "Tornar caderno principal", icon: <CornerLeftUp size={16} aria-hidden="true" />, hidden: !canLift, onClick: () => void relocate(c.id, grandparent?.id ?? null, "ok") },
                          { label: "Excluir", icon: <Trash2 size={16} aria-hidden="true" />, danger: true, onClick: () => void remove(c) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {picker?.mode === "move" && (
        <PageMovePicker mode="move" moving={{ id: picker.page.id, title: picker.page.title, icon: picker.page.icon, type: picker.page.type, parent_id: picker.page.parent_id }} onClose={() => setPicker(null)} onPick={(destination) => { setPicker(null); void relocate(picker.page.id, destination, "ok"); }} />
      )}
      {picker?.mode === "bring" && (
        <PageMovePicker mode="bring" targetId={parent.id} targetTitle={parent.title || "Sem título"} onClose={() => setPicker(null)} onPick={(pageId) => { setPicker(null); void relocate(pageId, parent.id, "ok"); }} />
      )}
    </section>
  );
}
