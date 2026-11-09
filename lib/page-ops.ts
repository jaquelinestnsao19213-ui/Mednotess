// Operações no banco para organizar cadernos, aulas e páginas (mover, ordenar, apagar).
import { supabase } from "@/lib/supabase";
import { descendantIds, type TreePage } from "@/lib/page-tree";

/** Todas as páginas da conta, só com os campos leves (sem o conteúdo). */
export async function loadTreePages(): Promise<TreePage[] | null> {
  const { data, error } = await supabase.from("pages").select("id,title,icon,type,parent_id,position").limit(5000);
  return error ? null : ((data ?? []) as TreePage[]);
}

/** Grava a ordem: a posição de cada item passa a ser o seu índice na lista. */
export async function saveOrder(orderedIds: string[]): Promise<boolean> {
  const results = await Promise.all(orderedIds.map((id, position) => supabase.from("pages").update({ position }).eq("id", id)));
  return results.every((result) => !result.error);
}

async function nextPosition(parentId: string | null): Promise<number> {
  const query = supabase.from("pages").select("id", { count: "exact", head: true });
  const { count } = await (parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId));
  return count ?? 0;
}

/** Muda de lugar (vai para o fim da lista de destino). */
export async function movePage(id: string, parentId: string | null): Promise<boolean> {
  const position = await nextPosition(parentId);
  const { error } = await supabase.from("pages").update({ parent_id: parentId, position }).eq("id", id);
  return !error;
}

export type DeletionPlan = { ids: string[]; inside: number; linkedSubjects: string[] };

/** O que será apagado junto: tudo o que está dentro e as disciplinas ligadas a esses cadernos. */
export async function planDeletion(id: string): Promise<DeletionPlan | null> {
  const pages = await loadTreePages();
  if (!pages) return null;
  const ids = [id, ...descendantIds(pages, id)];
  const { data } = await supabase.from("subjects").select("name").in("notebook_page_id", ids);
  return { ids, inside: ids.length - 1, linkedSubjects: ((data ?? []) as { name: string }[]).map((subject) => subject.name) };
}

/** Apaga tudo de uma vez, o que funciona com ou sem exclusão em cascata no banco. */
export async function deletePages(ids: string[]): Promise<boolean> {
  const { error } = await supabase.from("pages").delete().in("id", ids);
  return !error;
}

export function deletionMessage(title: string, plan: DeletionPlan): string {
  const parts = [`Excluir "${title || "Sem título"}"${plan.inside ? ` e ${plan.inside} ${plan.inside === 1 ? "página dentro dela" : "páginas dentro dela"}` : ""}? Isso não pode ser desfeito.`];
  if (plan.linkedSubjects.length) parts.push(`A disciplina ${plan.linkedSubjects.join(", ")} ficará sem caderno.`);
  return parts.join("\n\n");
}
