import type { InkItem, Item } from "../pdf/types";

// Converte a escrita à mão (traços da caneta) em texto, uma linha por vez.
// Os traços são agrupados em linhas pela posição vertical e enviados a /api/handwriting.
// Setas, traços soltos (travessão de lista, sublinhado), linhas longas e círculos grandes NÃO são letras:
// ficam de fora da conversão e continuam como desenho (ver shapeIds).
// Você também decide: traço marcado com "keep" (Manter como desenho) nunca vira texto,
// e traço marcado com "force" (Converter como texto) nunca é tratado como desenho.

export type Recognized = { text: string; ids: string[]; left: number; top: number; right: number; bottom: number; color: string };

// Caixa (em pixels da largura da página) de um texto já convertido: conta como vizinho na hora de decidir se um traço é hífen.
export type Anchor = { left: number; right: number; top: number; bottom: number };

type Stroke = { item: InkItem; order: number; left: number; right: number; top: number; bottom: number; cy: number };
type Group = { items: InkItem[]; left: number; right: number; top: number; bottom: number };

function span(pts: number[], from: number, w: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < pts.length; i += 2) {
    const v = pts[i] * w;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

// ---------- Desenhos que não são letras ----------

type Geo = {
  item: InkItem;
  p: number[]; // x0, y0, x1, y1... em pixels
  left: number;
  right: number;
  top: number;
  bottom: number;
  size: number; // maior lado da caixa
  len: number; // comprimento percorrido
  chord: number; // distância entre o começo e o fim
  straight: boolean; // quase uma reta
};

function pathLength(p: number[]): number {
  let s = 0;
  for (let i = 2; i + 1 < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return s;
}

// Maior distância entre os pontos de a até b e a reta que liga o ponto a ao ponto b.
function maxDev(p: number[], a: number, b: number): number {
  const ax = p[2 * a];
  const ay = p[2 * a + 1];
  const dx = p[2 * b] - ax;
  const dy = p[2 * b + 1] - ay;
  const d = Math.hypot(dx, dy);
  let m = 0;
  for (let i = a + 1; i < b; i++) {
    const qx = p[2 * i] - ax;
    const qy = p[2 * i + 1] - ay;
    const dist = d < 1e-6 ? Math.hypot(qx, qy) : Math.abs(qx * dy - qy * dx) / d;
    if (dist > m) m = dist;
  }
  return m;
}

function minDist(p: number[], x: number, y: number): number {
  let m = Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const d = Math.hypot(p[i] - x, p[i + 1] - y);
    if (d < m) m = d;
  }
  return m;
}

function geoOf(it: InkItem, w: number): Geo | null {
  if (it.pts.length < 4) return null;
  const p = it.pts.map((v) => v * w);
  const n = Math.floor(p.length / 2);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p[2 * i];
    const y = p[2 * i + 1];
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const len = pathLength(p);
  const chord = Math.hypot(p[2 * n - 2] - p[0], p[2 * n - 1] - p[1]);
  const size = Math.max(right - left, bottom - top);
  const straight = chord > 8 && len <= chord * 1.3 && maxDev(p, 0, n - 1) <= Math.max(3, chord * 0.1);
  return { item: it, p, left, right, top, bottom, size, len, chord, straight };
}

// Tamanho típico de uma letra (75% dos traços). Retas ficam de fora da conta quando há curvas suficientes.
function textRef(geos: Geo[]): number {
  const curved = geos.filter((g) => !g.straight);
  const pool = curved.length >= 3 ? curved : geos;
  const sizes = pool.map((g) => g.size).sort((a, b) => a - b);
  return Math.max(14, sizes[Math.floor((sizes.length - 1) * 0.75)]);
}

// A ponta da seta: os pontos pts ficam para trás da ponta (a > 0) e abrem dos dois lados do corpo (b).
// (ux, uy) é a direção da ponta para o rabo da seta; L, o comprimento do corpo.
function headOk(tx: number, ty: number, ux: number, uy: number, L: number, pts: number[], both: boolean): boolean {
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  let count = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const dx = pts[i] - tx;
    const dy = pts[i + 1] - ty;
    const a = dx * ux + dy * uy;
    const b = -dx * uy + dy * ux;
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
    count++;
  }
  if (count < 2) return false;
  if (aMax < L * 0.12 || aMax > L * 0.75) return false; // a ponta vai para trás, não para frente (letra depois do traço)
  if (aMin < -L * 0.2) return false;
  if (aMax - aMin < L * 0.12) return false; // barra do "t" tem extensão zero ao longo do corpo
  if (bMax - bMin < L * 0.12) return false;
  if (both && (bMin > -L * 0.05 || bMax < L * 0.05)) return false; // abre dos dois lados
  return true;
}

// Seta com o corpo reto e a ponta em um ou dois traços separados, perto de uma das extremidades.
function arrowWith(shaft: Geo, all: Geo[]): string[] | null {
  const p = shaft.p;
  const n = Math.floor(p.length / 2);
  const L = shaft.chord;
  const ends: [number, number, number, number][] = [
    [p[2 * n - 2], p[2 * n - 1], p[0], p[1]],
    [p[0], p[1], p[2 * n - 2], p[2 * n - 1]],
  ];
  for (const [tx, ty, bx, by] of ends) {
    const heads = all.filter((o) => o !== shaft && o.size >= L * 0.1 && o.size <= L * 0.7 && minDist(o.p, tx, ty) <= L * 0.22);
    if (!heads.length) continue;
    const pts: number[] = [];
    for (const h of heads) for (const v of h.p) pts.push(v);
    if (headOk(tx, ty, (bx - tx) / L, (by - ty) / L, L, pts, true)) return [shaft.item.id, ...heads.map((h) => h.item.id)];
  }
  return null;
}

// Seta feita sem levantar a caneta: corpo reto até a ponta (o ponto mais longe do começo) e depois a ponta abrindo dos dois lados.
function singleStrokeArrow(g: Geo, ref: number): boolean {
  const p = g.p;
  const n = Math.floor(p.length / 2);
  if (n < 8 || g.size < Math.max(30, ref * 1.3)) return false;
  let tip = 0;
  let far = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p[2 * i] - p[0], p[2 * i + 1] - p[1]);
    if (d > far) {
      far = d;
      tip = i;
    }
  }
  if (tip < 3 || tip > n - 4 || far < Math.max(24, ref * 1.1)) return false;
  if (maxDev(p, 0, tip) > Math.max(3, far * 0.1)) return false;
  const shaft = pathLength(p.slice(0, 2 * tip + 2));
  if (shaft < g.len * 0.4 || shaft > far * 1.3) return false;
  const tail = pathLength(p.slice(2 * tip));
  if (tail < far * 0.2 || tail > far * 1.5) return false;
  const tx = p[2 * tip];
  const ty = p[2 * tip + 1];
  return headOk(tx, ty, (p[0] - tx) / far, (p[1] - ty) / far, far, p.slice(2 * tip), true);
}

// Traço deitado e solto: não encosta em nenhuma letra e não está entre duas palavras (hífen). É travessão de lista, sinal, etc.
function isStandaloneDash(g: Geo, all: Geo[], anchors: Anchor[], ref: number): boolean {
  const dx = g.p[g.p.length - 2] - g.p[0];
  const dy = g.p[g.p.length - 1] - g.p[1];
  if (Math.abs(dy) > Math.abs(dx) * 0.47) return false; // só traços deitados (até uns 25 graus)
  if (g.chord < ref * 0.4) return false;
  const pad = Math.max(3, ref * 0.12);
  const cy = (g.top + g.bottom) / 2;
  const slack = ref * 0.3;
  const gap = ref * 1.1;
  let left = false;
  let right = false;
  const boxes: Anchor[] = anchors.slice();
  for (const o of all) {
    if (o === g) continue;
    // encosta: é parte de uma letra (barra do t, do e, sinal de +)
    if (o.left <= g.right + pad && o.right >= g.left - pad && o.top <= g.bottom + pad && o.bottom >= g.top - pad) return false;
    boxes.push({ left: o.left, right: o.right, top: o.top, bottom: o.bottom });
  }
  for (const o of boxes) {
    if (cy < o.top - slack || cy > o.bottom + slack) continue;
    if (o.right <= g.left && g.left - o.right <= gap) left = true;
    if (o.left >= g.right && o.left - g.right <= gap) right = true;
  }
  return !(left && right);
}

// Círculo ou caixa grande desenhado em volta de algo.
function isBigLoop(g: Geo, ref: number): boolean {
  const bw = g.right - g.left;
  const bh = g.bottom - g.top;
  return g.chord <= g.len * 0.25 && g.size >= ref * 2.4 && Math.min(bw, bh) >= ref * 0.9;
}

// Ids dos traços de caneta que são desenho (seta, travessão solto, linha longa, círculo grande) e não letras.
// Esses traços não são enviados ao reconhecedor e ficam na página como foram escritos.
// "keep" (Manter como desenho) sempre é desenho; "force" (Converter como texto) nunca é desenho.
export function shapeIds(items: Item[], w: number, anchors: Anchor[] = []): Set<string> {
  const out = new Set<string>();
  const forced = new Set<string>();
  const geos: Geo[] = [];
  for (const it of items) {
    if (it.kind !== "ink" || it.tool !== "pen") continue;
    const flags = it as InkItem & { keep?: boolean; force?: boolean };
    if (flags.keep) {
      out.add(it.id);
      continue;
    }
    if (flags.force) forced.add(it.id);
    const g = geoOf(it, w);
    if (g) geos.push(g);
  }
  if (!geos.length) return out;
  const ref = textRef(geos);

  // Setas (corpo reto + ponta em traços separados)
  for (const g of geos) {
    if (!g.straight || g.chord < Math.max(24, ref * 1.1)) continue;
    const ids = arrowWith(g, geos);
    if (ids) ids.forEach((id) => out.add(id));
  }
  // Setas de um traço só
  for (const g of geos) {
    if (out.has(g.item.id) || g.straight) continue;
    if (singleStrokeArrow(g, ref)) out.add(g.item.id);
  }
  // Linhas longas, travessões soltos e círculos grandes
  for (const g of geos) {
    if (out.has(g.item.id)) continue;
    if (g.straight) {
      if (g.chord >= ref * 2.2 || isStandaloneDash(g, geos, anchors, ref)) out.add(g.item.id);
      continue;
    }
    if (isBigLoop(g, ref)) out.add(g.item.id);
  }
  forced.forEach((id) => out.delete(id));
  return out;
}

// Só a caneta é reconhecida (marca-texto, setas, traços soltos e círculos ficam de fora). Posições em pixels da largura da página.
export function groupIntoLines(items: Item[], w: number, anchors: Anchor[] = []): Group[] {
  const shapes = shapeIds(items, w, anchors);
  const strokes: Stroke[] = [];
  items.forEach((it, order) => {
    if (it.kind !== "ink" || it.tool !== "pen" || it.pts.length < 2) return;
    if (shapes.has(it.id)) return;
    const [left, right] = span(it.pts, 0, w);
    const [top, bottom] = span(it.pts, 1, w);
    strokes.push({ item: it, order, left, right, top, bottom, cy: (top + bottom) / 2 });
  });
  if (!strokes.length) return [];

  // Pontos, vírgulas e pingos de "i" são traços pequenos que ficam longe do centro da linha. Se entrassem na conta
  // das linhas, virariam uma "linha" sozinhos e a pontuação se perderia. Por isso as linhas são formadas só pelos
  // traços maiores, e os pequenos são encaixados depois na linha mais próxima.
  const sizes = strokes.map((s) => Math.max(s.right - s.left, s.bottom - s.top)).sort((a, b) => a - b);
  const ref = Math.max(14, sizes[Math.floor((sizes.length - 1) * 0.75)]);
  const isSmall = (s: Stroke) => Math.max(s.right - s.left, s.bottom - s.top) < ref * 0.35;
  let big = strokes.filter((s) => !isSmall(s));
  let small = strokes.filter(isSmall);
  if (!big.length) {
    // Só traços pequenos (ponto, vírgula ou acento soltos): sozinhos o reconhecedor devolve lixo e o texto sairia
    // como um ponto grande flutuando. Eles ficam como estão (ou são colados ao texto vizinho pela conversão automática).
    // Com vários traços pequenos pode ser letra miúda: aí trata todos como linha.
    if (strokes.length < 4) return [];
    big = strokes;
    small = [];
  }

  const heights = big.map((s) => s.bottom - s.top).sort((a, b) => a - b);
  const median = Math.max(10, heights[Math.floor(heights.length / 2)]);

  // Ordena pelo centro vertical e abre uma linha nova quando há um "salto" grande entre um traço e o seguinte.
  big.sort((a, b) => a.cy - b.cy);
  const lines: Stroke[][] = [[big[0]]];
  for (let i = 1; i < big.length; i++) {
    if (big[i].cy - big[i - 1].cy > median * 0.6) lines.push([]);
    lines[lines.length - 1].push(big[i]);
  }

  // Encaixa cada traço pequeno na linha mais próxima na vertical. Pingo solto bem longe de qualquer linha fica de fora.
  const bands = lines.map((ls) => ({ top: Math.min(...ls.map((s) => s.top)), bottom: Math.max(...ls.map((s) => s.bottom)) }));
  for (const s of small) {
    let best = -1;
    let bestD = Infinity;
    bands.forEach((b, i) => {
      const d = s.cy < b.top ? b.top - s.cy : s.cy > b.bottom ? s.cy - b.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= median * 1.2) lines[best].push(s);
  }

  return lines
    .map((ls) => {
      ls.sort((a, b) => a.order - b.order); // na ordem em que foram escritos
      return {
        items: ls.map((s) => s.item),
        left: Math.min(...ls.map((s) => s.left)),
        right: Math.max(...ls.map((s) => s.right)),
        top: Math.min(...ls.map((s) => s.top)),
        bottom: Math.max(...ls.map((s) => s.bottom)),
      };
    })
    .sort((a, b) => a.top - b.top);
}

function payload(g: Group, w: number) {
  const pad = 12;
  // Espaço horizontal a partir do qual um traço novo é tratado como começo de outra palavra.
  // Os traços não guardam o tempo real; sem uma pausa maior entre palavras o reconhecedor só tem o espaço no papel para separá-las.
  const wordGap = Math.max(8, (g.bottom - g.top) * 0.3);
  let t = 0;
  let maxRight = -Infinity;
  const ink = g.items.map((it) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const ts: number[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i + 1 < it.pts.length; i += 2) {
      const px = it.pts[i] * w;
      if (px < lo) lo = px;
      if (px > hi) hi = px;
    }
    if (maxRight > -Infinity && lo - maxRight > wordGap) t += 450; // pausa antes de uma palavra nova
    for (let i = 0; i + 1 < it.pts.length; i += 2) {
      xs.push(Math.round((it.pts[i] * w - g.left + pad) * 10) / 10);
      ys.push(Math.round((it.pts[i + 1] * w - g.top + pad) * 10) / 10);
      ts.push(t);
      t += 8;
    }
    if (xs.length === 1) {
      xs.push(xs[0]);
      ys.push(ys[0]);
      ts.push(t);
      t += 8;
    }
    if (hi > maxRight) maxRight = hi;
    t += 150;
    return [xs, ys, ts];
  });
  return {
    w: Math.max(1, Math.ceil(g.right - g.left + pad * 2)),
    h: Math.max(1, Math.ceil(g.bottom - g.top + pad * 2)),
    ink,
  };
}

export async function recognizeInk(items: Item[], pageW: number, anchors: Anchor[] = []): Promise<{ lines: Recognized[]; failed: number }> {
  const groups = groupIntoLines(items, pageW, anchors);
  if (!groups.length) return { lines: [], failed: 0 };
  if (groups.length > 40) throw new Error("São muitas linhas de uma vez. Selecione um trecho menor com o laço.");

  const res = await fetch("/api/handwriting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines: groups.map((g) => payload(g, pageW)), language: "pt" }),
  });
  if (!res.ok) {
    let msg = "Não consegui reconhecer a escrita agora.";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // mantém a mensagem padrão
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { lines?: (string | null)[] };
  const texts = data.lines ?? [];
  const lines: Recognized[] = [];
  let failed = 0;
  groups.forEach((g, i) => {
    const text = texts[i];
    if (!text) {
      failed += 1;
      return;
    }
    lines.push({ text, ids: g.items.map((it) => it.id), left: g.left, top: g.top, right: g.right, bottom: g.bottom, color: g.items[0].color });
  });
  if (!lines.length) {
    throw new Error("O reconhecedor gratuito do Google não respondeu agora. Tente de novo em instantes.");
  }
  return { lines, failed };
}
