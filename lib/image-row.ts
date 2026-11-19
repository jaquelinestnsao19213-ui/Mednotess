// Imagens lado a lado: quais imagens formam uma linha e que largura cada uma recebe para caberem juntas.

export const ROW_GAP = 8;
export type Sibling = { isImage: boolean; row: boolean };

/** Faixa [início, fim] das imagens seguidas marcadas "lado a lado" que incluem a de posição `index`. */
export function rowRange(items: Sibling[], index: number): [number, number] {
  if (!items[index]?.isImage || !items[index].row) return [index, index];
  let a = index;
  let b = index;
  while (a > 0 && items[a - 1].isImage && items[a - 1].row) a--;
  while (b < items.length - 1 && items[b + 1].isImage && items[b + 1].row) b++;
  return [a, b];
}

/** Largura (px) de cada imagem para `count` imagens caberem na largura disponível. */
export function fitWidth(available: number, count: number, gap = ROW_GAP): number {
  const n = Math.max(1, count);
  return Math.max(80, Math.floor((available - gap * n) / n));
}
