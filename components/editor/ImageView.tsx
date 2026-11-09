"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { normalizeStrokes } from "../../lib/image-strokes";
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
    <NodeViewWrapper className="img-wrap" data-selected={selected ? "true" : "false"}>
      <div ref={box} className="img-box" style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={src} alt={node.attrs.alt ?? ""} draggable={false} onDoubleClick={() => setModal("zoom")} />
        {strokes.length > 0 && <StrokeCanvas items={strokes} />}
        <span className="img-handle" onPointerDown={startResize} aria-label="Redimensionar imagem" />
        {selected && (
          <div className={below ? "img-toolbar below" : "img-toolbar"} role="toolbar" aria-label="Ações da imagem">
            <span className="img-grip" data-drag-handle draggable="true" title="Arrastar para outro lugar" aria-label="Arrastar imagem">⠿</span>
            <button type="button" aria-label="Mover para cima" disabled={!canUp} onClick={() => move(-1)}>↑</button>
            <button type="button" aria-label="Mover para baixo" disabled={!canDown} onClick={() => move(1)}>↓</button>
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
