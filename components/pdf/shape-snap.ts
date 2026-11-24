// Retificar formas (como no Samsung Notes): ao segurar a caneta parada no fim do traço, uma reta, seta,
// retângulo, quadrado, triângulo, círculo ou elipse feitos à mão viram a forma certinha.
// Entrada: pontos normalizados da página (x pela largura, y pela altura). Tudo é calculado em pixels (W x H)
// para que "reto" e "redondo" valham na tela, não no espaço esticado 0–1.

export type Snap =
  | { kind: "poly"; label: string; pts: number[] } // pontos normalizados (cantos duplicados para ficarem nítidos)
  | { kind: "ellipse"; label: string; cx: number; cy: number; rx: number; ry: number }; // cx/rx pela largura, cy/ry pela altura

type P = [number, number];

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pathLength(p: P[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

// Pontos igualmente espaçados ao longo do traço.
function resample(p: P[], count: number): P[] {
  const total = pathLength(p);
  if (total === 0) return [p[0]];
  const step = total / (count - 1);
  const out: P[] = [p[0]];
  let acc = 0;
  let prev = p[0];
  for (let i = 1; i < p.length; i++) {
    let cur = p[i];
    let d = dist(prev, cur);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q: P = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
    cur = p[i];
  }
  if (out.length < count) out.push(p[p.length - 1]);
  return out;
}

function distToSeg(q: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
}

// Maior afastamento dos pontos [a..b] em relação à reta que liga p[a] a p[b].
function maxDev(p: P[], a: number, b: number): number {
  let m = 0;
  for (let i = a + 1; i < b; i++) m = Math.max(m, distToSeg(p[i], p[a], p[b]));
  return m;
}

// Douglas–Peucker (aberto): devolve os índices dos vértices.
function simplify(p: P[], eps: number): number[] {
  const keep = new Set<number>([0, p.length - 1]);
  const rec = (a: number, b: number) => {
    let idx = -1;
    let best = eps;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(p[i], p[a], p[b]);
      if (d > best) {
        best = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep.add(idx);
      rec(a, idx);
      rec(idx, b);
    }
  };
  rec(0, p.length - 1);
  return Array.from(keep).sort((x, y) => x - y);
}

function polyErr(pts: P[], poly: P[]): number {
  let s = 0;
  for (const q of pts) {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSeg(q, poly[i], poly[(i + 1) % poly.length]));
    s += m;
  }
  return s / pts.length;
}

// Cantos duplicados: o desenho suaviza o traço por curvas, e o canto duplicado fica pontudo.
function densify(vertices: P[], closed: boolean, W: number, H: number): number[] {
  const out: number[] = [];
  const push = (q: P) => out.push(Math.round((q[0] / W) * 10000) / 10000, Math.round((q[1] / H) * 10000) / 10000);
  const m = vertices.length;
  const last = closed ? m : m - 1;
  push(vertices[0]);
  for (let i = 0; i < last; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % m];
    const d = dist(a, b);
    const k = Math.max(1, Math.round(d / 14));
    for (let j = 1; j < k; j++) push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    push(b);
    if (i < last - 1 || closed) push(b); // canto duplicado
  }
  return out;
}

function snapAngle(a: P, b: P): P {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const near = Math.round(ang / step) * step;
  if (Math.abs(ang - near) <= (7 * Math.PI) / 180) return [a[0] + Math.cos(near) * len, a[1] + Math.sin(near) * len];
  return b;
}

function arrowFrom(R: P[], W: number, H: number): Snap | null {
  const n = R.length;
  let far = 0;
  for (let i = 1; i < n; i++) far = Math.max(far, dist(R[0], R[i]));
  // A ponta é a PRIMEIRA vez que o traço chega ao ponto mais distante (depois ele volta a passar por ali ao desenhar as asas).
  let tip = 0;
  for (let i = 1; i < n; i++) {
    if (dist(R[0], R[i]) >= far - Math.max(4, far * 0.03)) {
      tip = i;
      break;
    }
  }
  if (tip < Math.floor(n * 0.4) || tip > n - 6 || far < 36) return null;
  if (maxDev(R, 0, tip) > Math.max(5, far * 0.08)) return null;
  const tail = R.slice(tip);
  const tailLen = pathLength(tail);
  if (tailLen < far * 0.2 || tailLen > far * 1.6) return null;
  // eixo da ponta para o rabo
  const ux = (R[0][0] - R[tip][0]) / far;
  const uy = (R[0][1] - R[tip][1]) / far;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const q of tail) {
    const dx = q[0] - R[tip][0];
    const dy = q[1] - R[tip][1];
    aMax = Math.max(aMax, dx * ux + dy * uy);
    const b = -dx * uy + dy * ux;
    bMin = Math.min(bMin, b);
    bMax = Math.max(bMax, b);
  }
  if (aMax < far * 0.08 || aMax > far * 0.8) return null; // a ponta abre para trás
  if (bMin > -far * 0.04 || bMax < far * 0.04) return null; // e dos dois lados
  const tipP = snapAngle(R[0], R[tip]);
  const wing = Math.max(12, Math.min(46, far * 0.25));
  const ang = (28 * Math.PI) / 180;
  const w = (s: number): P => {
    const c = Math.cos(s * ang);
    const si = Math.sin(s * ang);
    return [tipP[0] + (ux * c - uy * si) * wing, tipP[1] + (ux * si + uy * c) * wing];
  };
  const vs: P[] = [R[0], tipP, w(1), tipP, w(-1)];
  return { kind: "poly", label: "Seta", pts: densify(vs, false, W, H) };
}

function rectPoly(cx: number, cy: number, hw: number, hh: number, ux: number, uy: number): P[] {
  const vx = -uy;
  const vy = ux;
  const c = (sx: number, sy: number): P => [cx + ux * hw * sx + vx * hh * sy, cy + uy * hw * sx + vy * hh * sy];
  return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
}

export function snapShape(pts: number[], W: number, H: number): Snap | null {
  const n = pts.length >> 1;
  if (n < 5 || W <= 0 || H <= 0) return null;
  const raw: P[] = [];
  for (let i = 0; i < n; i++) raw.push([pts[2 * i] * W, pts[2 * i + 1] * H]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of raw) {
    minX = Math.min(minX, q[0]);
    maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]);
    maxY = Math.max(maxY, q[1]);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const diag = Math.hypot(bw, bh);
  if (Math.max(bw, bh) < 28) return null;
  const len = pathLength(raw);
  const R = resample(raw, 96);
  const chord = dist(raw[0], raw[n - 1]);

  // ---------- traço aberto: reta ou seta ----------
  if (chord > 0.25 * len) {
    if (maxDev(R, 0, R.length - 1) <= Math.max(5, chord * 0.07)) {
      const end = snapAngle(raw[0], raw[n - 1]);
      return { kind: "poly", label: "Reta", pts: densify([raw[0], end], false, W, H) };
    }
    return arrowFrom(R, W, H);
  }

  // ---------- traço fechado: círculo, elipse, retângulo, quadrado, triângulo ----------
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(1, bw / 2);
  const ry = Math.max(1, bh / 2);
  let eE = 0;
  let eR = 0;
  for (const q of R) {
    eE += Math.abs(Math.hypot((q[0] - cx) / rx, (q[1] - cy) / ry) - 1);
    eR += Math.min(q[0] - minX, maxX - q[0], q[1] - minY, maxY - q[1]);
  }
  eE /= R.length;
  eR = eR / R.length / Math.max(1, Math.min(bw, bh));

  // vértices (o traço fechado é tratado como aberto, com a ponta colada no começo)
  const closedPath: P[] = [...R, R[0]];
  const idx = simplify(closedPath, Math.max(5, diag * 0.06));
  const verts: P[] = idx.slice(0, -1).map((i) => closedPath[i]);
  const m = verts.length;

  if (m === 3 && polyErr(R, verts) <= diag * 0.035) {
    return { kind: "poly", label: "Triângulo", pts: densify(verts, true, W, H) };
  }

  if (m === 4) {
    // retângulo girado: ângulos de 90° e lados opostos parecidos
    const e = [0, 1, 2, 3].map((i) => [verts[(i + 1) % 4][0] - verts[i][0], verts[(i + 1) % 4][1] - verts[i][1]] as P);
    const l = e.map((v) => Math.hypot(v[0], v[1]));
    const cos = (a: P, b: P) => Math.abs((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1));
    const rectLike = [0, 1, 2, 3].every((i) => cos(e[i], e[(i + 1) % 4]) < 0.26) && Math.abs(l[0] - l[2]) < 0.3 * Math.max(l[0], l[2]) && Math.abs(l[1] - l[3]) < 0.3 * Math.max(l[1], l[3]);
    if (rectLike && polyErr(R, verts) <= diag * 0.045 && eE > 0.07) {
      let ang = Math.atan2(e[0][1], e[0][0]);
      const q = Math.PI / 2;
      const nearAxis = Math.abs(ang - Math.round(ang / q) * q) <= (8 * Math.PI) / 180;
      if (!nearAxis) {
        // média das direções dos lados (módulo 90°)
        const a0 = Math.atan2(e[0][1], e[0][0]);
        const a1 = Math.atan2(e[2][1], e[2][0]) + Math.PI;
        ang = Math.atan2(Math.sin(a0) + Math.sin(a1), Math.cos(a0) + Math.cos(a1));
        const ccx = (verts[0][0] + verts[1][0] + verts[2][0] + verts[3][0]) / 4;
        const ccy = (verts[0][1] + verts[1][1] + verts[2][1] + verts[3][1]) / 4;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        let hw = 0;
        let hh = 0;
        for (const v of verts) {
          hw = Math.max(hw, Math.abs((v[0] - ccx) * ux + (v[1] - ccy) * uy));
          hh = Math.max(hh, Math.abs(-(v[0] - ccx) * uy + (v[1] - ccy) * ux));
        }
        const sq = Math.abs(hw - hh) < 0.1 * Math.max(hw, hh);
        if (sq) hw = hh = (hw + hh) / 2;
        return { kind: "poly", label: sq ? "Quadrado" : "Retângulo", pts: densify(rectPoly(ccx, ccy, hw, hh, ux, uy), true, W, H) };
      }
    }
  }

  if (eE < 0.075 && eE <= eR) {
    const circle = Math.abs(rx - ry) < 0.12 * Math.max(rx, ry);
    const r = (rx + ry) / 2;
    const px = circle ? r : rx;
    const py = circle ? r : ry;
    return { kind: "ellipse", label: circle ? "Círculo" : "Elipse", cx: cx / W, cy: cy / H, rx: px / W, ry: py / H };
  }

  if (eR < 0.1) {
    let hw = bw / 2;
    let hh = bh / 2;
    const sq = Math.abs(hw - hh) < 0.1 * Math.max(hw, hh);
    if (sq) hw = hh = (hw + hh) / 2;
    return { kind: "poly", label: sq ? "Quadrado" : "Retângulo", pts: densify(rectPoly(cx, cy, hw, hh, 1, 0), true, W, H) };
  }
  return null;
}
