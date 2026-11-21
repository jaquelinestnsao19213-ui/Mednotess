"use client";

import { useEffect, useRef } from "react";
import type { Item } from "../pdf/types";
import { drawItems } from "../pdf/draw";

// Camada com os desenhos, por cima da imagem. Ocupa exatamente o tamanho do elemento pai
// (que deve ter position: relative) e se redesenha quando a imagem muda de tamanho.
export default function StrokeCanvas({ items, extra = 1 }: { items: Item[]; extra?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const mark = markRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !mark || !parent) return;
    const paint = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (!w || !h) return;
      const ratio = Math.min(3, (window.devicePixelRatio || 1) * extra);
      for (const [c, layer] of [[canvas, "rest"], [mark, "marker"]] as const) {
        c.width = Math.round(w * ratio);
        c.height = Math.round(h * ratio);
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawItems(ctx, items, w, h, layer);
      }
    };
    paint();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : null;
    ro?.observe(parent);
    return () => ro?.disconnect();
  }, [items, extra]);

  // O marca-texto fica numa camada própria que se mistura com a imagem (multiply): o texto da imagem continua escuro por cima da cor.
  return (
    <>
      <canvas ref={markRef} className="img-strokes mark" aria-hidden="true" />
      <canvas ref={ref} className="img-strokes" aria-hidden="true" />
    </>
  );
}
