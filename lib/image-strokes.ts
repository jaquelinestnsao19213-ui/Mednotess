import type { Item } from "../components/pdf/types";

// Desenhos feitos por cima de uma imagem. Ficam guardados no próprio bloco da imagem,
// em coordenadas normalizadas (0 a 1) — a imagem original nunca é alterada.

const COLOR = /^#[0-9a-f]{3,8}$/i;
const MAX_ITEMS = 2000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isItem(v: unknown): v is Item {
  if (!v || typeof v !== "object") return false;
  const it = v as Record<string, unknown>;
  if (typeof it.id !== "string" || typeof it.color !== "string" || !COLOR.test(it.color) || !num(it.width)) return false;
  if (it.kind === "ink") {
    return (
      (it.tool === "pen" || it.tool === "highlighter") &&
      Array.isArray(it.pts) &&
      it.pts.length >= 2 &&
      it.pts.length % 2 === 0 &&
      it.pts.every(num)
    );
  }
  if (it.kind === "ellipse") return num(it.cx) && num(it.cy) && num(it.rx) && num(it.ry);
  return false;
}

/** Aceita uma lista, ou um texto JSON, e devolve só os traços válidos. */
export function normalizeStrokes(value: unknown): Item[] {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  return data.filter(isItem).slice(0, MAX_ITEMS);
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Versão em SVG dos traços (usada ao exportar para PDF). W e H são o tamanho da imagem em pixels. */
export function strokesToSvg(items: Item[], W: number, H: number): string {
  const parts = items.map((it) => {
    const sw = r(Math.max(1, it.width * W));
    if (it.kind === "ellipse") {
      return `<ellipse cx="${r(it.cx * W)}" cy="${r(it.cy * H)}" rx="${r(Math.max(1, it.rx * W))}" ry="${r(Math.max(1, it.ry * H))}" fill="none" stroke="${it.color}" stroke-width="${sw}"/>`;
    }
    const p = it.pts;
    const n = p.length / 2;
    const opacity = it.tool === "highlighter" ? ' stroke-opacity="0.4"' : "";
    if (n === 1) {
      return `<circle cx="${r(p[0] * W)}" cy="${r(p[1] * H)}" r="${r(sw / 2)}" fill="${it.color}"${it.tool === "highlighter" ? ' fill-opacity="0.4"' : ""}/>`;
    }
    let d = `M${r(p[0] * W)} ${r(p[1] * H)}`;
    for (let i = 1; i < n - 1; i++) {
      const mx = ((p[2 * i] + p[2 * i + 2]) / 2) * W;
      const my = ((p[2 * i + 1] + p[2 * i + 3]) / 2) * H;
      d += `Q${r(p[2 * i] * W)} ${r(p[2 * i + 1] * H)} ${r(mx)} ${r(my)}`;
    }
    d += `L${r(p[2 * (n - 1)] * W)} ${r(p[2 * (n - 1) + 1] * H)}`;
    return `<path d="${d}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${parts.join("")}</svg>`;
}
