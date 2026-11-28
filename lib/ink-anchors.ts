import { moveItem } from "@/components/editor/ink-geometry";
import { unionBox, type LayerItem } from "@/components/editor/ink-text";

// Âncoras da escrita à mão. A escrita é guardada em posições a partir do topo da página (y). Se algum bloco acima
// (imagem, vídeo, tabela, fonte) ocupar uma altura diferente no link do visitante, tudo o que está abaixo desce ou sobe
// e a escrita fica fora do lugar. Por isso, ao salvar, guardamos o topo de cada bloco do texto; no link do visitante
// medimos os mesmos blocos e deslocamos cada traço pelo mesmo tanto que o bloco ao lado dele se deslocou.

export type BlockMap = { tops: number[]; h: number; w: number };
export type Anchors = { o: number[]; v: number[] };

const SKIP = ["ProseMirror-gapcursor", "ProseMirror-widget", "ProseMirror-separator", "ProseMirror-trailingBreak"];

// Blocos de primeiro nível do texto (parágrafos, imagens, tabelas, vídeos...), sem os elementos auxiliares do editor.
export function blockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.tagName !== "BR" && !SKIP.some((c) => el.classList.contains(c))
  );
}

// Topo de cada bloco, em pixels da folha (já descontando a redução da tela, se houver), a contar do topo da folha.
export function measureBlocks(root: HTMLElement | null, wrap: HTMLElement | null, requireImages: boolean): BlockMap | null {
  if (!root || !wrap) return null;
  if (requireImages && Array.from(root.querySelectorAll("img")).some((img) => !img.complete)) return null;
  const wr = wrap.getBoundingClientRect();
  const cw = wrap.clientWidth;
  if (wr.width < 200 || cw < 200) return null;
  const k = wr.width / cw;
  const els = blockElements(root);
  if (!els.length || els.length > 5000) return null;
  const tops = els.map((el) => Math.round((el.getBoundingClientRect().top - wr.top) / k));
  return { tops, h: Math.round(wr.height / k), w: Math.round(cw) };
}

// Mede a folha do editor aberta pela dona do caderno (a mesma área sobre a qual a escrita é desenhada).
export function measureOwnerBlocks(): BlockMap | null {
  const tip = document.querySelector<HTMLElement>(".editor .tiptap");
  const wrap = tip?.closest<HTMLElement>('[style*="position: relative"]') ?? tip?.closest<HTMLElement>(".editor") ?? null;
  return measureBlocks(tip ?? null, wrap, true);
}

// Pares (altura na folha da dona → altura na folha do visitante). Nulo quando não dá para comparar ou nada mudou.
export function buildAnchors(ownerTops: number[], ownerH: number, visTops: number[], visH: number): Anchors | null {
  if (!ownerTops.length || ownerTops.length !== visTops.length) return null;
  const o = [...ownerTops, ownerH];
  const v = [...visTops, visH];
  for (let i = 0; i < o.length; i++) {
    if (!Number.isFinite(o[i]) || !Number.isFinite(v[i])) return null;
    if (i > 0 && (o[i] < o[i - 1] || v[i] < v[i - 1])) return null;
  }
  if (o.every((x, i) => Math.abs(v[i] - x) < 1.5)) return null;
  return { o, v };
}

function mapY(y: number, a: Anchors): number {
  const { o, v } = a;
  const n = o.length;
  if (y <= o[0]) return y + (v[0] - o[0]);
  if (y >= o[n - 1]) return y + (v[n - 1] - o[n - 1]);
  for (let i = 0; i < n - 1; i++) {
    if (y >= o[i] && y < o[i + 1]) {
      const span = o[i + 1] - o[i];
      if (span <= 0) return y + (v[i] - o[i]);
      const t = (y - o[i]) / span;
      return v[i] + t * (v[i + 1] - v[i]);
    }
  }
  return y;
}

// Desloca cada traço ou texto da escrita para acompanhar o bloco em que ele está (w = largura da folha, em pixels).
export function warpItems(items: LayerItem[], w: number, a: Anchors): LayerItem[] {
  if (!w || !items.length) return items;
  return items.map((it): LayerItem => {
    const b = unionBox([it], new Set([it.id]), w);
    if (!b) return it;
    const cy = ((b[1] + b[3]) / 2) * w;
    const dy = (mapY(cy, a) - cy) / w;
    if (Math.abs(dy * w) < 0.5) return it;
    return it.kind === "text" ? { ...it, y: it.y + dy } : moveItem(it, 0, dy);
  });
}
