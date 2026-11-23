import type { Item } from "../pdf/types";

// Suaviza um traço sem alterar o original: só é aplicado na hora de desenhar.
// strength vai de 0 (como foi escrito) a 1 (bem suave). Pontas do traço ficam fixas.
export function smoothPoints(pts: number[], strength: number): number[] {
  const n = pts.length / 2;
  if (strength <= 0 || n < 3) return pts;
  const s = Math.min(1, strength);
  const passes = 1 + Math.round(s * 5);
  const a = 0.25 + 0.5 * s; // peso da média dos vizinhos
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const next = cur.slice();
    for (let i = 1; i < n - 1; i++) {
      next[2 * i] = cur[2 * i] * (1 - a) + ((cur[2 * i - 2] + cur[2 * i + 2]) / 2) * a;
      next[2 * i + 1] = cur[2 * i + 1] * (1 - a) + ((cur[2 * i - 1] + cur[2 * i + 3]) / 2) * a;
    }
    cur = next;
  }
  return cur;
}

// Formas corrigidas automaticamente (campo "shape") já são perfeitas: não são suavizadas, para os cantos continuarem retos.
const isShape = (it: Item): boolean => !!(it as unknown as { shape?: boolean }).shape;

export function smoothItem(it: Item, strength: number): Item {
  if (it.kind !== "ink" || strength <= 0 || isShape(it)) return it;
  return { ...it, pts: smoothPoints(it.pts, strength) };
}

// Versão com cache para traços já concluídos (não usar no traço que ainda está sendo escrito).
const cache = new WeakMap<Item, { s: number; out: Item }>();
export function smoothItemCached(it: Item, strength: number): Item {
  if (it.kind !== "ink" || strength <= 0 || isShape(it)) return it;
  const hit = cache.get(it);
  if (hit && hit.s === strength) return hit.out;
  const out = smoothItem(it, strength);
  cache.set(it, { s: strength, out });
  return out;
}
