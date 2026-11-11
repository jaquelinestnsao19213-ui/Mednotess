// Escolher um caderno (ou pasta) significa usar as aulas e páginas que estão dentro dele.
import { type TreePage, descendantIds } from "./page-tree";

const READABLE = new Set(["page", "lesson", "diary"]);

export function expandToPages(pages: TreePage[], chosen: string[], max = 24): { ids: string[]; fromContainers: number; truncated: boolean } {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: string[] = [];
  const seen = new Set<string>();
  let fromContainers = 0;
  const push = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); return true; } return false; };
  for (const id of chosen) {
    const page = byId.get(id);
    if (!page) continue;
    if (READABLE.has(page.type)) push(id);
    // páginas também podem ter subpáginas; cadernos só têm o que está dentro deles
    for (const child of pages) {
      if (child.id !== id && descendantIds(pages, id).has(child.id) && READABLE.has(child.type) && push(child.id)) fromContainers++;
    }
  }
  return { ids: out.slice(0, max), fromContainers, truncated: out.length > max };
}
