// Regras puras da árvore de cadernos, aulas e páginas: quem pode ir para onde, caminhos e ordem.
import type { PageRow } from "@/lib/types";

export type TreePage = { id: string; title: string; icon: string | null; type: PageRow["type"]; parent_id: string | null; position?: number | null };
export type Candidate = { id: string | null; title: string; icon: string | null; type: PageRow["type"] | "root"; path: string; disabled?: string };

export const TYPE_LABEL: Record<string, string> = { notebook: "Caderno", lesson: "Aula", page: "Página", diary: "Diário", task: "Tarefa", exam: "Prova", root: "Início" };
const ROOT_LABEL = "Início (cadernos principais)";

const byId = (pages: TreePage[]) => new Map(pages.map((page) => [page.id, page]));
export const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Tudo o que está dentro de `id`, em qualquer nível. */
export function descendantIds(pages: TreePage[], id: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const page of pages) if (page.parent_id) kids.set(page.parent_id, [...(kids.get(page.parent_id) ?? []), page.id]);
  const out = new Set<string>();
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    if (out.has(current)) continue; // proteção contra dados com laço
    out.add(current);
    stack.push(...(kids.get(current) ?? []));
  }
  return out;
}

/** Ancestrais de `id`, do pai para cima. */
export function ancestorIds(pages: TreePage[], id: string): string[] {
  const map = byId(pages);
  const out: string[] = [];
  let parent = map.get(id)?.parent_id ?? null;
  while (parent && !out.includes(parent) && out.length < 50) { out.push(parent); parent = map.get(parent)?.parent_id ?? null; }
  return out;
}

/** "Farmacologia / Aula de TBL" (os ancestrais de `id`, sem ele mesmo). */
export function pathLabel(pages: TreePage[], id: string): string {
  const map = byId(pages);
  return ancestorIds(pages, id).reverse().map((ancestor) => map.get(ancestor)?.title || "Sem título").join(" / ");
}

/** Só cadernos podem ficar na raiz (é o que a tela Cadernos e a Início listam). */
export function canMoveTo(pages: TreePage[], moving: TreePage, destinationId: string | null): { ok: boolean; reason?: string } {
  if (destinationId === moving.id) return { ok: false, reason: "não pode ficar dentro dela mesma" };
  if (destinationId === null) return moving.type === "notebook" ? { ok: true } : { ok: false, reason: "só cadernos ficam no início" };
  if (!byId(pages).has(destinationId)) return { ok: false, reason: "destino não encontrado" };
  if (descendantIds(pages, moving.id).has(destinationId)) return { ok: false, reason: "está dentro do que você quer mover" };
  return { ok: true };
}

/** Lugares para onde `moving` pode ir. O lugar onde já está aparece desativado. */
export function moveCandidates(pages: TreePage[], moving: TreePage): Candidate[] {
  const out: Candidate[] = [];
  if (moving.type === "notebook") out.push({ id: null, title: ROOT_LABEL, icon: null, type: "root", path: "", disabled: moving.parent_id === null ? "já está aqui" : undefined });
  for (const page of pages) {
    const rule = canMoveTo(pages, moving, page.id);
    if (!rule.ok) continue;
    out.push({ id: page.id, title: page.title || "Sem título", icon: page.icon, type: page.type, path: pathLabel(pages, page.id), disabled: page.id === moving.parent_id ? "já está aqui" : undefined });
  }
  return out;
}

/** Páginas que podem ser trazidas para dentro de `targetId` (null = cadernos principais). */
export function bringCandidates(pages: TreePage[], targetId: string | null): Candidate[] {
  const blocked = new Set<string>();
  if (targetId) { blocked.add(targetId); ancestorIds(pages, targetId).forEach((id) => blocked.add(id)); }
  return pages
    .filter((page) => !blocked.has(page.id) && page.parent_id !== targetId)
    .filter((page) => (targetId === null ? page.type === "notebook" : true))
    .map((page) => ({ id: page.id, title: page.title || "Sem título", icon: page.icon, type: page.type, path: pathLabel(pages, page.id) }));
}

export function searchCandidates(candidates: Candidate[], query: string): Candidate[] {
  const q = norm(query);
  if (!q) return candidates;
  return candidates.filter((candidate) => norm(`${candidate.title} ${candidate.path}`).includes(q));
}

/** Nova ordem depois de subir (-1) ou descer (+1) o item de índice `index`; null se já está no limite. */
export function reorderIds(ids: string[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
