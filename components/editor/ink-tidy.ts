import type { InkItem, Item } from "../pdf/types";
import { groupIntoLines } from "./ink-recognize";

// Modo "Organizada": alinha as linhas (corrige a inclinação), deixa as palavras de um tamanho parecido,
// no mesmo nível vertical e com o mesmo espaço entre elas. Os traços continuam sendo os seus: só mudam de posição e escala.
// amount vai de 0 a 1 (quanto maior, mais uniforme). Posições dos itens: x e y divididos pela largura da página.

type S = { item: InkItem; p: number[]; minX: number; maxX: number; minY: number; maxY: number; cy: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function measure(item: InkItem, p: number[]): S {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  return { item, p, minX, maxX, minY, maxY, cy: (minY + maxY) / 2 };
}

function wordInfo(ws: S[]) {
  return {
    minX: Math.min(...ws.map((s) => s.minX)),
    maxX: Math.max(...ws.map((s) => s.maxX)),
    minY: Math.min(...ws.map((s) => s.minY)),
    maxY: Math.max(...ws.map((s) => s.maxY)),
    my: median(ws.map((s) => s.cy)), // "centro" do corpo das letras (robusto a pingos e traços altos)
  };
}

export function tidyItems(items: Item[], pageW: number, amount: number): Item[] {
  const t = clamp(amount, 0, 1);
  if (!t || !pageW) return items;
  const out = new Map<string, number[]>();

  for (const group of groupIntoLines(items, pageW)) {
    let strokes = group.items.map((it) => measure(it, it.pts.map((v) => v * pageW)));
    if (strokes.length < 2) continue;

    // 1) linha reta: remove a inclinação média da linha
    const cxs = strokes.map((s) => (s.minX + s.maxX) / 2);
    const cys = strokes.map((s) => s.cy);
    if (strokes.length >= 3 && Math.max(...cxs) - Math.min(...cxs) > 60) {
      const mx = mean(cxs);
      const my = mean(cys);
      let num = 0;
      let den = 0;
      cxs.forEach((x, i) => {
        num += (x - mx) * (cys[i] - my);
        den += (x - mx) * (x - mx);
      });
      const ang = clamp(Math.atan(den > 0 ? num / den : 0), -0.25, 0.25) * t;
      if (Math.abs(ang) > 0.002) {
        const px = Math.min(...strokes.map((s) => s.minX));
        const c = Math.cos(-ang);
        const sn = Math.sin(-ang);
        for (const s of strokes) {
          for (let i = 0; i + 1 < s.p.length; i += 2) {
            const dx = s.p[i] - px;
            const dy = s.p[i + 1] - my;
            s.p[i] = px + dx * c - dy * sn;
            s.p[i + 1] = my + dx * sn + dy * c;
          }
        }
        strokes = strokes.map((s) => measure(s.item, s.p));
      }
    }

    // 2) palavras: traços próximos na horizontal formam uma palavra
    const medH = Math.max(8, median(strokes.map((s) => s.maxY - s.minY)));
    const sorted = [...strokes].sort((a, b) => a.minX - b.minX);
    let words: S[][] = [];
    let curMax = -Infinity;
    for (const s of sorted) {
      if (!words.length || s.minX - curMax > medH * 0.4) {
        words.push([s]);
        curMax = s.maxX;
      } else {
        words[words.length - 1].push(s);
        curMax = Math.max(curMax, s.maxX);
      }
    }

    if (words.length >= 2) {
      // 3) tamanho parecido entre as palavras (escala em torno do início e do centro da palavra)
      const infos = words.map(wordInfo);
      const target = median(infos.map((i) => i.maxY - i.minY));
      words.forEach((ws, k) => {
        const h = Math.max(1, infos[k].maxY - infos[k].minY);
        const f = clamp(lerp(1, target / h, t * 0.8), 0.85, 1.2);
        if (Math.abs(f - 1) < 0.01) return;
        const ax = infos[k].minX;
        const ay = infos[k].my;
        for (const s of ws) {
          for (let i = 0; i + 1 < s.p.length; i += 2) {
            s.p[i] = ax + (s.p[i] - ax) * f;
            s.p[i + 1] = ay + (s.p[i + 1] - ay) * f;
          }
        }
      });
      words = words.map((ws) => ws.map((s) => measure(s.item, s.p)));

      // 4) mesmo nível vertical
      const infos2 = words.map(wordInfo);
      const lineMy = median(infos2.map((i) => i.my));
      words.forEach((ws, k) => {
        const dy = (lineMy - infos2[k].my) * t * 0.7;
        if (Math.abs(dy) < 0.05) return;
        for (const s of ws) for (let i = 1; i < s.p.length; i += 2) s.p[i] += dy;
      });
      words = words.map((ws) => ws.map((s) => measure(s.item, s.p)));

      // 5) espaço parecido entre as palavras
      const infos3 = words.map(wordInfo);
      const gaps = infos3.slice(1).map((inf, k) => inf.minX - infos3[k].maxX);
      const positive = gaps.filter((g) => g > 0);
      if (positive.length >= 2) {
        const wanted = median(positive);
        let acc = 0;
        for (let k = 1; k < words.length; k++) {
          const g = gaps[k - 1];
          if (g > 0) acc += (lerp(g, wanted, t * 0.9) - g);
          if (Math.abs(acc) < 0.05) continue;
          for (const s of words[k]) for (let i = 0; i < s.p.length; i += 2) s.p[i] += acc;
        }
      }
    }

    for (const s of strokes) out.set(s.item.id, s.p.map((v) => v / pageW));
  }

  return items.map((it) => (it.kind === "ink" && out.has(it.id) ? { ...it, pts: out.get(it.id)! } : it));
}
