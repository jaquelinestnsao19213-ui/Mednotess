import { uid, type EllipseItem, type InkItem, type Item } from "../pdf/types";

// Reconhecimento de formas para a caneta: linha, círculo/elipse, triângulo, retângulo/quadrado.
// Trabalha em pixels (pontos normalizados x largura). Devolve null quando o traço não parece uma forma:
// aí o traço fica como foi escrito (letras, rabiscos).

type P = { x: number; y: number };
export type Shape =
  | { kind: "line"; a: P; b: P }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "poly"; v: P[] };

const MIN_SIZE = 36; // formas menores que isso (px) são tratadas como letra
const DEG = Math.PI / 180;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function toPoints(pts: number[], w: number): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i] * w, y: pts[i + 1] * w });
  return out;
}

function pathLen(p: P[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

// Pontos igualmente espaçados ao longo do traço (deixa a análise independente da velocidade da caneta).
function resample(p: P[], n: number): P[] {
  const total = pathLen(p);
  if (total === 0) return p;
  const step = total / (n - 1);
  const out: P[] = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length && out.length < n; i++) {
    let a = p[i - 1];
    const b = p[i];
    let d = dist(a, b);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      d = dist(a, b);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < n) out.push(p[p.length - 1]);
  return out;
}

function distToSeg(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer–Douglas–Peucker
function rdp(p: P[], eps: number): P[] {
  if (p.length < 3) return p;
  const a = p[0];
  const b = p[p.length - 1];
  let md = 0;
  let idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = distToSeg(p[i], a, b);
    if (d > md) {
      md = d;
      idx = i;
    }
  }
  if (md <= eps) return [a, b];
  const l = rdp(p.slice(0, idx + 1), eps);
  const r = rdp(p.slice(idx), eps);
  return [...l.slice(0, -1), ...r];
}

function turn(prev: P, cur: P, next: P): number {
  const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
  const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// Tira vértices quase retos (o ponto onde o traço começou no meio de um lado) e vértices muito juntos.
function cleanup(v: P[], diag: number): P[] {
  let cur = v.slice();
  for (;;) {
    if (cur.length <= 3) return cur;
    const n = cur.length;
    let worst = -1;
    let worstScore = Infinity;
    for (let i = 0; i < n; i++) {
      const prev = cur[(i + n - 1) % n];
      const next = cur[(i + 1) % n];
      const t = turn(prev, cur[i], next);
      const short = Math.min(dist(prev, cur[i]), dist(cur[i], next)) < diag * 0.1;
      const score = short ? -1 : t;
      if ((short || t < 28 * DEG) && score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (worst < 0) return cur;
    cur = cur.filter((_, i) => i !== worst);
  }
}

function snapLine(a: P, b: P): [P, P] {
  const len = dist(a, b);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(ang - snapped) < 7 * DEG) {
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const hx = (Math.cos(snapped) * len) / 2;
    const hy = (Math.sin(snapped) * len) / 2;
    return [
      { x: c.x - hx, y: c.y - hy },
      { x: c.x + hx, y: c.y + hy },
    ];
  }
  return [a, b];
}

function asRect(v: P[]): P[] | null {
  const ang: number[] = v.map((p, i) => {
    const q = v[(i + 1) % 4];
    return Math.atan2(q.y - p.y, q.x - p.x);
  });
  let sx = 0;
  let sy = 0;
  for (const a of ang) {
    sx += Math.cos(4 * a);
    sy += Math.sin(4 * a);
  }
  let theta = Math.atan2(sy, sx) / 4;
  for (const a of ang) {
    let d = Math.abs(((a - theta) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    d = Math.min(d, Math.PI / 2 - d);
    if (d > 15 * DEG) return null;
  }
  if (Math.abs(Math.sin(2 * theta)) < Math.sin(2 * 8 * DEG)) theta = 0;
  const c = { x: v.reduce((s, p) => s + p.x, 0) / 4, y: v.reduce((s, p) => s + p.y, 0) / 4 };
  const co = Math.cos(-theta);
  const si = Math.sin(-theta);
  const r = v.map((p) => ({ x: (p.x - c.x) * co - (p.y - c.y) * si, y: (p.x - c.x) * si + (p.y - c.y) * co }));
  let x0 = Math.min(...r.map((p) => p.x));
  let x1 = Math.max(...r.map((p) => p.x));
  let y0 = Math.min(...r.map((p) => p.y));
  let y1 = Math.max(...r.map((p) => p.y));
  const w = x1 - x0;
  const h = y1 - y0;
  if (Math.abs(w - h) / Math.max(w, h) < 0.12) {
    const s = (w + h) / 2;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    x0 = mx - s / 2;
    x1 = mx + s / 2;
    y0 = my - s / 2;
    y1 = my + s / 2;
  }
  const bc = Math.cos(theta);
  const bs = Math.sin(theta);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => ({ x: c.x + x * bc - y * bs, y: c.y + x * bs + y * bc }));
}

export function recognizeShape(pts: number[], w: number): Shape | null {
  const raw = toPoints(pts, w);
  if (raw.length < 5 || !w) return null;
  const L = pathLen(raw);
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bw = maxX - minX;
  const bh = maxY - minY;
  const diag = Math.hypot(bw, bh);
  if (diag < MIN_SIZE) return null;
  const first = raw[0];
  const last = raw[raw.length - 1];
  const chord = dist(first, last);

  // Linha reta
  if (chord / L > 0.88) {
    let dev = 0;
    for (const p of raw) dev = Math.max(dev, distToSeg(p, first, last));
    if (dev / chord < 0.1) {
      const [a, b] = snapLine(first, last);
      return { kind: "line", a, b };
    }
    return null;
  }

  // Forma fechada
  if (chord > 0.22 * L) return null;
  if (Math.min(bw, bh) / Math.max(bw, bh) < 0.12) return null;
  const rs = resample(raw, 120);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = bw / 2;
  const ry = bh / 2;
  const rr = rs.map((p) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry));
  const mean = rr.reduce((s, v) => s + v, 0) / rr.length;
  const std = Math.sqrt(rr.reduce((s, v) => s + (v - mean) ** 2, 0) / rr.length);
  if (std / mean < 0.09 && mean > 0.85 && mean < 1.15) {
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
      const r = (rx + ry) / 2;
      return { kind: "ellipse", cx, cy, rx: r, ry: r };
    }
    return { kind: "ellipse", cx, cy, rx, ry };
  }

  const closed = [...rs, rs[0]];
  const simp = rdp(closed, diag * 0.08);
  simp.pop();
  const v = cleanup(simp, diag);
  if (v.length === 3) {
    const area = Math.abs((v[1].x - v[0].x) * (v[2].y - v[0].y) - (v[2].x - v[0].x) * (v[1].y - v[0].y)) / 2;
    if (area / (bw * bh) < 0.1) return null;
    return { kind: "poly", v };
  }
  if (v.length === 4) return { kind: "poly", v: asRect(v) ?? v };
  return null;
}

type Src = { id?: string; color: string; width: number };

// Transforma a forma em item da camada. Polígonos viram traço com pontos extras e vértice duplicado (cantos retos).
export function shapeToItem(shape: Shape, src: Src, w: number): Item {
  const id = src.id ?? uid();
  const base = { id, color: src.color, width: src.width };
  if (shape.kind === "ellipse") {
    const e: EllipseItem = { ...base, kind: "ellipse", cx: shape.cx / w, cy: shape.cy / w, rx: shape.rx / w, ry: shape.ry / w };
    return e;
  }
  const out: number[] = [];
  const push = (p: P) => out.push(p.x / w, p.y / w);
  if (shape.kind === "line") {
    push(shape.a);
    push(shape.b);
  } else {
    const v = shape.v;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      push(a);
      push(a);
      const n = Math.floor(dist(a, b) / 8);
      for (let k = 1; k < n; k++) push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    push(v[0]);
    push(v[0]);
  }
  const ink: InkItem = { ...base, kind: "ink", tool: "pen", pts: out, shape: true };
  return ink;
}

export function snapStroke(it: InkItem, w: number): Item | null {
  if (it.tool !== "pen" || it.shape) return null;
  const s = recognizeShape(it.pts, w);
  return s ? shapeToItem(s, it, w) : null;
}
