import { drawItem } from "../pdf/draw";
import type { InkItem, Item } from "../pdf/types";
import type { LayerItem } from "./ink-text";

// Traço de caneta com pressão: "pr" guarda um valor (0 a 1) por ponto. É um dado opcional dentro do JSON da camada:
// traços antigos (sem "pr") e feitos com dedo ou mouse continuam com espessura constante.
export type PenInk = InkItem & { pr?: number[] };

// 0.5 (pressão média) dá a espessura escolhida; pressão leve afina e pressão forte engrossa.
export const pressureFactor = (p: number) => 0.4 + 1.2 * Math.min(1, Math.max(0, p));

// Desenha o traço em segmentos de curva, cada um com a sua espessura. "from" permite continuar de onde parou
// (usado no traço em andamento). Devolve até qual ponto já foi desenhado. O chamador define cor e pontas arredondadas.
export function strokePressure(ctx: CanvasRenderingContext2D, pts: number[], pr: number[], W: number, base: number, from = 0): number {
  const n = pts.length / 2;
  if (n < 1) return 0;
  const X = (i: number) => pts[2 * i] * W;
  const Y = (i: number) => pts[2 * i + 1] * W;
  const f = (i: number) => pressureFactor(pr[Math.max(0, Math.min(n - 1, i))] ?? 0.5);
  const wid = (i: number) => (base * (f(i - 1) + 2 * f(i) + f(i + 1))) / 4;
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(X(0), Y(0), Math.max(0.5, (base * f(0)) / 2), 0, Math.PI * 2);
    ctx.fill();
    return 0;
  }
  let sx = from === 0 ? X(0) : (X(from) + X(from + 1)) / 2;
  let sy = from === 0 ? Y(0) : (Y(from) + Y(from + 1)) / 2;
  let last = from;
  for (let i = from + 1; i <= n - 2; i++) {
    const mx = (X(i) + X(i + 1)) / 2;
    const my = (Y(i) + Y(i + 1)) / 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(X(i), Y(i), mx, my);
    ctx.lineWidth = Math.max(1, wid(i));
    ctx.stroke();
    sx = mx;
    sy = my;
    last = i;
  }
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(X(n - 1), Y(n - 1)); // a ponta acompanha a caneta
  ctx.lineWidth = Math.max(1, base * f(n - 1));
  ctx.stroke();
  return last;
}

// Desenha um item da camada: com pressão quando o traço tem "pr", e do jeito de sempre nos demais.
export function drawInkItem(ctx: CanvasRenderingContext2D, it: Item, W: number) {
  const p = it as PenInk;
  if (p.kind === "ink" && p.tool === "pen" && p.pr && p.pr.length * 2 === p.pts.length) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = p.color;
    ctx.fillStyle = p.color;
    strokePressure(ctx, p.pts, p.pr, W, Math.max(1, p.width * W));
    ctx.restore();
    return;
  }
  drawItem(ctx, it, W, W);
}

// Aumenta ou diminui um item em volta do ponto (cx, cy). Traços e círculos engrossam junto; textos mudam de tamanho.
// Um texto convertido leva o manuscrito guardado junto (traços e âncora), para que continue combinando com o texto.
export function scaleLayerItem(it: LayerItem, s: number, cx: number, cy: number): LayerItem {
  if (it.kind === "text") {
    const scaled = { ...it, x: cx + (it.x - cx) * s, y: cy + (it.y - cy) * s, size: it.size * s };
    if (it.src) {
      scaled.src = {
        items: it.src.items.map((g) => scaleLayerItem(g, s, cx, cy) as InkItem),
        ox: cx + (it.src.ox - cx) * s,
        oy: cy + (it.src.oy - cy) * s,
      };
    }
    return scaled;
  }
  if (it.kind === "ink") {
    const pts = it.pts.slice();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      pts[i] = cx + (pts[i] - cx) * s;
      pts[i + 1] = cy + (pts[i + 1] - cy) * s;
    }
    return { ...it, pts, width: it.width * s };
  }
  return { ...it, cx: cx + (it.cx - cx) * s, cy: cy + (it.cy - cy) * s, rx: it.rx * s, ry: it.ry * s, width: it.width * s };
}
