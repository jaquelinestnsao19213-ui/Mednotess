// Reconhecimento de formas para o traço da caneta: reta, seta e retângulo (ou quadrado).
// Entrada: pontos normalizados [x0, y0, x1, y1, ...] (x e y divididos pela LARGURA da página); "w" é a largura em pixels.
// Saída: os pontos da forma perfeita, também normalizados, ou null se o traço não parece nenhuma delas.
//
// Seta: desenhe a haste até a ponta e, SEM levantar a caneta, volte pela primeira farpa, retorne à ponta e faça a segunda farpa.

export type ShapeKind = "line" | "arrow" | "rect";
export type Shape = { kind: ShapeKind; pts: number[] };

type P = { x: number; y: number };

const STEP_PX = 5; // distância entre os pontos da forma (mantém os cantos nítidos mesmo com a curva suave do desenho)
const MIN_LINE_PX = 24;
const MIN_ARROW_PX = 50;
const MIN_BOX_PX = 24;
const AXIS_SNAP = (7 * Math.PI) / 180; // até 7° de inclinação vira horizontal/vertical exata

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function distToSeg(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function toPx(pts: number[], w: number): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i] * w, y: pts[i + 1] * w });
  return out;
}

// Tira pontos repetidos (a caneta parada no fim do traço deixa vários quase no mesmo lugar).
function clean(p: P[]): P[] {
  const out: P[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || dist(last, q) >= 1.2) out.push(q);
  }
  return out;
}

function pathLen(p: P[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

// Douglas-Peucker: reduz o traço aos vértices que importam.
function rdp(p: P[], eps: number): P[] {
  if (p.length < 3) return p.slice();
  let idx = 0;
  let dmax = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = distToSeg(p[i], p[0], p[p.length - 1]);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= eps) return [p[0], p[p.length - 1]];
  const left = rdp(p.slice(0, idx + 1), eps);
  const right = rdp(p.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

// Junta vértices que ficaram colados (segmentos menores que minSeg), mantendo as pontas do traço.
function dropShort(v: P[], minSeg: number): P[] {
  const out = v.slice();
  let i = 0;
  while (i < out.length - 1 && out.length > 2) {
    if (dist(out[i], out[i + 1]) < minSeg) {
      if (i + 1 === out.length - 1) out.splice(i, 1);
      else out.splice(i + 1, 1);
      i = Math.max(0, i - 1);
    } else {
      i++;
    }
  }
  return out;
}

// Quase horizontal ou vertical? Devolve o ângulo exato.
function snapAngle(a: number): number {
  const q = Math.PI / 2;
  const k = Math.round(a / q);
  return Math.abs(a - k * q) <= AXIS_SNAP ? k * q : a;
}

function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// Enche cada aresta de pontos e repete os vértices: o desenho liga os pontos com curvas suaves,
// e assim os cantos continuam retos.
function densify(poly: P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / STEP_PX));
    if (i > 0) out.push(a);
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push(poly[poly.length - 1]);
  return out;
}

function detectLine(p: P[], len: number): P[] | null {
  const a = p[0];
  const b = p[p.length - 1];
  const chord = dist(a, b);
  if (chord < MIN_LINE_PX || chord < 0.8 * len) return null;
  const eps = Math.max(5, 0.06 * chord);
  for (const q of p) if (distToSeg(q, a, b) > eps) return null;
  const ang = snapAngle(Math.atan2(b.y - a.y, b.x - a.x));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const h = chord / 2;
  return [
    { x: mx - h * Math.cos(ang), y: my - h * Math.sin(ang) },
    { x: mx + h * Math.cos(ang), y: my + h * Math.sin(ang) },
  ];
}

// Seta de um traço só: haste até a ponta (T), volta pela farpa 1, retorna à ponta e faz a farpa 2.
function detectArrow(p: P[], len: number): P[] | null {
  if (len < MIN_ARROW_PX) return null;
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (const q of p) {
    minx = Math.min(minx, q.x);
    maxx = Math.max(maxx, q.x);
    miny = Math.min(miny, q.y);
    maxy = Math.max(maxy, q.y);
  }
  const diag = Math.hypot(maxx - minx, maxy - miny);
  let v = rdp(p, Math.max(4, 0.04 * diag));
  v = dropShort(v, Math.max(6, 0.03 * diag));
  if (v.length !== 5) return null;
  const [S, T, B1, T2, B2] = v;
  const shaft = dist(S, T);
  const b1 = dist(T, B1);
  const b2 = dist(T2, B2);
  if (shaft < 40) return null;
  if (Math.min(b1, b2) < 10 || Math.max(b1, b2) > 0.65 * shaft || Math.max(b1, b2) > 2.2 * Math.min(b1, b2)) return null;
  if (dist(T2, T) > 0.5 * ((b1 + b2) / 2)) return null; // a caneta tem que voltar à ponta
  const back = Math.atan2(S.y - T.y, S.x - T.x);
  const a1 = angDiff(Math.atan2(B1.y - T.y, B1.x - T.x), back);
  const a2 = angDiff(Math.atan2(B2.y - T2.y, B2.x - T2.x), back);
  const lo = (12 * Math.PI) / 180;
  const hi = (70 * Math.PI) / 180;
  if (Math.abs(a1) < lo || Math.abs(a1) > hi || Math.abs(a2) < lo || Math.abs(a2) > hi) return null;
  if (Math.sign(a1) === Math.sign(a2)) return null; // as farpas ficam uma de cada lado da haste
  const ang = snapAngle(Math.atan2(T.y - S.y, T.x - S.x));
  const tip: P = { x: S.x + shaft * Math.cos(ang), y: S.y + shaft * Math.sin(ang) };
  const half = clamp((Math.abs(a1) + Math.abs(a2)) / 2, (22 * Math.PI) / 180, (40 * Math.PI) / 180);
  const L = clamp((b1 + b2) / 2, 12, Math.max(16, 0.3 * shaft));
  const back2 = ang + Math.PI;
  const barb = (a: number): P => ({ x: tip.x + L * Math.cos(back2 + a), y: tip.y + L * Math.sin(back2 + a) });
  return [S, tip, barb(half), tip, barb(-half)];
}

function boxAt(p: P[], ang: number) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let minu = Infinity;
  let maxu = -Infinity;
  let minv = Infinity;
  let maxv = -Infinity;
  for (const q of p) {
    const u = q.x * c + q.y * s;
    const v = -q.x * s + q.y * c;
    if (u < minu) minu = u;
    if (u > maxu) maxu = u;
    if (v < minv) minv = v;
    if (v > maxv) maxv = v;
  }
  return { minu, maxu, minv, maxv, c, s };
}

// Retângulo (ou quadrado): o traço precisa fechar, contornar uma caixa e passar perto dos quatro cantos.
function detectRect(p: P[], len: number): P[] | null {
  if (p.length < 8) return null;
  const gap = dist(p[0], p[p.length - 1]);

  // caixa de menor área, girando de 1° em 1°
  let bestDeg = 0;
  let bestArea = Infinity;
  for (let deg = 0; deg < 90; deg++) {
    const b = boxAt(p, (deg * Math.PI) / 180);
    const area = (b.maxu - b.minu) * (b.maxv - b.minv);
    if (area < bestArea) {
      bestArea = area;
      bestDeg = deg;
    }
  }
  // quase reto na página: usa a caixa alinhada aos eixos
  const ang = bestDeg < 7 || bestDeg > 83 ? 0 : (bestDeg * Math.PI) / 180;
  const { minu, maxu, minv, maxv, c, s } = boxAt(p, ang);
  const bw = maxu - minu;
  const bh = maxv - minv;
  const minSide = Math.min(bw, bh);
  const maxSide = Math.max(bw, bh);
  if (minSide < MIN_BOX_PX || maxSide / minSide > 12) return null;
  const perim = 2 * (bw + bh);
  if (len < 0.78 * perim || len > 1.7 * perim) return null;
  if (gap > 0.18 * perim) return null; // não fechou: não é retângulo

  // o traço tem que acompanhar as bordas da caixa
  const ds = p
    .map((q) => {
      const u = q.x * c + q.y * s;
      const v = -q.x * s + q.y * c;
      return Math.min(u - minu, maxu - u, v - minv, maxv - v);
    })
    .sort((a, b) => a - b);
  const p90 = ds[Math.floor(0.9 * (ds.length - 1))];
  if (p90 > 0.1 * minSide + 3) return null;

  // e passar perto dos quatro cantos (isso separa o retângulo de círculo e triângulo)
  const tol = 0.14 * minSide + 3;
  const corners: Array<[number, number]> = [
    [minu, minv],
    [maxu, minv],
    [maxu, maxv],
    [minu, maxv],
  ];
  for (const [cu, cv] of corners) {
    let near = false;
    for (const q of p) {
      const u = q.x * c + q.y * s;
      const v = -q.x * s + q.y * c;
      if (Math.hypot(u - cu, v - cv) <= tol) {
        near = true;
        break;
      }
    }
    if (!near) return null;
  }

  const cu = (minu + maxu) / 2;
  const cv = (minv + maxv) / 2;
  let hw = bw / 2;
  let hh = bh / 2;
  if (Math.abs(bw - bh) <= 0.12 * maxSide) {
    hw = (bw + bh) / 4; // quase quadrado: vira quadrado
    hh = hw;
  }
  const uv: Array<[number, number]> = [
    [cu - hw, cv - hh],
    [cu + hw, cv - hh],
    [cu + hw, cv + hh],
    [cu - hw, cv + hh],
    [cu - hw, cv - hh],
  ];
  return uv.map(([u, v]) => ({ x: u * c - v * s, y: u * s + v * c }));
}

function finish(kind: ShapeKind, poly: P[], w: number): Shape {
  const pts: number[] = [];
  for (const q of densify(poly)) pts.push(q.x / w, q.y / w);
  return { kind, pts };
}

export function recognizeShape(pts: number[], w: number): Shape | null {
  if (!w || pts.length < 6) return null;
  const p = clean(toPx(pts, w));
  if (p.length < 3) return null;
  const len = pathLen(p);
  const line = detectLine(p, len);
  if (line) return finish("line", line, w);
  const arrow = detectArrow(p, len);
  if (arrow) return finish("arrow", arrow, w);
  const rect = detectRect(p, len);
  if (rect) return finish("rect", rect, w);
  return null;
}
