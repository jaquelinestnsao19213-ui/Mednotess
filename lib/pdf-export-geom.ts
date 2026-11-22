// Geometria para gravar as anotações (coordenadas normalizadas 0–1 da página vista na tela)
// dentro do PDF (espaço do usuário do PDF: origem embaixo à esquerda, com CropBox e rotação da página).
// Sem dependências: dá para testar no Node.

export type Rot = 0 | 90 | 180 | 270;
export type Box = { x: number; y: number; width: number; height: number };

export function normRot(angle: number): Rot {
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return a as Rot;
}

// Tamanho da página como aparece na tela (com a rotação aplicada).
export function viewSize(box: Box, rot: Rot): { W: number; H: number } {
  return rot === 90 || rot === 270 ? { W: box.height, H: box.width } : { W: box.width, H: box.height };
}

// Ponto normalizado (u, v), com v crescendo para baixo, para coordenadas do PDF (y cresce para cima).
export function toUser(u: number, v: number, box: Box, rot: Rot): [number, number] {
  const { W, H } = viewSize(box, rot);
  const vx = u * W;
  const vy = v * H;
  let ux: number;
  let uy: number;
  if (rot === 0) {
    ux = vx;
    uy = box.height - vy;
  } else if (rot === 90) {
    ux = vy;
    uy = vx;
  } else if (rot === 180) {
    ux = box.width - vx;
    uy = vy;
  } else {
    ux = box.width - vy;
    uy = box.height - vx;
  }
  return [box.x + ux, box.y + uy];
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

// O pdf-lib (drawSvgPath) inverte o eixo y; por isso o caminho usa (x, -y) e é desenhado na origem (0, 0).
const P = (p: [number, number]) => `${f(p[0])} ${f(-p[1])}`;

// Traço à mão livre: mesma suavização da tela (curvas quadráticas pelos pontos médios).
export function inkPath(pts: number[], box: Box, rot: Rot): string {
  const n = Math.floor(pts.length / 2);
  if (n < 2) return "";
  const q: [number, number][] = [];
  for (let i = 0; i < n; i++) q.push(toUser(pts[2 * i], pts[2 * i + 1], box, rot));
  let d = `M ${P(q[0])}`;
  for (let i = 1; i < n - 1; i++) {
    const mid: [number, number] = [(q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2];
    d += ` Q ${P(q[i])} ${P(mid)}`;
  }
  d += ` L ${P(q[n - 1])}`;
  return d;
}

// Círculo/elipse como polígono fino (funciona em qualquer rotação da página).
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, box: Box, rot: Rot, steps = 72): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push(toUser(cx + rx * Math.cos(a), cy + ry * Math.sin(a), box, rot));
  }
  return `M ${P(pts[0])} ${pts.slice(1).map((p) => `L ${P(p)}`).join(" ")} Z`;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [0.1, 0.14, 0.19];
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
