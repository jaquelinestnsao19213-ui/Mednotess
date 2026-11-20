"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { normalizeStrokes } from "../../lib/image-strokes";
import { alignFromX, boundaryNear, moveNodeTo, type Align, type Slot } from "../../lib/block-move";
import type { Item } from "../pdf/types";
import StrokeCanvas from "./StrokeCanvas";
import ImageLightbox from "./ImageLightbox";
import ImageDrawModal from "./ImageDrawModal";

// Imagem solta na lateral de outra: fica ao lado dela (esquerda ou direita).
type Beside = { tpos: number; tnode: PMNode; after: boolean };

// Largura de cada imagem numa linha com `count` imagens (2 = 50%, 3 = 33%, 4 = 25%...).
const spanFor = (count: number): number | null => (count >= 2 ? Math.max(20, Math.floor(100 / count)) : null);

// Imagens que estão na mesma linha da imagem em `tpos` (vizinhas, lado a lado, na mesma altura na tela).
// Sempre inclui a própria imagem; `skip` é uma imagem que está sendo tirada da linha.
function rowPositions(view: EditorView, tpos: number, skip: number | null, type: NodeType): number[] {
  const doc = view.state.doc;
  const $t = doc.resolve(tpos);
  const parent = $t.parent;
  const idx = $t.index();
  const positions: number[] = [];
  let pos = $t.start();
  for (let i = 0; i < parent.childCount; i++) {
    positions.push(pos);
    pos += parent.child(i).nodeSize;
  }
  const topOf = (p: number) => (view.nodeDOM(p) as HTMLElement | null)?.getBoundingClientRect().top ?? NaN;
  const top0 = topOf(tpos);
  const sameRow = (i: number) => {
    const c = parent.child(i);
    if (c.type !== type || !c.attrs.span) return false;
    const t = topOf(positions[i]);
    return Number.isFinite(t) && Number.isFinite(top0) && Math.abs(t - top0) <= 12;
  };
  const row: number[] = [tpos];
  for (let i = idx - 1; i >= 0; i--) {
    if (positions[i] === skip) continue;
    if (!sameRow(i)) break;
    row.unshift(positions[i]);
  }
  for (let i = idx + 1; i < parent.childCount; i++) {
    if (positions[i] === skip) continue;
    if (!sameRow(i)) break;
    row.push(positions[i]);
  }
  return row;
}

// Define a largura (lado a lado) das imagens nas posições dadas. span = null volta a imagem ao normal.
function setSpans(tr: Transaction, positions: number[], span: number | null, type: NodeType): Transaction {
  for (const p of positions) {
    const n = tr.doc.nodeAt(p);
    if (n && n.type === type) tr = tr.setNodeMarkup(p, undefined, { ...n.attrs, span, width: null, align: null });
  }
  return tr;
}

// Imagem do caderno. Ao tocar nela aparece a barra de ações (como no Canva):
// arrastar, subir/descer, lado a lado, separar, ampliar, desenhar e remover. A alça no canto muda o tamanho.
// Para colocar imagens lado a lado: toque em "▥ Lado a lado" (junta com a imagem de cima ou de baixo)
// ou arraste uma imagem e solte na esquerda ou na direita de outra.
export default function ImageView({ node, updateAttributes, selected, editor, getPos, deleteNode }: NodeViewProps) {
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<null | "zoom" | "draw">(null);
  const [below, setBelow] = useState(false);
  const [dragging, setDragging] = useState(false);
  const strokes = useMemo(() => normalizeStrokes(node.attrs.strokes), [node.attrs.strokes]);
  const span = (node.attrs.span as number | null) ?? null;

  // Passa a fração da linha para o bloco externo do editor, que é quem fica "lado a lado".
  useEffect(() => {
    const outer = box.current?.closest<HTMLElement>(".node-image");
    if (!outer) return;
    if (span) {
      outer.dataset.span = String(span);
      outer.style.setProperty("--span", String(span));
    } else {
      delete outer.dataset.span;
      outer.style.removeProperty("--span");
    }
  }, [span]);

  // Se a imagem estiver colada no topo da tela, a barra aparece embaixo dela.
  useEffect(() => {
    if (selected && box.current) setBelow(box.current.getBoundingClientRect().top < 60);
  }, [selected]);

  function where() {
    const pos = getPos();
    if (typeof pos !== "number") return null;
    const $pos = editor.state.doc.resolve(pos);
    return { pos, index: $pos.index(), count: $pos.parent.childCount };
  }
  const spot = selected ? where() : null;
  const canUp = !!spot && spot.index > 0;
  const canDown = !!spot && spot.index < spot.count - 1;

  // Imagem logo acima (ou, se não houver, logo abaixo) desta: é com ela que o botão "Lado a lado" junta.
  function imageNeighbour(): number | null {
    const at = where();
    if (!at) return null;
    const parent = editor.state.doc.resolve(at.pos).parent;
    const starts: number[] = [];
    let p = editor.state.doc.resolve(at.pos).start();
    for (let i = 0; i < parent.childCount; i++) {
      starts.push(p);
      p += parent.child(i).nodeSize;
    }
    const isImage = (i: number) => i >= 0 && i < parent.childCount && parent.child(i).type === node.type;
    if (isImage(at.index - 1)) return starts[at.index - 1];
    if (isImage(at.index + 1)) return starts[at.index + 1];
    return null;
  }
  const neighbour = selected && !span ? imageNeighbour() : null;

  // Junta esta imagem com a vizinha (e com as que já estão na linha dela) e divide a largura igualmente.
  function joinNeighbour() {
    const at = where();
    const target = imageNeighbour();
    if (!at || target === null) return;
    const view = editor.view;
    const row = rowPositions(view, target, at.pos, node.type);
    const all = [...row, at.pos].sort((a, b) => a - b);
    const tr = setSpans(view.state.tr, all, spanFor(all.length), node.type);
    view.dispatch(tr);
  }

  // Troca a imagem de lugar com o bloco vizinho (um clique = um passo).
  function move(dir: -1 | 1) {
    const at = where();
    if (!at) return;
    const { state, view } = editor;
    const parent = state.doc.resolve(at.pos).parent;
    const target = at.index + dir;
    if (target < 0 || target >= parent.childCount) return;
    const sibling = parent.child(target);
    const insertAt = dir === -1 ? at.pos - sibling.nodeSize : at.pos + sibling.nodeSize;
    let tr = state.tr.delete(at.pos, at.pos + node.nodeSize);
    tr = tr.insert(insertAt, node);
    tr = tr.setSelection(NodeSelection.create(tr.doc, insertAt));
    view.dispatch(tr.scrollIntoView());
  }

  // Encaixa esta imagem ao lado de outra (esquerda ou direita) e divide a linha igualmente entre todas.
  function placeBeside(t: Beside) {
    const from = getPos();
    if (typeof from !== "number") return;
    const view = editor.view;
    const state = view.state;
    const type = node.type;
    const row = rowPositions(view, t.tpos, from, type); // imagens que já estavam na linha do alvo
    const oldRow = span ? rowPositions(view, from, null, type).filter((p) => p !== from) : []; // linha de onde ela saiu
    let tr: Transaction;
    let insertAt: number;
    try {
      tr = state.tr.delete(from, from + node.nodeSize);
      const tposNew = tr.mapping.map(t.tpos);
      insertAt = t.after ? tposNew + t.tnode.nodeSize : tposNew;
      tr = tr.insert(insertAt, node);
    } catch {
      return;
    }
    const mapped = row.map((p) => tr.mapping.map(p));
    const rowSpan = spanFor(row.length + 1);
    const leftBehind = oldRow.filter((p) => !row.includes(p)).map((p) => tr.mapping.map(p));
    tr = setSpans(tr, [...mapped, insertAt], rowSpan, type);
    if (leftBehind.length > 0) tr = setSpans(tr, leftBehind, spanFor(leftBehind.length), type);
    tr = tr.setSelection(NodeSelection.create(tr.doc, insertAt)).scrollIntoView();
    view.dispatch(tr);
  }

  // Tira a imagem da linha lado a lado: ela vai para baixo da linha, com largura normal.
  function separate() {
    const at = where();
    if (!at) return;
    const view = editor.view;
    const state = view.state;
    const type = node.type;
    const row = rowPositions(view, at.pos, null, type);
    const others = row.filter((p) => p !== at.pos);
    const last = row[row.length - 1];
    const lastNode = state.doc.nodeAt(last);
    const moved = last !== at.pos && lastNode ? moveNodeTo(state, at.pos, last + lastNode.nodeSize) : null;
    let tr: Transaction = moved ?? state.tr;
    const own = moved ? moved.selection.from : at.pos;
    const mappedOthers = others.map((p) => tr.mapping.map(p));
    tr = setSpans(tr, [own], null, type);
    tr = setSpans(tr, mappedOthers, spanFor(mappedOthers.length), type);
    view.dispatch(tr);
  }

  // Clicar na imagem e arrastar: ela vai para qualquer ponto da página (entre parágrafos, dentro de avisos…).
  // Se for solta em cima de outra imagem, fica ao lado dela (esquerda ou direita, onde aparecer a linha azul).
  // Se for estreita, fica à esquerda, no centro ou à direita conforme o lado onde for solta.
  function startDrag(e: React.PointerEvent<HTMLImageElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType !== "mouse" && !selected) return; // no toque, o 1º toque só seleciona (e a página continua rolando)
    const el = img.current;
    if (!el) return;
    const view = editor.view;
    const start = { x: e.clientX, y: e.clientY };
    let px = start.x;
    let py = start.y;
    let began = false;
    let slot: Slot | null = null;
    let side: Beside | null = null;
    let ghost: HTMLImageElement | null = null;
    let line: HTMLElement | null = null;
    let scroller = 0;

    const locate = () => {
      slot = null;
      side = null;
      if (line) {
        line.style.display = "none";
        line.style.height = "";
      }
      const hit = view.posAtCoords({ left: px, top: py });
      const from = getPos();
      if (!hit || typeof from !== "number") return;

      // 1) Em cima de outra imagem (parte do meio): encaixa ao lado dela, na metade esquerda ou direita.
      if (hit.inside >= 0 && hit.inside !== from) {
        const tnode = view.state.doc.nodeAt(hit.inside);
        const trect = (view.nodeDOM(hit.inside) as HTMLElement | null)?.getBoundingClientRect();
        if (tnode && tnode.type === node.type && trect) {
          const fy = (py - trect.top) / Math.max(1, trect.height);
          if (fy > 0.2 && fy < 0.8) {
            const after = px > trect.left + trect.width / 2;
            side = { tpos: hit.inside, tnode, after };
            if (line) {
              line.style.display = "block";
              line.style.width = "4px";
              line.style.height = `${trect.height}px`;
              line.style.left = `${(after ? trect.right : trect.left) - 2}px`;
              line.style.top = `${trect.top}px`;
            }
            return;
          }
        }
      }

      // 2) Em qualquer outro lugar: encaixa entre os blocos da página.
      const before = boundaryNear(view.state.doc, hit.pos, false, node.type);
      const rect = (view.nodeDOM(before.from) as HTMLElement | null)?.getBoundingClientRect();
      const after = !!rect && py > rect.top + rect.height / 2;
      const target = after ? boundaryNear(view.state.doc, hit.pos, true, node.type) : before;
      if (!rect || !moveNodeTo(view.state, from, target.at)) return;
      slot = target;
      if (line) {
        line.style.display = "block";
        line.style.left = `${rect.left}px`;
        line.style.width = `${rect.width}px`;
        line.style.top = `${(after ? rect.bottom : rect.top) - 2}px`;
      }
    };
    const begin = () => {
      began = true;
      setDragging(true);
      ghost = document.createElement("img");
      ghost.src = el.src;
      ghost.className = "img-ghost";
      ghost.style.width = `${Math.min(el.offsetWidth, 200)}px`;
      line = document.createElement("div");
      line.className = "img-dropline";
      document.body.append(ghost, line);
      document.body.style.userSelect = "none";
      scroller = window.setInterval(() => {
        if (py < 80) window.scrollBy(0, -14);
        else if (py > window.innerHeight - 80) window.scrollBy(0, 14);
      }, 30);
    };
    const place = () => {
      if (!ghost) return;
      ghost.style.left = `${px - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${py - ghost.offsetHeight / 2}px`;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.clearInterval(scroller);
      ghost?.remove();
      line?.remove();
      document.body.style.userSelect = "";
      setDragging(false);
    };
    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      if (!began) {
        if (Math.hypot(px - start.x, py - start.y) < 8) return;
        begin();
      }
      place();
      locate();
    };
    const up = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      const wasDragging = began;
      if (wasDragging) locate();
      const target = slot;
      const beside = side as Beside | null;
      cleanup();
      if (!wasDragging) return;
      if (beside) {
        placeBeside(beside);
        return;
      }
      const from = getPos();
      const tr = target && typeof from === "number" ? moveNodeTo(view.state, from, target.at) : null;
      const col = view.dom.getBoundingClientRect();
      const wide = el.offsetWidth > col.width * 0.85;
      const moved = Math.abs(px - start.x) > 40; // só muda o lado se a pessoa realmente puxou para o lado
      const align: Align | null = !wide && moved && !span ? alignFromX(px, col.left, col.width) : null;
      if (tr) {
        let out: Transaction = tr;
        if (span && typeof from === "number") {
          // Saiu de uma linha lado a lado: volta a ser imagem normal e as que ficaram dividem a linha.
          const oldRow = rowPositions(view, from, null, node.type).filter((p) => p !== from);
          const own = out.selection.from;
          const mapped = oldRow.map((p) => out.mapping.map(p));
          out = setSpans(out, [own], null, node.type);
          out = setSpans(out, mapped, spanFor(mapped.length), node.type);
        } else if (align) {
          out.setNodeMarkup(out.selection.from, undefined, { ...node.attrs, align });
        }
        view.dispatch(out);
      } else if (align && align !== (node.attrs.align ?? "left")) updateAttributes({ align });
    };
    const cancel = () => cleanup();
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cleanup();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  }

  function cycleAlign() {
    const order: Align[] = ["left", "center", "right"];
    const now = (node.attrs.align as Align | null) ?? "left";
    updateAttributes({ align: order[(order.indexOf(now) + 1) % order.length] });
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = img.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth;
    const col = editor.view.dom.clientWidth || 800;
    const maxW = el.parentElement?.parentElement?.offsetWidth ?? 800;
    const moveFn = (ev: PointerEvent) => {
      if (span) {
        // Em "lado a lado" o tamanho é uma fração da linha (de 5 em 5%).
        const pct = Math.round(((startW + (ev.clientX - startX) + 9) / col) * 20) * 5;
        if (pct >= 95) updateAttributes({ span: null, width: null });
        else updateAttributes({ span: Math.max(15, pct), width: null });
        return;
      }
      const w = Math.round(Math.min(maxW, Math.max(80, startW + (ev.clientX - startX))));
      updateAttributes({ width: w });
    };
    const up = () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", up);
  }

  const src = node.attrs.src as string;

  return (
    <NodeViewWrapper
      className={dragging ? "img-wrap dragging" : "img-wrap"}
      data-selected={selected ? "true" : "false"}
      data-span={span ?? undefined}
      style={{ textAlign: span ? undefined : ((node.attrs.align as Align | null) ?? undefined) }}
    >
      <div ref={box} className="img-box" style={{ width: !span && node.attrs.width ? `${node.attrs.width}px` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={src} alt={node.attrs.alt ?? ""} draggable={false} onPointerDown={startDrag} onDoubleClick={() => setModal("zoom")} />
        {strokes.length > 0 && <StrokeCanvas items={strokes} />}
        <span className="img-handle" onPointerDown={startResize} aria-label="Redimensionar imagem" />
        {selected && (
          <div className={below ? "img-toolbar below" : "img-toolbar"} role="toolbar" aria-label="Ações da imagem">
            <span className="img-grip" data-drag-handle draggable="true" title="Arrastar para outro lugar" aria-label="Arrastar imagem">⠿</span>
            <button type="button" aria-label="Mover para cima" disabled={!canUp} onClick={() => move(-1)}>↑</button>
            <button type="button" aria-label="Mover para baixo" disabled={!canDown} onClick={() => move(1)}>↓</button>
            {span ? (
              <button type="button" aria-label="Separar da linha de imagens" title="Separar das imagens ao lado" className="on" onClick={separate}>⊟ Separar</button>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Colocar lado a lado com a imagem de cima ou de baixo"
                  title={neighbour === null ? "Coloque outra imagem logo acima ou abaixo desta (use ↑ e ↓)" : "Lado a lado com a imagem vizinha"}
                  disabled={neighbour === null}
                  onClick={joinNeighbour}
                >
                  ▥ Lado a lado
                </button>
                <button type="button" aria-label="Alinhar imagem (esquerda, centro, direita)" onClick={cycleAlign}>{node.attrs.align === "center" ? "↔" : node.attrs.align === "right" ? "⇥" : "⇤"}</button>
              </>
            )}
            <button type="button" aria-label="Ampliar imagem" onClick={() => setModal("zoom")}>⤢</button>
            <button type="button" aria-label="Desenhar na imagem" className={strokes.length ? "on" : ""} onClick={() => setModal("draw")}>✎</button>
            <button type="button" aria-label="Remover imagem" className="danger" onClick={() => deleteNode()}>🗑</button>
          </div>
        )}
      </div>
      {modal === "zoom" && <ImageLightbox src={src} alt={node.attrs.alt ?? ""} strokes={strokes} onClose={() => setModal(null)} />}
      {modal === "draw" && (
        <ImageDrawModal
          src={src}
          initial={strokes}
          onClose={() => setModal(null)}
          onSave={(items: Item[]) => {
            updateAttributes({ strokes: items.length ? items : null });
            setModal(null);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
