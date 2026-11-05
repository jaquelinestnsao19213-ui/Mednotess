"use client";

import { useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

// Imagem com alça no canto para arrastar e mudar o tamanho (funciona com o dedo).
export default function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const img = useRef<HTMLImageElement>(null);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = img.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth;
    const maxW = el.parentElement?.parentElement?.offsetWidth ?? 800;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(maxW, Math.max(80, startW + (ev.clientX - startX))));
      updateAttributes({ width: w });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <NodeViewWrapper className="img-wrap" data-selected={selected ? "true" : "false"}>
      <div className="img-box" style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={node.attrs.src} alt={node.attrs.alt ?? ""} draggable={false} />
        <span className="img-handle" onPointerDown={startResize} aria-label="Redimensionar imagem" />
      </div>
    </NodeViewWrapper>
  );
}
