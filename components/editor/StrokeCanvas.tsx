"use client";

import { useEffect, useRef } from "react";
import type { Item } from "../pdf/types";
import { drawItems } from "../pdf/draw";

// Camada com os desenhos, por cima da imagem. Ocupa exatamente o tamanho do elemento pai
// (que deve ter position: relative) e se redesenha quando a imagem muda de tamanho.
export default function StrokeCanvas({ items, extra = 1 }: { items: Item[]; extra?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const paint = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (!w || !h) return;
      const ratio = Math.min(3, (window.devicePixelRatio || 1) * extra);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawItems(ctx, items, w, h);
    };
    paint();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : null;
    ro?.observe(parent);
    return () => ro?.disconnect();
  }, [items, extra]);

  return <canvas ref={ref} className="img-strokes" aria-hidden="true" />;
}
