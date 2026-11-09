"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { drawItems, hitItem } from "../pdf/draw";
import { uid, type Item } from "../pdf/types";

type DrawTool = "pen" | "highlighter" | "circle" | "eraser";

const TOOLS: { id: DrawTool; label: string; glyph: string }[] = [
  { id: "pen", label: "Caneta", glyph: "✎" },
  { id: "highlighter", label: "Marca-texto", glyph: "▮" },
  { id: "circle", label: "Círculo", glyph: "◯" },
  { id: "eraser", label: "Borracha", glyph: "⌫" },
];
const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#facc15", "#1b2430", "#ffffff"];
// Espessuras como fração da largura da imagem (fina, média, grossa).
const PEN_W = [0.003, 0.006, 0.011];
const MARK_W = [0.018, 0.03, 0.045];

type Draft =
  | { kind: "ink"; item: Extract<Item, { kind: "ink" }> }
  | { kind: "ellipse"; item: Extract<Item, { kind: "ellipse" }>; sx: number; sy: number }
  | { kind: "erase"; base: Item[] };

// Janela para desenhar sobre a imagem (dedo, caneta ou mouse). Só grava quando toca em "Salvar".
export default function ImageDrawModal({ src, initial, onSave, onClose }: { src: string; initial: Item[]; onSave: (items: Item[]) => void; onClose: () => void }) {
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [wIdx, setWIdx] = useState(1);
  const [items, setItems] = useState<Item[]>(initial);
  const [past, setPast] = useState<Item[][]>([]);
  const [future, setFuture] = useState<Item[][]>([]);
  const itemsRef = useRef(items);
  const draft = useRef<Draft | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLDivElement>(null);

  const paint = useCallback(() => {
    const c = canvas.current;
    const b = board.current;
    if (!c || !b) return;
    const w = b.clientWidth;
    const h = b.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * ratio) || c.height !== Math.round(h * ratio)) {
      c.width = Math.round(w * ratio);
      c.height = Math.round(h * ratio);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const d = draft.current;
    drawItems(ctx, d && d.kind !== "erase" ? [...itemsRef.current, d.item] : itemsRef.current, w, h);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
    paint();
  }, [items, paint]);

  useEffect(() => {
    const b = board.current;
    if (!b || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(paint);
    ro.observe(b);
    return () => ro.disconnect();
  }, [paint]);

  const cancel = useCallback(() => {
    if (itemsRef.current !== initial && !window.confirm("Descartar o que você desenhou?")) return;
    onClose();
  }, [initial, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [cancel]);

  function commit(next: Item[], base: Item[] = itemsRef.current) {
    setPast((p) => [...p.slice(-49), base]);
    setFuture([]);
    itemsRef.current = next;
    setItems(next);
  }
  function undo() {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture((f) => [itemsRef.current, ...f]);
    itemsRef.current = prev;
    setItems(prev);
  }
  function redo() {
    const [next, ...rest] = future;
    if (!next) return;
    setFuture(rest);
    setPast((p) => [...p, itemsRef.current]);
    itemsRef.current = next;
    setItems(next);
  }

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      w: r.width,
      h: r.height,
    };
  };

  function erase(x: number, y: number, w: number, h: number) {
    const keep = itemsRef.current.filter((it) => !hitItem(it, x, y, w, h, 14));
    if (keep.length !== itemsRef.current.length) {
      itemsRef.current = keep;
      setItems(keep);
    }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, w, h } = point(e);
    if (tool === "pen" || tool === "highlighter") {
      const width = (tool === "pen" ? PEN_W : MARK_W)[wIdx];
      draft.current = { kind: "ink", item: { id: uid(), kind: "ink", tool, color, width, pts: [x, y] } };
    } else if (tool === "circle") {
      draft.current = { kind: "ellipse", sx: x, sy: y, item: { id: uid(), kind: "ellipse", color, width: PEN_W[wIdx], cx: x, cy: y, rx: 0, ry: 0 } };
    } else {
      draft.current = { kind: "erase", base: itemsRef.current };
      erase(x, y, w, h);
    }
    paint();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = draft.current;
    if (!d || !e.isPrimary) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" && native.getCoalescedEvents().length ? native.getCoalescedEvents() : [native];
    for (const ev of events) {
      const { x, y, w, h } = point(ev);
      if (d.kind === "ink") d.item.pts.push(x, y);
      else if (d.kind === "ellipse") {
        d.item.cx = (d.sx + x) / 2;
        d.item.cy = (d.sy + y) / 2;
        d.item.rx = Math.abs(x - d.sx) / 2;
        d.item.ry = Math.abs(y - d.sy) / 2;
      } else erase(x, y, w, h);
    }
    paint();
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = draft.current;
    if (!d || !e.isPrimary) return;
    draft.current = null;
    if (d.kind === "ink") commit([...itemsRef.current, d.item]);
    else if (d.kind === "ellipse") {
      const { w } = point(e);
      if (d.item.rx * w > 3) commit([...itemsRef.current, d.item]);
    } else if (itemsRef.current !== d.base) {
      setPast((p) => [...p.slice(-49), d.base]);
      setFuture([]);
    }
    paint();
  }

  const widths = tool === "highlighter" ? MARK_W : PEN_W;
  const hasChanges = items !== initial;

  return createPortal(
    <div className="imgmod imgmod-draw" role="dialog" aria-modal="true" aria-label="Desenhar na imagem">
      <div className="imgmod-bar">
        <button type="button" onClick={cancel}>Cancelar</button>
        <span className="imgmod-spacer" />
        <button type="button" aria-label="Desfazer" disabled={!past.length} onClick={undo}>↶</button>
        <button type="button" aria-label="Refazer" disabled={!future.length} onClick={redo}>↷</button>
        <button
          type="button"
          disabled={!items.length}
          onClick={() => {
            if (window.confirm("Apagar todo o desenho desta imagem?")) commit([]);
          }}
        >
          Limpar
        </button>
        <button type="button" className="imgmod-save" onClick={() => onSave(itemsRef.current)} disabled={!hasChanges}>Salvar</button>
      </div>
      <div className="imgmod-stage">
        <div className="imgmod-board" ref={board}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" draggable={false} className="imgmod-img" onLoad={paint} />
          <canvas
            ref={canvas}
            className="imgmod-canvas"
            data-tool={tool}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            aria-label="Área de desenho"
          />
        </div>
      </div>
      <div className="imgmod-tools">
        <div className="imgmod-row">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={tool === t.id ? "on" : ""} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              <span aria-hidden="true">{t.glyph}</span> {t.label}
            </button>
          ))}
        </div>
        <div className="imgmod-row">
          {COLORS.map((c) => (
            <button key={c} type="button" className={color === c ? "swatch on" : "swatch"} aria-label={`Cor ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <span className="imgmod-spacer" />
          {widths.map((w, i) => (
            <button key={w} type="button" className={wIdx === i ? "wid on" : "wid"} aria-label={`Espessura ${i + 1}`} aria-pressed={wIdx === i} onClick={() => setWIdx(i)}>
              <span style={{ height: 2 + i * 3 }} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
