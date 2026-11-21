import { textWidth, type TextItem } from "./ink-text";
import type { InkItem } from "../pdf/types";

// Junta pedaços novos de escrita convertida a um texto que já existe na mesma linha.
// Serve para: pausa no meio da frase (o resto da linha entra no mesmo texto) e ponto/vírgula escritos depois da conversão.
// Posições em pixels da largura da página.

// Procura, entre os textos já convertidos, o que está na mesma linha e termina logo antes do ponto dado.
export function findMate(texts: TextItem[], at: { left: number; top: number; bottom: number }, w: number): TextItem | null {
  const cy = (at.top + at.bottom) / 2;
  let best: TextItem | null = null;
  let bestGap = Infinity;
  for (const t of texts) {
    const px = Math.max(1, t.size * w);
    if (Math.abs(t.y * w - cy) > px * 0.6) continue; // outra linha
    const gap = at.left - (t.x * w + textWidth(t.text, px, t.font));
    if (gap < -px * 2 || gap > px * 4) continue; // longe demais do fim do texto
    if (Math.abs(gap) < bestGap) {
      bestGap = Math.abs(gap);
      best = t;
    }
  }
  return best;
}

// Acrescenta texto ao fim de um texto existente (com espaço, ou colado quando é pontuação). null se não couber na página.
// "strokes" são os traços que originaram o pedaço acrescentado: entram no manuscrito guardado do texto, para que
// "voltar ao manuscrito" traga a linha inteira e não só uma parte. Como a leitura mudou, as alternativas antigas saem.
export function joinText(mate: TextItem, add: string, glue: boolean, w: number, strokes: InkItem[] = []): TextItem | null {
  const text = mate.text + (glue ? "" : " ") + add;
  const px = Math.max(1, mate.size * w);
  if (mate.x * w + textWidth(text, px, mate.font) > w * 0.98) return null;
  const next: TextItem = { ...mate, text };
  delete next.alts;
  if (mate.src && strokes.length) next.src = { ...mate.src, items: [...mate.src.items, ...strokes] };
  return next;
}
