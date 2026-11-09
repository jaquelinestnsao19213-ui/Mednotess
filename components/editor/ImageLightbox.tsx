"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Item } from "../pdf/types";
import StrokeCanvas from "./StrokeCanvas";

type T = { s: number; x: number; y: number };
const MIN = 1;
const MAX = 8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

// Imagem em tela cheia: pinça com dois dedos, arrastar com um dedo, toque duplo e botões +/−.
export default function ImageLightbox({ src, alt, strokes, onClose }: { src: string; alt?: string; strokes: Item[]; onClose: () => void }) {
  const [t, setT] = useState<T>({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const zoomTo = (s: number) => setT((p) => (clamp(s) === 1 ? { s: 1, x: 0, y: 0 } : { ...p, s: clamp(s) }));
  const dist = () => {
    const [a, b] = Array.from(pointers.current.values());
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { d: dist(), s: tRef.current.s };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, tx: tRef.current.x, ty: tRef.current.y };
    }
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      zoomTo(pinch.current.s * (dist() / pinch.current.d));
    } else if (pointers.current.size === 1 && drag.current && tRef.current.s > 1) {
      const d = drag.current;
      setT((p) => ({ ...p, x: d.tx + (e.clientX - d.x), y: d.ty + (e.clientY - d.y) }));
    }
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    const rest = Array.from(pointers.current.values())[0];
    drag.current = rest ? { x: rest.x, y: rest.y, tx: tRef.current.x, ty: tRef.current.y } : null;
  }

  return createPortal(
    <div className="imgmod imgmod-zoom" role="dialog" aria-modal="true" aria-label="Imagem ampliada">
      <div
        className="imgmod-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => zoomTo(tRef.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onDoubleClick={() => zoomTo(tRef.current.s > 1 ? 1 : 2.5)}
      >
        <div className="imgmod-board" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt ?? ""} draggable={false} className="imgmod-img" />
          {strokes.length > 0 && <StrokeCanvas items={strokes} extra={2} />}
        </div>
      </div>
      <button type="button" className="imgmod-close" aria-label="Fechar imagem" onClick={onClose}>✕</button>
      <div className="imgmod-zoombar">
        <button type="button" aria-label="Diminuir zoom" onClick={() => zoomTo(t.s / 1.5)}>−</button>
        <button type="button" aria-label="Tamanho original" onClick={() => zoomTo(1)}>{Math.round(t.s * 100)}%</button>
        <button type="button" aria-label="Aumentar zoom" onClick={() => zoomTo(t.s * 1.5)}>+</button>
      </div>
    </div>,
    document.body
  );
}
