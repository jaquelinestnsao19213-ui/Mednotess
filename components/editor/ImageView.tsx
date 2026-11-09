"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { normalizeStrokes } from "../../lib/image-strokes";
import { alignFromX, boundaryNear, moveNodeTo, type Align, type Slot } from "../../lib/block-move";
import type { Item } from "../pdf/types";
import StrokeCanvas from "./StrokeCanvas";
import ImageLightbox from "./ImageLightbox";
import ImageDrawModal from "./ImageDrawModal";

// Imagem do caderno. Ao tocar nela aparece a barra de ações (como no Canva):
// arrastar, subir/descer, ampliar, desenhar e remover. A alça no canto muda o tamanho.
export default function ImageView({ node, updateAttributes, selected, editor, getPos, deleteNode }: NodeViewProps) {
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<null | "zoom" | "draw">(null);
  const [below, setBelow] = useState(false);
  const [dragging, setDragging] = useState(false);
  const strokes = useMemo(() => normalizeStrokes(node.attrs.strokes), [node.attrs.strokes]);

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

  // Clicar na imagem e arrastar: ela vai para qualquer ponto da página (entre parágrafos, dentro de avisos…)
  // e, se for estreita, fica à esquerda, no centro ou à direita conforme o lado onde for solta.
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
    let ghost: HTMLImageElement | null = null;
    let line: HTMLElement | null = null;
    let scroller = 0;

    const locate = () => {
      slot = null;
      if (line) line.style.display = "none";
      const hit = view.posAtCoords({ left: px, top: py });
      const from = getPos();
      if (!hit || typeof from !== "number") return;
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
      cleanup();
      if (!wasDragging) return;
      const from = getPos();
      const tr = target && typeof from === "number" ? moveNodeTo(view.state, from, target.at) : null;
      const col = view.dom.getBoundingClientRect();
      const wide = el.offsetWidth > col.width * 0.85;
      const moved = Math.abs(px - start.x) > 40; // só muda o lado se a pessoa realmente puxou para o lado
      const align: Align | null = !wide && moved ? alignFromX(px, col.left, col.width) : null;
      if (tr) {
        if (align) tr.setNodeMarkup(tr.selection.from, undefined, { ...node.attrs, align });
        view.dispatch(tr);
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
    const maxW = el.parentElement?.parentElement?.offsetWidth ?? 800;
    const moveFn = (ev: PointerEvent) => {
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
    <NodeViewWrapper className={dragging ? "img-wrap dragging" : "img-wrap"} data-selected={selected ? "true" : "false"} style={{ textAlign: (node.attrs.align as Align | null) ?? undefined }}>
      <div ref={box} className="img-box" style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={src} alt={node.attrs.alt ?? ""} draggable={false} onPointerDown={startDrag} onDoubleClick={() => setModal("zoom")} />
        {strokes.length > 0 && <StrokeCanvas items={strokes} />}
        <span className="img-handle" onPointerDown={startResize} aria-label="Redimensionar imagem" />
        {selected && (
          <div className={below ? "img-toolbar below" : "img-toolbar"} role="toolbar" aria-label="Ações da imagem">
            <span className="img-grip" data-drag-handle draggable="true" title="Arrastar para outro lugar" aria-label="Arrastar imagem">⠿</span>
            <button type="button" aria-label="Mover para cima" disabled={!canUp} onClick={() => move(-1)}>↑</button>
            <button type="button" aria-label="Mover para baixo" disabled={!canDown} onClick={() => move(1)}>↓</button>
            <button type="button" aria-label="Alinhar imagem (esquerda, centro, direita)" onClick={cycleAlign}>{node.attrs.align === "center" ? "↔" : node.attrs.align === "right" ? "⇥" : "⇤"}</button>
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
