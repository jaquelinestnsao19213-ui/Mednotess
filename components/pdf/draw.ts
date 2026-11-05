import type { Item } from "./types";

function strokeInk(ctx: CanvasRenderingContext2D, pts: number[], W: number, H: number) {
  const n = pts.length / 2;
  if (n < 1) return;
  ctx.beginPath();
  if (n === 1) {
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.arc(pts[0] * W, pts[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0] * W, pts[1] * H);
  for (let i = 1; i < n - 1; i++) {
    const mx = ((pts[2 * i] + pts[2 * i + 2]) / 2) * W;
    const my = ((pts[2 * i + 1] + pts[2 * i + 3]) / 2) * H;
    ctx.quadraticCurveTo(pts[2 * i] * W, pts[2 * i + 1] * H, mx, my);
  }
  ctx.lineTo(pts[2 * (n - 1)] * W, pts[2 * (n - 1) + 1] * H);
  ctx.stroke();
}

export function drawItem(ctx: CanvasRenderingContext2D, it: Item, W: number, H: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = it.color;
  ctx.lineWidth = Math.max(1, it.width * W);
  if (it.kind === "ink") {
    if (it.tool === "highlighter") ctx.globalAlpha = 0.4;
    strokeInk(ctx, it.pts, W, H);
  } else {
    ctx.beginPath();
    ctx.ellipse(it.cx * W, it.cy * H, Math.max(1, it.rx * W), Math.max(1, it.ry * H), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawItems(ctx: CanvasRenderingContext2D, items: Item[], W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  for (const it of items) drawItem(ctx, it, W, H);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// A borracha apaga o traço inteiro que ficar perto do ponto tocado.
export function hitItem(it: Item, x: number, y: number, W: number, H: number, radiusPx: number): boolean {
  const px = x * W;
  const py = y * H;
  const reach = radiusPx + (it.width * W) / 2;
  if (it.kind === "ink") {
    const p = it.pts;
    if (p.length === 2) return Math.hypot(px - p[0] * W, py - p[1] * H) <= reach;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (distToSegment(px, py, p[i] * W, p[i + 1] * H, p[i + 2] * W, p[i + 3] * H) <= reach) return true;
    }
    return false;
  }
  const rx = Math.max(1, it.rx * W);
  const ry = Math.max(1, it.ry * H);
  const k = Math.hypot((px - it.cx * W) / rx, (py - it.cy * H) / ry);
  return Math.abs(k - 1) * Math.min(rx, ry) <= reach;
}
