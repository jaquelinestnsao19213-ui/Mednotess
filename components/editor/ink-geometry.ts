import type { Item } from "../pdf/types";

export type Box = [number, number, number, number];

export const idOf = (it: Item) => (it as Item & { id?: string }).id ?? "";

export function moveItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === "ink") {
    const pts = it.pts.slice();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      pts[i] += dx;
      pts[i + 1] += dy;
    }
    return { ...it, pts };
  }
  return { ...it, cx: it.cx + dx, cy: it.cy + dy };
}

function itemBox(it: Item): Box {
  if (it.kind === "ink") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 1 < it.pts.length; i += 2) {
      x0 = Math.min(x0, it.pts[i]);
      x1 = Math.max(x1, it.pts[i]);
      y0 = Math.min(y0, it.pts[i + 1]);
      y1 = Math.max(y1, it.pts[i + 1]);
    }
    const pad = it.width / 2;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  return [it.cx - it.rx, it.cy - it.ry, it.cx + it.rx, it.cy + it.ry];
}

export function boundsOf(items: Item[], ids: Set<string>): Box | null {
  let box: Box | null = null;
  for (const it of items) {
    if (!ids.has(idOf(it))) continue;
    const b = itemBox(it);
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  return box;
}

// Ponto dentro do laço desenhado (poly = x,y,x,y,...)
export function inPoly(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pickedByLasso(it: Item, poly: number[]): boolean {
  if (it.kind !== "ink") return inPoly(it.cx, it.cy, poly);
  const n = it.pts.length / 2;
  if (!n) return false;
  const step = Math.max(1, Math.floor(n / 24));
  let tested = 0;
  let inside = 0;
  for (let k = 0; k < n; k += step) {
    tested++;
    if (inPoly(it.pts[2 * k], it.pts[2 * k + 1], poly)) inside++;
  }
  return inside / tested >= 0.5;
}
