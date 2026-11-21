import type { InkItem, Item } from "../pdf/types";

// Converte a escrita à mão (traços da caneta) em texto, uma linha por vez.
// Os traços são agrupados em linhas pela posição vertical e enviados a /api/handwriting.

// "items" são os traços originais da linha (o manuscrito): quem converte guarda esses traços junto do texto,
// para nunca perder a letra à mão. "alts" são outras leituras possíveis, usadas para corrigir erros com um toque.
export type Recognized = {
  text: string;
  ids: string[];
  items: InkItem[];
  alts: string[];
  left: number;
  top: number;
  right: number;
  bottom: number;
  color: string;
};

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

// Só a caneta é reconhecida (marca-texto e círculos ficam de fora). Posições em pixels da largura da página.
export function groupIntoLines(items: Item[], w: number): Group[] {
  const strokes: Stroke[] = [];
  items.forEach((it, order) => {
    if (it.kind !== "ink" || it.tool !== "pen" || it.pts.length < 2) return;
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

export async function recognizeInk(items: Item[], pageW: number): Promise<{ lines: Recognized[]; failed: number }> {
  const groups = groupIntoLines(items, pageW);
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
  const data = (await res.json()) as { lines?: (string | null)[]; alts?: unknown };
  const texts = data.lines ?? [];
  const altsAll = Array.isArray(data.alts) ? (data.alts as unknown[]) : [];
  const lines: Recognized[] = [];
  let failed = 0;
  groups.forEach((g, i) => {
    const text = texts[i];
    if (!text) {
      failed += 1;
      return;
    }
    const rawAlts = altsAll[i];
    const alts = Array.isArray(rawAlts) ? rawAlts.filter((a): a is string => typeof a === "string" && !!a.trim() && a !== text).slice(0, 4) : [];
    lines.push({
      text,
      ids: g.items.map((it) => it.id),
      items: g.items,
      alts,
      left: g.left,
      top: g.top,
      right: g.right,
      bottom: g.bottom,
      color: g.items[0].color,
    });
  });
  if (!lines.length) {
    throw new Error("O reconhecedor gratuito do Google não respondeu agora. Tente de novo em instantes.");
  }
  return { lines, failed };
}
