// Árvore de assuntos da disciplina: assunto principal e subassuntos (2 níveis), ordem e arrastar.
// Tudo aqui é regra pura, sem banco: a tela chama e depois grava o que mudou.
import type { Topic } from "./types";

export type DropZone = "before" | "after" | "inside";

export const parentOf = (t: Pick<Topic, "parent_id">): string | null => t.parent_id ?? null;

const byOrder = (a: Topic, b: Topic) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Filhos diretos de `parentId` (null = assuntos principais), na ordem da tela. */
export function childrenOf(topics: Topic[], parentId: string | null): Topic[] {
  return topics.filter((t) => parentOf(t) === parentId).sort(byOrder);
}

/** Dados com defeito não quebram a tela: pai que não existe, ele mesmo ou que já é subassunto vira assunto principal. */
export function cleanParents(topics: Topic[]): Topic[] {
  const roots = new Set(topics.filter((t) => !t.parent_id || t.parent_id === t.id).map((t) => t.id));
  return topics.map((t) => (parentOf(t) !== null && (t.parent_id === t.id || !roots.has(t.parent_id as string)) ? { ...t, parent_id: null } : t));
}

/** Só existem dois níveis; um assunto com subassuntos não pode virar subassunto. */
export function canNest(topics: Topic[], id: string, parentId: string | null): { ok: boolean; reason?: string } {
  if (parentId === null) return { ok: true };
  if (parentId === id) return { ok: false, reason: "um assunto não pode ficar dentro dele mesmo" };
  const parent = topics.find((t) => t.id === parentId);
  if (!parent) return { ok: false, reason: "assunto de destino não encontrado" };
  if (parentOf(parent) !== null) return { ok: false, reason: "subassunto não recebe outro nível" };
  if (childrenOf(topics, id).length > 0) return { ok: false, reason: "este assunto já tem subassuntos" };
  return { ok: true };
}

/** Assuntos principais que podem receber `id` como subassunto. */
export function nestTargets(topics: Topic[], id: string): Topic[] {
  return childrenOf(topics, null).filter((t) => t.id !== id && canNest(topics, id, t.id).ok);
}

/** Move `id` para dentro de `parentId` na posição `index` (contada sem ele) e renumera os grupos afetados. */
export function moveTopic(topics: Topic[], id: string, parentId: string | null, index: number): Topic[] | null {
  const moving = topics.find((t) => t.id === id);
  if (!moving || !canNest(topics, id, parentId).ok) return null;
  const oldParent = parentOf(moving);
  const sibs = childrenOf(topics, parentId).filter((t) => t.id !== id);
  const at = Math.max(0, Math.min(index, sibs.length));
  const order = [...sibs.slice(0, at), moving, ...sibs.slice(at)];
  const next = new Map<string, { position: number; parent_id: string | null }>();
  order.forEach((t, i) => next.set(t.id, { position: i, parent_id: parentId }));
  if (oldParent !== parentId) childrenOf(topics, oldParent).filter((t) => t.id !== id).forEach((t, i) => next.set(t.id, { position: i, parent_id: oldParent }));
  return topics.map((t) => (next.has(t.id) ? { ...t, ...next.get(t.id)! } : t));
}

/** Sobe (-1) ou desce (+1) um lugar entre os irmãos; null se já está no limite. */
export function shiftTopic(topics: Topic[], id: string, dir: -1 | 1): Topic[] | null {
  const me = topics.find((t) => t.id === id);
  if (!me) return null;
  const sibs = childrenOf(topics, parentOf(me));
  const i = sibs.findIndex((t) => t.id === id);
  const target = i + dir;
  if (target < 0 || target >= sibs.length) return null;
  return moveTopic(topics, id, parentOf(me), target);
}

/** Tira o subassunto de dentro do pai e põe logo depois dele, como assunto principal. */
export function unnestTopic(topics: Topic[], id: string): Topic[] | null {
  const me = topics.find((t) => t.id === id);
  const parentId = me ? parentOf(me) : null;
  if (!me || !parentId) return null;
  const roots = childrenOf(topics, null).filter((t) => t.id !== id);
  return moveTopic(topics, id, null, roots.findIndex((t) => t.id === parentId) + 1);
}

/** Em que parte do cartão `top`..`bottom` o dedo está: borda de cima, borda de baixo ou no meio (= entrar nele). */
export function dropZone(top: number, bottom: number, y: number): DropZone {
  if (y < top) return "before";
  if (y > bottom) return "after";
  const f = (y - top) / Math.max(1, bottom - top);
  return f < 0.28 ? "before" : f > 0.72 ? "after" : "inside";
}

/** Resultado de soltar `dragId` sobre `targetId` naquela zona; null se não pode. */
export function applyDrop(topics: Topic[], dragId: string, targetId: string, zone: DropZone): Topic[] | null {
  const target = topics.find((t) => t.id === targetId);
  if (!target || dragId === targetId) return null;
  if (zone === "inside") {
    if (parentOf(target) !== null) return null;
    return moveTopic(topics, dragId, target.id, childrenOf(topics, target.id).filter((t) => t.id !== dragId).length);
  }
  const parent = parentOf(target);
  const sibs = childrenOf(topics, parent).filter((t) => t.id !== dragId);
  const at = sibs.findIndex((t) => t.id === targetId);
  return moveTopic(topics, dragId, parent, zone === "before" ? at : at + 1);
}

/** O que mudou entre as duas listas (só os campos que mudaram, para gravar o mínimo). */
export function diffTopics(prev: Topic[], next: Topic[]): { id: string; patch: { position?: number; parent_id?: string | null } }[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  const out: { id: string; patch: { position?: number; parent_id?: string | null } }[] = [];
  for (const t of next) {
    const old = before.get(t.id);
    if (!old) continue;
    const patch: { position?: number; parent_id?: string | null } = {};
    if (old.position !== t.position) patch.position = t.position;
    if (parentOf(old) !== parentOf(t)) patch.parent_id = parentOf(t);
    if (Object.keys(patch).length) out.push({ id: t.id, patch });
  }
  return out;
}
