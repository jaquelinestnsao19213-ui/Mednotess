// Mapas mentais: modelo de dados e regras puras (sem rede, sem React), para ficarem fáceis de testar.
// O documento do mapa é independente da biblioteca visual: o editor só converte para/de ela.

export type NodeKind = "concept" | "note" | "image";
export type Shape = "rounded" | "pill" | "rect" | "ellipse";
export type FontFamily = "sans" | "serif" | "mono";
export type EdgeKind = "tree" | "link"; // tree = hierarquia (pai → filho); link = conexão manual entre ramos
export type Curve = "bezier" | "straight" | "step";
export type Crop = { l: number; t: number; r: number; b: number }; // frações de 0 a 0.9 cortadas de cada lado

export type NodeData = {
  label: string;
  detail?: string; // observação / explicação
  color: string; // nome da paleta ou "#rrggbb"
  shape?: Shape;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  font?: FontFamily;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "none";
  collapsed?: boolean;
  showDetail?: boolean; // mostra a observação como segunda linha dentro do nó
  pageId?: string | null; // anotação de origem
  excerpt?: string | null; // trecho da anotação de onde veio
  discipline?: string | null;
  origin?: "ai" | "manual";
  aiKey?: string; // identificador estável dado pela IA (permite atualizar sem duplicar)
  edited?: boolean; // a usuária mexeu num nó criado pela IA: a IA não altera mais o conteúdo dele
  inferred?: boolean; // conteúdo sugerido pela IA que não está nas anotações: precisa ser conferido
  imageUrl?: string;
  crop?: Crop;
};

export type MapNode = { id: string; kind: NodeKind; x: number; y: number; w?: number; h?: number; data: NodeData };

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  sh?: string; // handle de saída (t, r, b, l)
  th?: string; // handle de chegada
  label?: string;
  color?: string;
  width?: number;
  dashed?: boolean;
  curve?: Curve;
  arrowEnd?: boolean;
  arrowStart?: boolean;
  origin?: "ai" | "manual";
  inferred?: boolean;
};

export type MapDoc = {
  version: 1;
  nodes: MapNode[];
  edges: MapEdge[];
  viewport?: { x: number; y: number; zoom: number; w?: number; h?: number }; // w/h = tamanho da tela em que foi salvo
  meta: { dismissed: string[]; sourcePageIds: string[] };
};

/* ---------- paleta ---------- */

export const PALETTE: Record<string, { fill: string; border: string; ink: string; label: string }> = {
  teal: { fill: "#d9f2ee", border: "#0f766e", ink: "#0b4f4a", label: "Verde-água" },
  blue: { fill: "#dbe7ff", border: "#2457d6", ink: "#1b3a8f", label: "Azul" },
  purple: { fill: "#ebdfff", border: "#7550a4", ink: "#4d2f78", label: "Roxo" },
  pink: { fill: "#ffe0ef", border: "#be185d", ink: "#7d0f3d", label: "Rosa" },
  red: { fill: "#fde3e0", border: "#b42318", ink: "#7a1810", label: "Vermelho" },
  orange: { fill: "#ffe8cf", border: "#c2610c", ink: "#7a3d06", label: "Laranja" },
  yellow: { fill: "#fff6c7", border: "#a8870a", ink: "#5f4c05", label: "Amarelo" },
  green: { fill: "#e0f5d6", border: "#4d7c0f", ink: "#30500a", label: "Verde" },
  gray: { fill: "#eceff3", border: "#5b6675", ink: "#2c3541", label: "Cinza" },
};
export const PALETTE_NAMES = Object.keys(PALETTE);

export function paletteStyle(color: string | undefined) {
  if (color && PALETTE[color]) return PALETTE[color];
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return { fill: `${color}22`, border: color, ink: "#1b2430", label: color };
  return PALETTE.teal;
}

/* ---------- utilidades ---------- */

export function uid(prefix = "n"): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}

export const normLabel = (text: string | null | undefined) =>
  (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function emptyDoc(): MapDoc {
  return { version: 1, nodes: [], edges: [], meta: { dismissed: [], sourcePageIds: [] } };
}

export function newRootDoc(title: string): MapDoc {
  const doc = emptyDoc();
  doc.nodes.push({ id: uid(), kind: "concept", x: 0, y: 0, data: { label: title || "Tema central", color: "teal", shape: "pill", fontSize: 20, bold: true, origin: "manual" } });
  return doc;
}

/** Lê um documento vindo do banco com tolerância: descarta o que está quebrado em vez de travar a tela. */
export function normalizeDoc(raw: unknown): MapDoc {
  const doc = emptyDoc();
  if (!raw || typeof raw !== "object") return doc;
  const src = raw as Record<string, unknown>;
  const ids = new Set<string>();
  for (const item of Array.isArray(src.nodes) ? src.nodes : []) {
    const n = (item ?? {}) as Record<string, unknown>;
    const data = (n.data ?? {}) as Record<string, unknown>;
    const kind: NodeKind = n.kind === "note" || n.kind === "image" ? n.kind : "concept";
    if (typeof n.id !== "string" || !n.id || ids.has(n.id)) continue;
    ids.add(n.id);
    const crop = data.crop as Partial<Crop> | undefined;
    doc.nodes.push({
      id: n.id,
      kind,
      x: finite(n.x, 0),
      y: finite(n.y, 0),
      ...(typeof n.w === "number" && n.w > 20 ? { w: n.w } : {}),
      ...(typeof n.h === "number" && n.h > 20 ? { h: n.h } : {}),
      data: {
        ...(data as NodeData),
        label: typeof data.label === "string" ? data.label.slice(0, 600) : "",
        color: typeof data.color === "string" ? data.color : "teal",
        ...(crop ? { crop: { l: clamp(finite(crop.l, 0), 0, 0.9), t: clamp(finite(crop.t, 0), 0, 0.9), r: clamp(finite(crop.r, 0), 0, 0.9), b: clamp(finite(crop.b, 0), 0, 0.9) } } : {}),
      },
    });
  }
  const edgeIds = new Set<string>();
  const hasParent = new Set<string>();
  for (const item of Array.isArray(src.edges) ? src.edges : []) {
    const e = (item ?? {}) as Record<string, unknown>;
    if (typeof e.id !== "string" || edgeIds.has(e.id)) continue;
    if (typeof e.source !== "string" || typeof e.target !== "string" || e.source === e.target) continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    let kind: EdgeKind = e.kind === "tree" ? "tree" : "link";
    if (kind === "tree") {
      // hierarquia: um só pai por nó e nunca em laço
      if (hasParent.has(e.target) || ancestorsIn(doc.edges, e.source).has(e.target)) kind = "link";
      else hasParent.add(e.target);
    }
    edgeIds.add(e.id);
    doc.edges.push({ ...(e as unknown as MapEdge), kind });
  }
  const vp = src.viewport as Record<string, unknown> | undefined;
  if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.zoom)) doc.viewport = { x: vp.x as number, y: vp.y as number, zoom: clamp(vp.zoom as number, 0.1, 4), ...(Number.isFinite(vp.w) && Number.isFinite(vp.h) ? { w: vp.w as number, h: vp.h as number } : {}) };
  const meta = (src.meta ?? {}) as Record<string, unknown>;
  doc.meta = {
    dismissed: Array.isArray(meta.dismissed) ? meta.dismissed.filter((d): d is string => typeof d === "string").slice(-500) : [],
    sourcePageIds: Array.isArray(meta.sourcePageIds) ? meta.sourcePageIds.filter((d): d is string => typeof d === "string").slice(0, 20) : [],
  };
  return doc;
}

function ancestorsIn(edges: MapEdge[], id: string): Set<string> {
  const parent = new Map<string, string>();
  for (const e of edges) if (e.kind === "tree") parent.set(e.target, e.source);
  const out = new Set<string>();
  let cur = parent.get(id);
  while (cur && !out.has(cur)) {
    out.add(cur);
    cur = parent.get(cur);
  }
  return out;
}

/* ---------- hierarquia ---------- */

export const treeEdges = (doc: MapDoc) => doc.edges.filter((e) => e.kind === "tree");
export const nodeById = (doc: MapDoc, id: string) => doc.nodes.find((n) => n.id === id);

export function parentOf(doc: MapDoc, id: string): string | null {
  return treeEdges(doc).find((e) => e.target === id)?.source ?? null;
}

export function childrenOf(doc: MapDoc, id: string): string[] {
  const order = new Map(doc.nodes.map((n, i) => [n.id, i]));
  return treeEdges(doc)
    .filter((e) => e.source === id)
    .map((e) => e.target)
    .sort((a, b) => (nodeById(doc, a)?.y ?? 0) - (nodeById(doc, b)?.y ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export function descendantsOf(doc: MapDoc, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...childrenOf(doc, id)];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...childrenOf(doc, cur));
  }
  return out;
}

/** Nós escondidos por algum ancestral recolhido. */
export function hiddenIds(doc: MapDoc): Set<string> {
  const hidden = new Set<string>();
  for (const n of doc.nodes) if (n.data.collapsed) for (const d of descendantsOf(doc, n.id)) hidden.add(d);
  return hidden;
}

export function rootOf(doc: MapDoc, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const p = parentOf(doc, cur);
    if (!p) break;
    cur = p;
  }
  return cur;
}

export function canReparent(doc: MapDoc, nodeId: string, newParentId: string | null): { ok: boolean; reason?: string } {
  if (newParentId === null) return { ok: true };
  if (newParentId === nodeId) return { ok: false, reason: "Um conceito não pode ser filho dele mesmo." };
  if (!nodeById(doc, newParentId)) return { ok: false, reason: "Destino não encontrado." };
  if (descendantsOf(doc, nodeId).has(newParentId)) return { ok: false, reason: "Não dá para mover um conceito para dentro de um ramo dele mesmo." };
  return { ok: true };
}

/* ---------- tamanho estimado (para layout) ---------- */

export function sizeOf(n: MapNode): { w: number; h: number } {
  if (n.w && n.h) return { w: n.w, h: n.h };
  if (n.kind === "image") return { w: n.w ?? 220, h: n.h ?? 160 };
  const fs = n.data.fontSize ?? 15;
  const w = n.w ?? clamp(Math.ceil(n.data.label.length * fs * 0.52) + 44, 110, 270);
  const lines = Math.max(1, Math.ceil((n.data.label.length * fs * 0.52) / (w - 32)));
  return { w, h: n.h ?? Math.round(26 + lines * fs * 1.35) };
}

const GAP_X = 80;
const GAP_Y = 18;

/* ---------- edição ---------- */

const withNodes = (doc: MapDoc, nodes: MapNode[]): MapDoc => ({ ...doc, nodes });
const mapNode = (doc: MapDoc, id: string, fn: (n: MapNode) => MapNode) => withNodes(doc, doc.nodes.map((n) => (n.id === id ? fn(n) : n)));

/** Atualiza o conteúdo de um nó. Se ele veio da IA, marca como editado: a IA não o sobrescreve mais. */
export function updateNodeData(doc: MapDoc, id: string, patch: Partial<NodeData>): MapDoc {
  return mapNode(doc, id, (n) => {
    const touchesContent = "label" in patch || "detail" in patch;
    const markEdited = n.data.origin === "ai" && touchesContent && !("edited" in patch);
    return { ...n, data: { ...n.data, ...patch, ...(markEdited ? { edited: true, inferred: false } : {}) } };
  });
}

export function moveNode(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return mapNode(doc, id, (n) => ({ ...n, x, y }));
}

export function resizeNode(doc: MapDoc, id: string, w: number, h: number): MapDoc {
  return mapNode(doc, id, (n) => ({ ...n, w: Math.max(40, Math.round(w)), h: Math.max(30, Math.round(h)) }));
}

/** Escolhe lados de saída/chegada pela direção entre os centros, para as linhas ficarem limpas. */
export function sidesBetween(a: MapNode, b: MapNode): { sh: string; th: string } {
  const sa = sizeOf(a), sb = sizeOf(b);
  const dx = b.x + sb.w / 2 - (a.x + sa.w / 2);
  const dy = b.y + sb.h / 2 - (a.y + sa.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { sh: "r", th: "l" } : { sh: "l", th: "r" };
  return dy >= 0 ? { sh: "b", th: "t" } : { sh: "t", th: "b" };
}

export function refreshTreeHandles(doc: MapDoc, onlyNodeIds?: Set<string>): MapDoc {
  const by = new Map(doc.nodes.map((n) => [n.id, n]));
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e.kind !== "tree") return e;
      if (onlyNodeIds && !onlyNodeIds.has(e.source) && !onlyNodeIds.has(e.target)) return e;
      const a = by.get(e.source), b = by.get(e.target);
      return a && b ? { ...e, ...sidesBetween(a, b) } : e;
    }),
  };
}

/** Posição para um novo filho de `parentId`: do mesmo lado do pai, abaixo dos irmãos. */
export function placeNear(doc: MapDoc, parentId: string): { x: number; y: number } {
  const parent = nodeById(doc, parentId);
  if (!parent) return { x: 0, y: 0 };
  const ps = sizeOf(parent);
  const root = nodeById(doc, rootOf(doc, parentId));
  let side = 1;
  if (root && root.id !== parent.id) side = parent.x + ps.w / 2 >= root.x + sizeOf(root).w / 2 ? 1 : -1;
  else {
    const kids = childrenOf(doc, parentId).map((k) => nodeById(doc, k)!).filter(Boolean);
    side = kids.filter((k) => k.x < parent.x).length < kids.filter((k) => k.x >= parent.x).length ? -1 : 1;
  }
  const sameSide = childrenOf(doc, parentId).map((k) => nodeById(doc, k)!).filter((k) => k && (side === 1 ? k.x >= parent.x : k.x < parent.x));
  const x = side === 1 ? parent.x + ps.w + GAP_X : parent.x - GAP_X - 150;
  const y = sameSide.length ? Math.max(...sameSide.map((k) => k.y + sizeOf(k).h)) + GAP_Y : parent.y + ps.h / 2 - 20;
  return { x, y };
}

export function addNode(doc: MapDoc, kind: NodeKind, pos: { x: number; y: number }, data: Partial<NodeData> = {}, size?: { w: number; h: number }): { doc: MapDoc; id: string } {
  const id = uid();
  const base: NodeData = { label: kind === "note" ? "Observação" : kind === "image" ? "" : "Novo conceito", color: kind === "note" ? "yellow" : "teal", origin: "manual", ...data };
  const node: MapNode = { id, kind, x: pos.x, y: pos.y, ...(size ? { w: size.w, h: size.h } : kind === "note" ? { w: 220, h: 110 } : {}), data: base };
  return { doc: withNodes(doc, [...doc.nodes, node]), id };
}

export function addChild(doc: MapDoc, parentId: string, label = "Novo conceito"): { doc: MapDoc; id: string } {
  const parent = nodeById(doc, parentId);
  if (!parent) return { doc, id: "" };
  const pos = placeNear(doc, parentId);
  const { doc: withNode, id } = addNode(doc, "concept", pos, { label, color: parent.data.color, shape: parent.data.shape === "pill" ? "rounded" : parent.data.shape, discipline: parent.data.discipline ?? null });
  const edge: MapEdge = { id: uid("e"), source: parentId, target: id, kind: "tree", origin: "manual" };
  return { doc: refreshTreeHandles({ ...withNode, edges: [...withNode.edges, edge] }, new Set([id])), id };
}

/** Novo conceito criado soltando uma linha no espaço vazio: filho se a origem é um conceito, senão conexão livre. */
export function addChildAt(doc: MapDoc, sourceId: string, pos: { x: number; y: number }): { doc: MapDoc; id: string } {
  const src = nodeById(doc, sourceId);
  if (!src) return { doc, id: "" };
  const { doc: withNode, id } = addNode(doc, "concept", pos, { label: "Novo conceito", color: src.data.color, shape: "rounded", discipline: src.data.discipline ?? null });
  const isTree = src.kind === "concept";
  const edge: MapEdge = { id: uid("e"), source: sourceId, target: id, kind: isTree ? "tree" : "link", origin: "manual", ...(isTree ? {} : { arrowEnd: true }) };
  const nodeNew = nodeById(withNode, id)!;
  return { doc: { ...withNode, edges: [...withNode.edges, { ...edge, ...sidesBetween(src, nodeNew) }] }, id };
}

/** Novo conceito no mesmo nível (irmão) do selecionado. Sem pai, vira outro tema solto. */
export function addSibling(doc: MapDoc, id: string): { doc: MapDoc; id: string } {
  const parent = parentOf(doc, id);
  if (parent) return addChild(doc, parent);
  const n = nodeById(doc, id);
  return addNode(doc, "concept", { x: (n?.x ?? 0), y: (n?.y ?? 0) + (n ? sizeOf(n).h + 60 : 0) });
}

const edgeKeyOf = (a: string, b: string) => [a, b].sort().join("|");

export function hasEdgeBetween(doc: MapDoc, a: string, b: string) {
  return doc.edges.some((e) => edgeKeyOf(e.source, e.target) === edgeKeyOf(a, b));
}

export function connectNodes(doc: MapDoc, source: string, target: string, opts: Partial<MapEdge> = {}): { doc: MapDoc; id: string | null } {
  if (source === target || !nodeById(doc, source) || !nodeById(doc, target)) return { doc, id: null };
  if (hasEdgeBetween(doc, source, target) && !opts.sh && !opts.th) return { doc, id: null };
  const id = uid("e");
  const edge: MapEdge = { id, source, target, kind: "link", arrowEnd: true, origin: "manual", ...opts };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, id };
}

export function updateEdge(doc: MapDoc, id: string, patch: Partial<MapEdge>): MapDoc {
  return { ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function reverseEdge(doc: MapDoc, id: string): MapDoc {
  return { ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, source: e.target, target: e.source, sh: e.th, th: e.sh, arrowEnd: e.arrowStart, arrowStart: e.arrowEnd } : e)) };
}

/** Troca o pai de um conceito (reorganizar hierarquia). `null` solta o conceito como tema próprio. */
export function reparent(doc: MapDoc, nodeId: string, newParentId: string | null): MapDoc {
  if (!canReparent(doc, nodeId, newParentId).ok) return doc;
  const without = doc.edges.filter((e) => !(e.kind === "tree" && e.target === nodeId));
  if (!newParentId) return { ...doc, edges: without };
  const edge: MapEdge = { id: uid("e"), source: newParentId, target: nodeId, kind: "tree", origin: "manual" };
  // se já havia uma conexão solta entre os dois, ela é substituída pela hierarquia
  const cleaned = without.filter((e) => !(e.kind === "link" && edgeKeyOf(e.source, e.target) === edgeKeyOf(newParentId, nodeId)));
  return refreshTreeHandles({ ...doc, edges: [...cleaned, edge] }, new Set([nodeId]));
}

function dismissEdge(doc: MapDoc, e: MapEdge): string[] {
  if (e.origin !== "ai") return [];
  const a = nodeById(doc, e.source)?.data.aiKey, b = nodeById(doc, e.target)?.data.aiKey;
  return a && b ? [`${a}>${b}`] : [];
}

export function deleteEdges(doc: MapDoc, ids: string[]): MapDoc {
  const set = new Set(ids);
  const dismissed = doc.edges.filter((e) => set.has(e.id)).flatMap((e) => dismissEdge(doc, e));
  return { ...doc, edges: doc.edges.filter((e) => !set.has(e.id)), meta: { ...doc.meta, dismissed: [...new Set([...doc.meta.dismissed, ...dismissed])].slice(-500) } };
}

/**
 * Exclui nós. Por padrão os filhos NÃO somem: sobem para o pai do nó excluído (ou ficam soltos).
 * Com `withBranch`, o ramo inteiro é excluído. O que a IA criou e foi excluído não volta em atualizações.
 */
export function deleteNodes(doc: MapDoc, ids: string[], withBranch = false): MapDoc {
  const gone = new Set(ids);
  if (withBranch) for (const id of ids) for (const d of descendantsOf(doc, id)) gone.add(d);
  let edges = [...doc.edges];
  if (!withBranch) {
    for (const id of ids) {
      const parent = parentOf({ ...doc, edges }, id);
      const kids = edges.filter((e) => e.kind === "tree" && e.source === id && !gone.has(e.target));
      edges = edges.map((e) => (kids.includes(e) ? (parent && !gone.has(parent) ? { ...e, source: parent } : { ...e, kind: "link" as EdgeKind }) : e));
    }
  }
  const dismissedKeys = doc.nodes.filter((n) => gone.has(n.id) && n.data.aiKey).map((n) => `node:${n.data.aiKey}`);
  const dismissedEdges = doc.edges.filter((e) => (gone.has(e.source) || gone.has(e.target))).flatMap((e) => dismissEdge(doc, e));
  edges = edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
  const next: MapDoc = {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges,
    meta: { ...doc.meta, dismissed: [...new Set([...doc.meta.dismissed, ...dismissedKeys, ...dismissedEdges])].slice(-500) },
  };
  // filhos que subiram de nível: arruma os lados das linhas
  return refreshTreeHandles(next);
}

export function toggleCollapse(doc: MapDoc, id: string, collapsed?: boolean): MapDoc {
  return mapNode(doc, id, (n) => ({ ...n, data: { ...n.data, collapsed: collapsed ?? !n.data.collapsed } }));
}

export function setAllCollapsed(doc: MapDoc, collapsed: boolean): MapDoc {
  return withNodes(doc, doc.nodes.map((n) => (childrenOf(doc, n.id).length ? { ...n, data: { ...n.data, collapsed } } : n)));
}

/* ---------- layout automático em árvore (dois lados, como as referências) ---------- */

export function layoutTree(doc: MapDoc): MapDoc {
  const nodes = new Map(doc.nodes.map((n) => [n.id, { ...n }]));
  const kids = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of treeEdges(doc)) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
    hasParent.add(e.target);
  }
  const ordered = (id: string) => (kids.get(id) ?? []).sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y || nodes.get(a)!.x - nodes.get(b)!.x);
  const visibleKids = (id: string) => (nodes.get(id)!.data.collapsed ? [] : ordered(id));
  const cache = new Map<string, number>();
  const H = (id: string): number => {
    if (cache.has(id)) return cache.get(id)!;
    const own = sizeOf(nodes.get(id)!).h + GAP_Y;
    const c = visibleKids(id);
    const value = c.length ? Math.max(own, c.reduce((s, k) => s + H(k), 0)) : own;
    cache.set(id, value);
    return value;
  };
  const placeKids = (id: string, dir: 1 | -1) => {
    const n = nodes.get(id)!;
    const s = sizeOf(n);
    const c = visibleKids(id);
    const total = c.reduce((sum, k) => sum + H(k), 0);
    let y = n.y + s.h / 2 - total / 2;
    for (const k of c) {
      const kn = nodes.get(k)!;
      const ks = sizeOf(kn);
      const hk = H(k);
      kn.x = dir === 1 ? n.x + s.w + GAP_X : n.x - GAP_X - ks.w;
      kn.y = y + hk / 2 - ks.h / 2;
      y += hk;
      placeKids(k, dir);
    }
  };

  // todo conceito sem pai é um tema: os soltos também entram na pilha, para nunca ficarem um sobre o outro
  const roots = doc.nodes.filter((n) => n.kind === "concept" && !hasParent.has(n.id)).map((n) => n.id);
  if (!roots.length) return refreshTreeHandles(doc);
  const first = nodes.get(roots[0])!;
  const fs = sizeOf(first);
  const anchorX = first.x + fs.w / 2;
  let cursorY = first.y + fs.h / 2;
  let firstTop: number | null = null;
  for (const rootId of roots) {
    const root = nodes.get(rootId)!;
    const rs = sizeOf(root);
    const c = ordered(rootId).filter(() => !root.data.collapsed);
    const total = c.reduce((s, k) => s + H(k), 0);
    let acc = 0;
    const right: string[] = [], left: string[] = [];
    for (const k of c) {
      if (acc < total / 2) { right.push(k); acc += H(k); } else left.push(k);
    }
    const hRight = right.reduce((s, k) => s + H(k), 0), hLeft = left.reduce((s, k) => s + H(k), 0);
    const extent = Math.max(hRight, hLeft, rs.h + GAP_Y);
    if (firstTop === null) firstTop = cursorY - extent / 2;
    const centerY = (firstTop ?? 0) + extent / 2;
    root.x = anchorX - rs.w / 2;
    root.y = centerY - rs.h / 2;
    for (const [group, dir] of [[right, 1], [left, -1]] as [string[], 1 | -1][]) {
      const gh = group.reduce((s, k) => s + H(k), 0);
      let y = centerY - gh / 2;
      for (const k of group) {
        const kn = nodes.get(k)!;
        const ks = sizeOf(kn);
        const hk = H(k);
        kn.x = dir === 1 ? root.x + rs.w + GAP_X : root.x - GAP_X - ks.w;
        kn.y = y + hk / 2 - ks.h / 2;
        y += hk;
        placeKids(k, dir);
      }
    }
    firstTop = (firstTop ?? 0) + extent + 70;
  }
  // nós recolhidos: os escondidos ficam sobre o pai (aparecem no lugar certo depois de reorganizar)
  const out = doc.nodes.map((n) => nodes.get(n.id)!);
  return refreshTreeHandles({ ...doc, nodes: out });
}

/* ---------- conteúdo vindo da IA ---------- */

export type GenNode = { key: string; label: string; detail?: string; parentKey: string | null; color?: string; pageId?: string | null; excerpt?: string | null; discipline?: string | null; inferred?: boolean };
export type GenLink = { from: string; to: string; label?: string; inferred?: boolean };
export type Generated = { nodes: GenNode[]; links: GenLink[] };
export type MergeReport = { addedNodes: number; addedEdges: number; keptEdited: number; skipped: number };

/**
 * Junta o que a IA gerou ao mapa atual SEM sobrescrever o trabalho manual:
 * - nó já existente (mesma chave ou mesmo nome) é mantido; só ganha vínculo/trecho se ainda não tinha;
 * - nós editados pela usuária nunca são alterados;
 * - o que a usuária excluiu não volta; nada é excluído automaticamente.
 */
export function mergeGenerated(doc: MapDoc, gen: Generated): { doc: MapDoc; report: MergeReport } {
  const report: MergeReport = { addedNodes: 0, addedEdges: 0, keptEdited: 0, skipped: 0 };
  let cur: MapDoc = { ...doc, nodes: [...doc.nodes], edges: [...doc.edges] };
  const dismissed = new Set(doc.meta.dismissed);
  const hadConcepts = doc.nodes.some((n) => n.kind === "concept");
  const idByKey = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const n of cur.nodes) {
    if (n.data.aiKey) idByKey.set(n.data.aiKey, n.id);
    const l = normLabel(n.data.label);
    if (l && n.kind === "concept" && !byLabel.has(l)) byLabel.set(l, n.id);
  }
  const created: string[] = [];

  // 1) nós
  for (const g of gen.nodes) {
    if (dismissed.has(`node:${g.key}`)) { report.skipped++; continue; }
    let id = idByKey.get(g.key) ?? byLabel.get(normLabel(g.label));
    if (id) {
      idByKey.set(g.key, id);
      cur = mapNode(cur, id, (n) => {
        if (n.data.edited) { report.keptEdited++; return n; }
        const patch: Partial<NodeData> = {};
        if (!n.data.aiKey) patch.aiKey = g.key;
        if (!n.data.pageId && g.pageId) { patch.pageId = g.pageId; patch.excerpt = g.excerpt ?? null; }
        if (n.data.origin === "ai" && g.detail && g.detail !== n.data.detail) patch.detail = g.detail;
        return Object.keys(patch).length ? { ...n, data: { ...n.data, ...patch } } : n;
      });
      continue;
    }
    id = uid();
    idByKey.set(g.key, id);
    byLabel.set(normLabel(g.label), id);
    created.push(id);
    cur = {
      ...cur,
      nodes: [...cur.nodes, {
        id, kind: "concept", x: 0, y: 0,
        data: { label: g.label, detail: g.detail, color: g.color && PALETTE[g.color] ? g.color : "teal", origin: "ai", aiKey: g.key, pageId: g.pageId ?? null, excerpt: g.excerpt ?? null, discipline: g.discipline ?? null, inferred: !!g.inferred, shape: g.parentKey ? "rounded" : "pill", ...(g.parentKey ? {} : { fontSize: 19, bold: true }) },
      }],
    };
    report.addedNodes++;
  }

  // 2) hierarquia (só dá pai a quem ainda não tem; respeita reorganizações da usuária)
  for (const g of gen.nodes) {
    const childId = idByKey.get(g.key);
    if (!childId || !g.parentKey) continue;
    const parentId = idByKey.get(g.parentKey);
    if (!parentId || parentId === childId) continue;
    if (dismissed.has(`${g.parentKey}>${g.key}`) || dismissed.has(`node:${g.key}`)) continue;
    if (parentOf(cur, childId) || descendantsOf(cur, childId).has(parentId)) continue;
    if (hasEdgeBetween(cur, parentId, childId)) continue;
    // um nó já existente que ficou sem pai por decisão da usuária não é "adotado" de volta
    if (!created.includes(childId) && doc.nodes.some((n) => n.id === childId)) continue;
    cur = { ...cur, edges: [...cur.edges, { id: uid("e"), source: parentId, target: childId, kind: "tree", origin: "ai" }] };
    report.addedEdges++;
  }

  // 3) conexões entre ramos / disciplinas
  for (const l of gen.links) {
    const a = idByKey.get(l.from), b = idByKey.get(l.to);
    if (!a || !b || a === b || dismissed.has(`${l.from}>${l.to}`) || hasEdgeBetween(cur, a, b)) continue;
    const na = nodeById(cur, a)!, nb = nodeById(cur, b)!;
    cur = { ...cur, edges: [...cur.edges, { id: uid("e"), source: a, target: b, kind: "link", origin: "ai", label: l.label, arrowEnd: true, dashed: !!l.inferred, inferred: !!l.inferred, color: undefined, ...sidesBetween(na, nb) }] };
    report.addedEdges++;
  }

  // 4) posições
  if (!hadConcepts) {
    cur = layoutTree(cur);
  } else {
    for (const id of created) {
      const p = parentOf(cur, id);
      const pos = p ? placeNear(cur, p) : { x: 0, y: Math.max(0, ...cur.nodes.map((n) => n.y + sizeOf(n).h)) + 120 };
      cur = moveNode(cur, id, pos.x, pos.y);
    }
    cur = refreshTreeHandles(cur, new Set(created));
  }
  return { doc: cur, report };
}

/* ---------- comandos da IA ("crie uma ramificação sobre…") ---------- */

export type MapOp =
  | { op: "add_node"; ref?: string; label: string; detail?: string; parent?: string | null; color?: string; pageId?: string | null; excerpt?: string | null; discipline?: string | null; inferred?: boolean }
  | { op: "add_edge"; from: string; to: string; label?: string; inferred?: boolean }
  | { op: "update_node"; id: string; label?: string; detail?: string; color?: string };

export type OpReport = { addedNodes: number; addedEdges: number; updatedNodes: number; skipped: number };

export function applyOps(doc: MapDoc, ops: MapOp[]): { doc: MapDoc; report: OpReport } {
  const report: OpReport = { addedNodes: 0, addedEdges: 0, updatedNodes: 0, skipped: 0 };
  let cur = doc;
  const refs = new Map<string, string>();
  const resolve = (value: string | null | undefined) => (value ? (refs.get(value) ?? (nodeById(cur, value) ? value : null)) : null);
  for (const op of ops) {
    if (op.op === "add_node") {
      const parent = resolve(op.parent);
      const pos = parent ? placeNear(cur, parent) : { x: 0, y: Math.max(0, ...cur.nodes.map((n) => n.y + sizeOf(n).h), 0) + 100 };
      const parentColor = parent ? nodeById(cur, parent)?.data.color : undefined;
      const added = addNode(cur, "concept", pos, {
        label: op.label, detail: op.detail, color: op.color && PALETTE[op.color] ? op.color : parentColor ?? "teal", shape: "rounded",
        origin: "ai", aiKey: `cmd-${uid("k")}`, pageId: op.pageId ?? null, excerpt: op.excerpt ?? null, discipline: op.discipline ?? null, inferred: !!op.inferred,
      });
      cur = added.doc;
      if (op.ref) refs.set(op.ref, added.id);
      if (parent) {
        cur = { ...cur, edges: [...cur.edges, { id: uid("e"), source: parent, target: added.id, kind: "tree", origin: "ai" }] };
        cur = refreshTreeHandles(cur, new Set([added.id]));
        report.addedEdges++;
      }
      report.addedNodes++;
    } else if (op.op === "add_edge") {
      const a = resolve(op.from), b = resolve(op.to);
      if (!a || !b || a === b || hasEdgeBetween(cur, a, b)) { report.skipped++; continue; }
      const res = connectNodes(cur, a, b, { origin: "ai", label: op.label, dashed: !!op.inferred, inferred: !!op.inferred, ...sidesBetween(nodeById(cur, a)!, nodeById(cur, b)!) });
      cur = res.doc;
      report.addedEdges++;
    } else if (op.op === "update_node") {
      const id = resolve(op.id);
      if (!id) { report.skipped++; continue; }
      const patch: Partial<NodeData> = {};
      if (op.label) patch.label = op.label;
      if (op.detail !== undefined) patch.detail = op.detail;
      if (op.color && PALETTE[op.color]) patch.color = op.color;
      cur = updateNodeData(cur, id, patch);
      report.updatedNodes++;
    }
  }
  return { doc: cur, report };
}

/** Resumo compacto do mapa para a IA (ids reais, para ela poder conectar o que já existe). */
export function summarizeDoc(doc: MapDoc) {
  const nodes = doc.nodes.filter((n) => n.kind === "concept").slice(0, 150).map((n) => ({
    id: n.id,
    label: n.data.label.slice(0, 100),
    ...(n.data.detail ? { detail: n.data.detail.slice(0, 140) } : {}),
    parent: parentOf(doc, n.id),
    ...(n.data.discipline ? { discipline: n.data.discipline } : {}),
    ...(n.data.aiKey ? { key: n.data.aiKey } : {}),
  }));
  const links = doc.edges.filter((e) => e.kind === "link").slice(0, 80).map((e) => ({ from: e.source, to: e.target, ...(e.label ? { label: e.label } : {}) }));
  return { nodes, links };
}

export function docStats(doc: MapDoc) {
  return { nodes: doc.nodes.length, concepts: doc.nodes.filter((n) => n.kind === "concept").length, links: doc.edges.filter((e) => e.kind === "link").length };
}
