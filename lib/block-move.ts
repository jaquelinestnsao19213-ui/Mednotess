// Mover um bloco (a imagem) para qualquer ponto da página, em qualquer nível onde ele caiba.
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export type Slot = { at: number; from: number };

/**
 * Ponto de encaixe perto de `pos`: antes ou depois do bloco que contém o ponto, no nível mais fundo
 * em que o bloco `type` é aceito (dentro de um aviso, por exemplo, mas não no meio de um item de lista).
 * `from` é o início do bloco escolhido, para a tela desenhar a linha de destino.
 */
export function boundaryNear(doc: PMNode, pos: number, after: boolean, type: NodeType): Slot {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($p.depth === 0) return { at: $p.pos, from: $p.pos };
  for (let k = $p.depth; k >= 1; k--) {
    const parent = $p.node(k - 1);
    const index = $p.index(k - 1) + (after ? 1 : 0);
    if (parent.canReplaceWith(index, index, type)) return { at: after ? $p.after(k) : $p.before(k), from: $p.before(k) };
  }
  return { at: after ? $p.after(1) : $p.before(1), from: $p.before(1) };
}

/** Leva o bloco que começa em `from` para o ponto `to`. Devolve null se soltar no mesmo lugar ou se não couber. */
export function moveNodeTo(state: EditorState, from: number, to: number): Transaction | null {
  let node: PMNode | null = null;
  try {
    node = state.doc.nodeAt(from);
  } catch {
    return null; // posição fora da página
  }
  if (!node) return null;
  const end = from + node.nodeSize;
  if (to >= from && to <= end) return null;
  try {
    let tr = state.tr.delete(from, end);
    const at = tr.mapping.map(to);
    tr = tr.insert(at, node);
    return tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
  } catch {
    return null;
  }
}

export type Align = "left" | "center" | "right";

/** Alinhamento pelo lugar onde a imagem foi solta na largura da página (esquerda, meio ou direita). */
export function alignFromX(x: number, left: number, width: number): Align {
  const f = (x - left) / Math.max(1, width);
  return f < 1 / 3 ? "left" : f > 2 / 3 ? "right" : "center";
}
