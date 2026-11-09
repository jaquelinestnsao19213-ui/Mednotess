// Regras puras de "assunto ↔ páginas": quais páginas aparecem, como contar e quando dá para transferir.
import type { Topic, TopicLink } from "./types";
import { canMoveTo, type TreePage } from "./page-tree";

export type ImportMode = "link" | "move";

/** Páginas do assunto sem repetir: a página principal (page_id) primeiro, depois os atalhos na ordem. */
export function topicPageIds(topic: Pick<Topic, "page_id">, links: TopicLink[]): string[] {
  const ids: string[] = [];
  if (topic.page_id) ids.push(topic.page_id);
  for (const link of [...links].sort((a, b) => a.position - b.position)) {
    if (!ids.includes(link.page_id)) ids.push(link.page_id);
  }
  return ids;
}

export function countLabel(n: number): string {
  if (n <= 0) return "Nenhuma aula ou página ainda";
  return n === 1 ? "1 aula ou página" : `${n} aulas e páginas`;
}

/** Dá para mover a página para dentro do caderno da disciplina? Se não, explica por quê. */
export function transferCheck(pages: TreePage[], pageId: string, notebookId: string | null): { ok: boolean; reason?: string } {
  if (!notebookId) return { ok: false, reason: "Crie ou vincule o caderno digital desta disciplina para poder transferir." };
  const page = pages.find((p) => p.id === pageId);
  if (!page) return { ok: false, reason: "Página não encontrada." };
  if (page.parent_id === notebookId) return { ok: false, reason: "Esta página já está no caderno da disciplina. Basta vincular." };
  const rule = canMoveTo(pages, page, notebookId);
  return rule.ok ? { ok: true } : { ok: false, reason: `Não dá para transferir: ${rule.reason}.` };
}
