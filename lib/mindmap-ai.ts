// Validação do que a IA devolve para mapas mentais. A IA nunca é confiável: tudo é checado antes de entrar no mapa.
import { PALETTE, type Generated, type GenLink, type GenNode, type MapOp } from "./mindmap";

export type SourcePage = { id: string; title: string; text: string };

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const squash = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** O trecho citado precisa existir de verdade na anotação (senão a "fonte" seria inventada). */
export function excerptExists(pageText: string, excerpt: string): boolean {
  const needle = squash(excerpt);
  return needle.length >= 8 && squash(pageText).includes(needle);
}

function checkedSource(pages: SourcePage[], pageId: unknown, excerpt: unknown): { pageId: string | null; excerpt: string | null } {
  const id = typeof pageId === "string" ? pageId : "";
  const page = pages.find((p) => p.id === id);
  if (!page) return { pageId: null, excerpt: null };
  const ex = str(excerpt, 300);
  return { pageId: page.id, excerpt: ex && excerptExists(page.text, ex) ? ex : null };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function sanitizeGenerated(raw: Record<string, unknown> | null, pages: SourcePage[], maxNodes = 90): Generated | null {
  if (!raw) return null;
  const nodes: GenNode[] = [];
  const keys = new Set<string>();
  for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (nodes.length >= maxNodes) break;
    const r = (item ?? {}) as Record<string, unknown>;
    const label = str(r.label, 120);
    const key = slug(str(r.key, 60));
    if (!label || !key || keys.has(key)) continue;
    keys.add(key);
    const src = checkedSource(pages, r.pageId, r.excerpt);
    nodes.push({
      key,
      label,
      detail: str(r.detail, 420) || undefined,
      parentKey: typeof r.parent === "string" && r.parent ? slug(r.parent) : null,
      color: typeof r.color === "string" && PALETTE[r.color] ? r.color : undefined,
      pageId: src.pageId,
      excerpt: src.excerpt,
      discipline: str(r.discipline, 60) || null,
      inferred: r.inferred === true && !src.excerpt,
    });
  }
  if (!nodes.length) return null;
  // pais desconhecidos viram raiz; laços são quebrados
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  for (const n of nodes) if (n.parentKey && (!byKey.has(n.parentKey) || n.parentKey === n.key)) n.parentKey = null;
  for (const n of nodes) {
    const seen = new Set<string>([n.key]);
    let cur = n.parentKey;
    while (cur) {
      if (seen.has(cur)) { n.parentKey = null; break; }
      seen.add(cur);
      cur = byKey.get(cur)?.parentKey ?? null;
    }
  }
  const links: GenLink[] = [];
  for (const item of Array.isArray(raw.links) ? raw.links : []) {
    if (links.length >= 40) break;
    const r = (item ?? {}) as Record<string, unknown>;
    const from = slug(str(r.from, 60)), to = slug(str(r.to, 60));
    if (!byKey.has(from) || !byKey.has(to) || from === to) continue;
    links.push({ from, to, label: str(r.label, 60) || undefined, inferred: r.inferred === true });
  }
  return { nodes, links };
}

export function sanitizeOps(raw: unknown, ctx: { nodeIds: Set<string>; pages: SourcePage[] }, max = 40): MapOp[] {
  const ops: MapOp[] = [];
  const refs = new Set<string>();
  const known = (id: unknown): id is string => typeof id === "string" && (ctx.nodeIds.has(id) || refs.has(id));
  for (const item of Array.isArray(raw) ? raw : []) {
    if (ops.length >= max) break;
    const r = (item ?? {}) as Record<string, unknown>;
    if (r.op === "add_node") {
      const label = str(r.label, 120);
      if (!label) continue;
      const ref = slug(str(r.ref, 40)) || undefined;
      const src = checkedSource(ctx.pages, r.pageId, r.excerpt);
      ops.push({
        op: "add_node", ref, label, detail: str(r.detail, 420) || undefined,
        parent: known(r.parent) ? (r.parent as string) : null,
        color: typeof r.color === "string" && PALETTE[r.color] ? r.color : undefined,
        pageId: src.pageId, excerpt: src.excerpt, discipline: str(r.discipline, 60) || null,
        inferred: r.inferred === true && !src.excerpt,
      });
      if (ref) refs.add(ref);
    } else if (r.op === "add_edge") {
      if (!known(r.from) || !known(r.to) || r.from === r.to) continue;
      ops.push({ op: "add_edge", from: r.from as string, to: r.to as string, label: str(r.label, 60) || undefined, inferred: r.inferred === true });
    } else if (r.op === "update_node") {
      if (typeof r.id !== "string" || !ctx.nodeIds.has(r.id)) continue;
      const label = str(r.label, 120), detail = typeof r.detail === "string" ? str(r.detail, 420) : undefined;
      const color = typeof r.color === "string" && PALETTE[r.color] ? r.color : undefined;
      if (!label && detail === undefined && !color) continue;
      ops.push({ op: "update_node", id: r.id, ...(label ? { label } : {}), ...(detail !== undefined ? { detail } : {}), ...(color ? { color } : {}) });
    }
    // qualquer outra operação (inclusive excluir) é ignorada de propósito: a IA só acrescenta ou ajusta
  }
  return ops;
}
