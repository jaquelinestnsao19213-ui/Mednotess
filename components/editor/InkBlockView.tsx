"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { INK_COLORS, MARK_COLORS, MARK_WIDTHS, PEN_WIDTHS, uid, type InkItem, type Item } from "../pdf/types";
import { drawItem, hitItem } from "../pdf/draw";
import { smoothItem, smoothItemCached } from "./ink-smooth";
import { snapStroke } from "./ink-shapes";

type InkTool = "pen" | "highlighter" | "eraser" | "lasso";
type Paper = "dots" | "grid" | "ruled" | "blank";
type Box = [number, number, number, number];

const PAPERS: Paper[] = ["dots", "grid", "ruled", "blank"];
const PAPER_LABEL: Record<Paper, string> = { dots: "Pontilhado", grid: "Quadriculado", ruled: "Pautado", blank: "Liso" };
const LINE = "rgba(100,116,139,.3)";

function paperStyle(p: Paper): React.CSSProperties {
  switch (p) {
    case "ruled":
      return { backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 31px, ${LINE} 31px, ${LINE} 32px)` };
    case "grid":
      return { backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`, backgroundSize: "24px 24px" };
    case "dots":
      return { backgroundImage: "radial-gradient(circle, rgba(100,116,139,.3) 1px, transparent 1.3px)", backgroundSize: "24px 24px" };
    default:
      return {};
  }
}

const idOf = (it: Item) => (it as Item & { id?: string }).id ?? "";

function moveItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === "ink") {
    const pts = it.pts.slice();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      pts[i] += dx;
      pts[i + 1] += dy;
    }
    return { ...it, pts };
  }
  return { ...it, cx: it.cx + dx, cy: it.cy + dy };
}

function itemBox(it: Item): Box {
  if (it.kind === "ink") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 1 < it.pts.length; i += 2) {
      x0 = Math.min(x0, it.pts[i]);
      x1 = Math.max(x1, it.pts[i]);
      y0 = Math.min(y0, it.pts[i + 1]);
      y1 = Math.max(y1, it.pts[i + 1]);
    }
    const pad = it.width / 2;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  return [it.cx - it.rx, it.cy - it.ry, it.cx + it.rx, it.cy + it.ry];
}

function boundsOf(items: Item[], ids: Set<string>): Box | null {
  let box: Box | null = null;
  for (const it of items) {
    if (!ids.has(idOf(it))) continue;
    const b = itemBox(it);
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  return box;
}

// Ponto dentro do laço desenhado (poly = x,y,x,y,...)
function inPoly(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pickedByLasso(it: Item, poly: number[]): boolean {
  if (it.kind !== "ink") return inPoly(it.cx, it.cy, poly);
  const n = it.pts.length / 2;
  if (!n) return false;
  const step = Math.max(1, Math.floor(n / 24));
  let tested = 0;
  let inside = 0;
  for (let k = 0; k < n; k += step) {
    tested++;
    if (inPoly(it.pts[2 * k], it.pts[2 * k + 1], poly)) inside++;
  }
  return inside / tested >= 0.5;
}

// Todas as coordenadas são divididas pela LARGURA do bloco (x e y), então aumentar a altura
// do bloco não deforma o que já foi escrito.
export default function InkBlockView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const items: Item[] = Array.isArray(node.attrs.items) ? (node.attrs.items as Item[]) : [];
  const ratio: number = Number(node.attrs.ratio) || 0.6;
  const paper: Paper = PAPERS.includes(node.attrs.paper as Paper) ? (node.attrs.paper as Paper) : "dots";
  const smoothAttr = typeof node.attrs.smooth === "number" ? Math.max(0, Math.min(1, node.attrs.smooth)) : 0.35;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState<InkTool>("pen");
  const [colorIdx, setColorIdx] = useState(0); // -1 = cor personalizada
  const [custom, setCustom] = useState("#7c3aed");
  const [sizeIdx, setSizeIdx] = useState(1);
  const [active, setActive] = useState(items.length === 0);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [smooth, setSmooth] = useState(smoothAttr);
  const [enhance, setEnhance] = useState(false);
  const [, setTick] = useState(0);

  const itemsRef = useRef<Item[]>(items);
  const ratioRef = useRef(ratio);
  const smoothRef = useRef(smooth);
  smoothRef.current = smooth;
  const draftRef = useRef<InkItem | null>(null);
  const lassoRef = useRef<number[] | null>(null);
  const selRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ sx: number; sy: number; base: Item[] } | null>(null);
  const undoRef = useRef<Item[][]>([]);
  const redoRef = useRef<Item[][]>([]);
  const pointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const eraseBaseRef = useRef<Item[] | null>(null);
  const penSeenRef = useRef(false);
  const rafRef = useRef(0);
  const holdTimerRef = useRef(0);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const snapRef = useRef<Item | null>(null); // forma reconhecida enquanto a caneta está parada
  const widthRef = useRef(0);
  widthRef.current = width;

  // Mudanças vindas de fora (desfazer do editor, outra aba) atualizam o desenho.
  const attrItems = node.attrs.items;
  useEffect(() => {
    itemsRef.current = Array.isArray(attrItems) ? (attrItems as Item[]) : [];
  }, [attrItems]);
  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);
  useEffect(() => {
    setSmooth(smoothAttr);
  }, [smoothAttr]);

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
    // A suavização só muda como o traço é desenhado; os pontos originais continuam guardados.
    for (const it of itemsRef.current) drawItem(ctx, smoothItemCached(it, smooth), width, width);
    if (snapRef.current) drawItem(ctx, snapRef.current, width, width);
    else if (draftRef.current) drawItem(ctx, smoothItem(draftRef.current, smooth), width, width);

    const lasso = lassoRef.current;
    if (lasso && lasso.length >= 4) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lasso[0] * width, lasso[1] * width);
      for (let i = 2; i + 1 < lasso.length; i += 2) ctx.lineTo(lasso[i] * width, lasso[i + 1] * width);
      ctx.stroke();
      ctx.restore();
    }
    const box = boundsOf(itemsRef.current, selRef.current);
    if (box) {
      const pad = 6;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#2563eb";
      ctx.fillStyle = "rgba(37,99,235,.07)";
      ctx.lineWidth = 1.5;
      const x = box[0] * width - pad;
      const y = box[1] * width - pad;
      const w = (box[2] - box[0]) * width + pad * 2;
      const hh = (box[3] - box[1]) * width + pad * 2;
      ctx.fillRect(x, y, w, hh);
      ctx.strokeRect(x, y, w, hh);
      ctx.restore();
    }
  }, [width, ratio, smooth]);

  useEffect(() => {
    paint();
  }, [paint, attrItems]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(holdTimerRef.current);
    },
    []
  );

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paint();
    });
  };

  const clearHold = () => {
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = 0;
    holdAnchorRef.current = null;
  };

  // Caneta parada no fim do traço: se parece uma forma, mostra a versão reta; ao levantar, ela é guardada.
  const armHold = () => {
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = 0;
      const d = draftRef.current;
      if (!d || d.tool !== "pen" || !widthRef.current) return;
      const item = snapStroke(d, widthRef.current);
      if (!item) return;
      snapRef.current = item;
      schedule();
      try {
        navigator.vibrate?.(8);
      } catch {
        // sem vibração neste aparelho
      }
    }, 450);
  };

  const setSelection = (ids: string[]) => {
    selRef.current = new Set(ids);
    setSelIds(ids);
    schedule();
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
    const y = Math.max(0, Math.min(ratioRef.current, (clientY - r.top) / r.width));
    return [x, y];
  };

  const eraseAt = (x: number, y: number) => {
    const rest = itemsRef.current.filter((it) => !hitItem(it, x, y, width, width, 10));
    if (rest.length !== itemsRef.current.length) {
      itemsRef.current = rest;
      schedule();
    }
  };

  const colorFor = (marker: boolean): string => {
    if (colorIdx === -1) return custom;
    const list = marker ? MARK_COLORS : INK_COLORS;
    return list[colorIdx] ?? list[0];
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

    if (tool === "lasso") {
      const box = boundsOf(itemsRef.current, selRef.current);
      const slack = 0.015;
      if (box && x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack) {
        dragRef.current = { sx: x, sy: y, base: itemsRef.current };
        return;
      }
      setSelection([]);
      lassoRef.current = [x, y];
      schedule();
      return;
    }
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
      color: colorFor(marker),
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
      if (dragRef.current) {
        const { sx, sy, base } = dragRef.current;
        const dx = x - sx;
        const dy = y - sy;
        itemsRef.current = base.map((it) => (selRef.current.has(idOf(it)) ? moveItem(it, dx, dy) : it));
      } else if (lassoRef.current) {
        lassoRef.current.push(x, y);
      } else if (erasingRef.current) {
        eraseAt(x, y);
      } else if (draftRef.current) {
        const p = draftRef.current.pts;
        const lx = p[p.length - 2];
        const ly = p[p.length - 1];
        if (Math.hypot(x - lx, y - ly) * width >= 0.6) p.push(x, y);
        if (draftRef.current.tool === "pen") {
          const an = holdAnchorRef.current;
          if (!an || Math.hypot(x - an.x, y - an.y) * width > (snapRef.current ? 6 : 4)) {
            snapRef.current = null; // voltou a mexer: o traço continua livre
            holdAnchorRef.current = { x, y };
            armHold();
          }
        }
        // Chegou perto do fim da folha: o bloco cresce sozinho.
        if (y > ratioRef.current - 0.08 && ratioRef.current < 8) {
          ratioRef.current = +(ratioRef.current + 0.4).toFixed(2);
          updateAttributes({ ratio: ratioRef.current });
        }
      }
    }
    schedule();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerRef.current) return;
    pointerRef.current = null;

    if (dragRef.current) {
      const { base } = dragRef.current;
      dragRef.current = null;
      if (base !== itemsRef.current) commit(itemsRef.current, base);
      return;
    }
    if (lassoRef.current) {
      const poly = lassoRef.current;
      lassoRef.current = null;
      const ids = poly.length >= 6 ? itemsRef.current.filter((it) => pickedByLasso(it, poly)).map(idOf) : [];
      setSelection(ids);
      return;
    }
    if (erasingRef.current) {
      erasingRef.current = false;
      const base = eraseBaseRef.current;
      eraseBaseRef.current = null;
      if (base && base !== itemsRef.current) commit(itemsRef.current, base);
      return;
    }
    const d = draftRef.current;
    draftRef.current = null;
    const snapped = snapRef.current;
    snapRef.current = null;
    clearHold();
    if (d) commit([...itemsRef.current, snapped ?? d], itemsRef.current);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(itemsRef.current);
    itemsRef.current = prev;
    updateAttributes({ items: prev });
    setSelection([]);
    setTick((t) => t + 1);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(itemsRef.current);
    itemsRef.current = next;
    updateAttributes({ items: next });
    setSelection([]);
    setTick((t) => t + 1);
  };

  const clearAll = () => {
    if (!itemsRef.current.length) return;
    if (!window.confirm("Apagar tudo o que foi escrito neste bloco?")) return;
    setSelection([]);
    commit([], itemsRef.current);
  };

  const deleteSelection = () => {
    const base = itemsRef.current;
    commit(base.filter((it) => !selRef.current.has(idOf(it))), base);
    setSelection([]);
  };

  const duplicateSelection = () => {
    const base = itemsRef.current;
    const copies = base.filter((it) => selRef.current.has(idOf(it))).map((it) => ({ ...moveItem(it, 0.03, 0.03), id: uid() }) as Item);
    if (!copies.length) return;
    commit([...base, ...copies], base);
    setSelection(copies.map(idOf));
  };

  const recolorSelection = () => {
    const base = itemsRef.current;
    commit(
      base.map((it) => (selRef.current.has(idOf(it)) ? { ...it, color: colorFor(it.kind === "ink" && it.tool === "highlighter") } : it)),
      base
    );
  };

  const moreSpace = () => {
    ratioRef.current = Math.min(8, +(ratioRef.current + 0.4).toFixed(2));
    updateAttributes({ ratio: ratioRef.current });
  };

  const nextPaper = () => updateAttributes({ paper: PAPERS[(PAPERS.indexOf(paper) + 1) % PAPERS.length] });

  // Guarda a intensidade escolhida no documento (os traços originais não são alterados).
  const commitSmooth = () => {
    if (Math.abs(smoothRef.current - smoothAttr) > 0.001) updateAttributes({ smooth: smoothRef.current });
  };

  const pickTool = (t: InkTool) => {
    setTool(t);
    if (t !== "lasso") setSelection([]);
  };

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
  const drawing = tool === "pen" || tool === "highlighter";

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
          <button type="button" aria-label="Caneta" style={btn(tool === "pen")} onClick={() => pickTool("pen")}>✎</button>
          <button type="button" aria-label="Marca-texto" style={btn(tool === "highlighter")} onClick={() => pickTool("highlighter")}>▮</button>
          <button type="button" aria-label="Borracha" style={btn(tool === "eraser")} onClick={() => pickTool("eraser")}>⌫</button>
          <button type="button" aria-label="Laço: selecionar, mover e apagar traços" style={btn(tool === "lasso")} onClick={() => pickTool("lasso")}>⬚ Laço</button>
          <button type="button" aria-label="Aperfeiçoar escrita" style={btn(enhance)} onClick={() => setEnhance((v) => !v)}>✨ Aperfeiçoar</button>
          {drawing && (
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
              <label
                aria-label="Escolher outra cor"
                style={{
                  flex: "0 0 auto",
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  overflow: "hidden",
                  position: "relative",
                  background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                  border: colorIdx === -1 ? "3px solid var(--ink, #1b2430)" : "2px solid #fff",
                  boxShadow: "0 0 0 1px var(--line, #d5dbe3)",
                }}
              >
                <input
                  type="color"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setColorIdx(-1);
                  }}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                />
              </label>
              {[4, 8, 13].map((d, i) => (
                <button type="button" key={d} aria-label={`Espessura ${i + 1}`} style={{ ...btn(sizeIdx === i), display: "grid", placeItems: "center" }} onClick={() => setSizeIdx(i)}>
                  <span style={{ width: d, height: d, borderRadius: "50%", background: sizeIdx === i ? "#fff" : "currentColor", display: "block" }} />
                </button>
              ))}
            </>
          )}
          <button type="button" aria-label="Desfazer" disabled={!undoRef.current.length} style={btn(false, !undoRef.current.length)} onClick={undo}>↶</button>
          <button type="button" aria-label="Refazer" disabled={!redoRef.current.length} style={btn(false, !redoRef.current.length)} onClick={redo}>↷</button>
          <button type="button" aria-label={`Tipo de papel: ${PAPER_LABEL[paper]}. Toque para trocar`} style={btn()} onClick={nextPaper}>
            Papel: {PAPER_LABEL[paper]}
          </button>
          <button type="button" aria-label="Aumentar a altura do bloco" style={btn()} onClick={moreSpace}>+ Espaço</button>
          <button type="button" aria-label="Apagar tudo do bloco" style={btn()} onClick={clearAll}>Limpar</button>
          <button type="button" aria-label="Remover bloco de escrita" style={btn()} onClick={() => deleteNode()}>🗑</button>
        </div>
      )}
      {showBar && enhance && (
        <div role="group" aria-label="Aperfeiçar escrita" style={{ display: "flex", gap: 10, alignItems: "center", paddingBottom: 8 }}>
          <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Mais natural</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(smooth * 100)}
            aria-label="Intensidade da suavização dos traços"
            onChange={(e) => setSmooth(Number(e.target.value) / 100)}
            onPointerUp={commitSmooth}
            onTouchEnd={commitSmooth}
            onKeyUp={commitSmooth}
            onBlur={commitSmooth}
            style={{ flex: 1, minWidth: 80 }}
          />
          <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Mais suave</span>
          <b style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{Math.round(smooth * 100)}%</b>
        </div>
      )}
      {showBar && tool === "lasso" && selIds.length > 0 && (
        <div role="toolbar" aria-label="Ações da seleção" style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 8 }}>
          <button type="button" style={btn()} onClick={deleteSelection}>Excluir seleção</button>
          <button type="button" style={btn()} onClick={duplicateSelection}>Duplicar</button>
          <button type="button" style={btn()} onClick={recolorSelection}>Pintar com a cor atual</button>
          <button type="button" style={btn()} onClick={() => setSelection([])}>Soltar</button>
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
          overflow: "hidden",
          ...paperStyle(paper),
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
