"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { INK_COLORS, MARK_COLORS, MARK_WIDTHS, PEN_WIDTHS, uid, type InkItem, type Item } from "../pdf/types";
import { drawItem, hitItem } from "../pdf/draw";

type InkTool = "pen" | "highlighter" | "eraser";

// Todas as coordenadas são divididas pela LARGURA do bloco (x e y), então aumentar a altura
// do bloco não deforma o que já foi escrito.
export default function InkBlockView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const items: Item[] = Array.isArray(node.attrs.items) ? (node.attrs.items as Item[]) : [];
  const ratio: number = Number(node.attrs.ratio) || 0.6;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState<InkTool>("pen");
  const [colorIdx, setColorIdx] = useState(0);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [active, setActive] = useState(items.length === 0);
  const [, setTick] = useState(0);

  const itemsRef = useRef<Item[]>(items);
  const draftRef = useRef<InkItem | null>(null);
  const undoRef = useRef<Item[][]>([]);
  const redoRef = useRef<Item[][]>([]);
  const pointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const eraseBaseRef = useRef<Item[] | null>(null);
  const penSeenRef = useRef(false);
  const rafRef = useRef(0);

  // Mudanças vindas de fora (desfazer do editor, outra aba) atualizam o desenho.
  const attrItems = node.attrs.items;
  useEffect(() => {
    itemsRef.current = Array.isArray(attrItems) ? (attrItems as Item[]) : [];
  }, [attrItems]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const h = Math.round(width * ratio);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = Math.round(width * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    for (const it of itemsRef.current) drawItem(ctx, it, width, width);
    if (draftRef.current) drawItem(ctx, draftRef.current, width, width);
  }, [width, ratio]);

  useEffect(() => {
    paint();
  }, [paint, attrItems]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paint();
    });
  };

  const commit = (next: Item[], base: Item[]) => {
    undoRef.current.push(base);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    itemsRef.current = next;
    updateAttributes({ items: next });
    setTick((t) => t + 1);
  };

  const toPoint = (clientX: number, clientY: number): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(ratio, (clientY - r.top) / r.width));
    return [x, y];
  };

  const eraseAt = (x: number, y: number) => {
    const rest = itemsRef.current.filter((it) => !hitItem(it, x, y, width, width, 10));
    if (rest.length !== itemsRef.current.length) {
      itemsRef.current = rest;
      schedule();
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !width) return;
    if (e.pointerType === "pen") penSeenRef.current = true;
    // Com a S Pen em uso, a palma da mão (toque) é ignorada.
    if (penSeenRef.current && e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerRef.current = e.pointerId;
    const [x, y] = toPoint(e.clientX, e.clientY);
    if (tool === "eraser") {
      erasingRef.current = true;
      eraseBaseRef.current = itemsRef.current;
      eraseAt(x, y);
      return;
    }
    const marker = tool === "highlighter";
    draftRef.current = {
      id: uid(),
      kind: "ink",
      tool: marker ? "highlighter" : "pen",
      color: marker ? MARK_COLORS[colorIdx] : INK_COLORS[colorIdx],
      width: marker ? MARK_WIDTHS[sizeIdx] : PEN_WIDTHS[sizeIdx],
      pts: [x, y],
    };
    schedule();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerRef.current) return;
    e.preventDefault();
    const ne = e.nativeEvent;
    const list = typeof ne.getCoalescedEvents === "function" ? ne.getCoalescedEvents() : [];
    const evs = list.length ? list : [ne];
    for (const ev of evs) {
      const [x, y] = toPoint(ev.clientX, ev.clientY);
      if (erasingRef.current) eraseAt(x, y);
      else if (draftRef.current) {
        const p = draftRef.current.pts;
        const lx = p[p.length - 2];
        const ly = p[p.length - 1];
        if (Math.hypot(x - lx, y - ly) * width >= 0.6) p.push(x, y);
      }
    }
    schedule();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    if (erasingRef.current) {
      erasingRef.current = false;
      const base = eraseBaseRef.current;
      eraseBaseRef.current = null;
      if (base && base !== itemsRef.current) commit(itemsRef.current, base);
      return;
    }
    const d = draftRef.current;
    draftRef.current = null;
    if (d) commit([...itemsRef.current, d], itemsRef.current);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(itemsRef.current);
    itemsRef.current = prev;
    updateAttributes({ items: prev });
    setTick((t) => t + 1);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(itemsRef.current);
    itemsRef.current = next;
    updateAttributes({ items: next });
    setTick((t) => t + 1);
  };

  const clearAll = () => {
    if (!itemsRef.current.length) return;
    if (!window.confirm("Apagar tudo o que foi escrito neste bloco?")) return;
    commit([], itemsRef.current);
  };

  const moreSpace = () => updateAttributes({ ratio: Math.min(8, +(ratio + 0.4).toFixed(2)) });

  const toggleActive = () => {
    penSeenRef.current = false;
    setActive((a) => !a);
  };

  const btn = (on = false, disabled = false): React.CSSProperties => ({
    flex: "0 0 auto",
    minWidth: 38,
    height: 38,
    padding: "0 8px",
    borderRadius: 8,
    border: "1px solid var(--line, #d5dbe3)",
    background: on ? "var(--ink, #1b2430)" : "transparent",
    color: on ? "#fff" : "inherit",
    fontSize: 16,
    opacity: disabled ? 0.35 : 1,
  });

  const palette = tool === "highlighter" ? MARK_COLORS : INK_COLORS;
  const showBar = active || selected;

  return (
    <NodeViewWrapper contentEditable={false} style={{ margin: "12px 0", userSelect: "none", WebkitUserSelect: "none" }}>
      {showBar && (
        <div
          role="toolbar"
          aria-label="Ferramentas de escrita à mão"
          style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 8 }}
        >
          <button type="button" aria-label={active ? "Parar de escrever e rolar a página" : "Escrever à mão"} style={btn(active)} onClick={toggleActive}>
            {active ? "✍ Escrevendo" : "✍ Escrever"}
          </button>
          <button type="button" aria-label="Caneta" style={btn(tool === "pen")} onClick={() => setTool("pen")}>✎</button>
          <button type="button" aria-label="Marca-texto" style={btn(tool === "highlighter")} onClick={() => setTool("highlighter")}>▮</button>
          <button type="button" aria-label="Borracha" style={btn(tool === "eraser")} onClick={() => setTool("eraser")}>⌫</button>
          {tool !== "eraser" && (
            <>
              {palette.map((c, i) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`Cor ${i + 1}`}
                  onClick={() => setColorIdx(i)}
                  style={{
                    flex: "0 0 auto",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    border: colorIdx === i ? "3px solid var(--ink, #1b2430)" : "2px solid #fff",
                    boxShadow: "0 0 0 1px var(--line, #d5dbe3)",
                  }}
                />
              ))}
              {[4, 8, 13].map((d, i) => (
                <button type="button" key={d} aria-label={`Espessura ${i + 1}`} style={{ ...btn(sizeIdx === i), display: "grid", placeItems: "center" }} onClick={() => setSizeIdx(i)}>
                  <span style={{ width: d, height: d, borderRadius: "50%", background: sizeIdx === i ? "#fff" : "currentColor", display: "block" }} />
                </button>
              ))}
            </>
          )}
          <button type="button" aria-label="Desfazer" disabled={!undoRef.current.length} style={btn(false, !undoRef.current.length)} onClick={undo}>↶</button>
          <button type="button" aria-label="Refazer" disabled={!redoRef.current.length} style={btn(false, !redoRef.current.length)} onClick={redo}>↷</button>
          <button type="button" aria-label="Aumentar a altura do bloco" style={btn()} onClick={moreSpace}>+ Espaço</button>
          <button type="button" aria-label="Apagar tudo do bloco" style={btn()} onClick={clearAll}>Limpar</button>
          <button type="button" aria-label="Remover bloco de escrita" style={btn()} onClick={() => deleteNode()}>🗑</button>
        </div>
      )}
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `1 / ${ratio}`,
          borderRadius: 10,
          border: active ? "2px solid var(--ink, #1b2430)" : "1px solid var(--line, #d5dbe3)",
          backgroundColor: "var(--card, #fff)",
          backgroundImage: "radial-gradient(circle, rgba(100,116,139,.3) 1px, transparent 1.3px)",
          backgroundSize: "24px 24px",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Área de escrita à mão"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            touchAction: active ? "none" : "auto",
            cursor: active ? "crosshair" : "default",
          }}
        />
      </div>
    </NodeViewWrapper>
  );
}
