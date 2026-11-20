"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INK_COLORS, MARK_COLORS, MARK_WIDTHS, PEN_WIDTHS, uid, type InkItem, type Item } from "../pdf/types";
import { drawItem, hitItem } from "../pdf/draw";
import { smoothItem, smoothItemCached } from "./ink-smooth";
import { boundsOf, idOf, moveItem, pickedByLasso } from "./ink-geometry";
import { recognizeInk } from "./ink-recognize";
import { tidyItems } from "./ink-tidy";

// Camada de escrita sobre a página inteira. Fica separada do texto (o conteúdo não muda) e é guardada
// junto com a página na chave "inkLayer". Posições: x e y divididos pela LARGURA da página; y conta a partir do topo.
export type InkLayer = { items: Item[]; smooth: number };

export function readInkLayer(value: unknown): InkLayer {
  const v = value as { items?: unknown; smooth?: unknown } | null | undefined;
  const items = v && Array.isArray(v.items) ? (v.items as Item[]) : [];
  const smooth = v && typeof v.smooth === "number" ? Math.max(0, Math.min(1, v.smooth)) : 0.35;
  return { items, smooth };
}

type Tool = "pen" | "highlighter" | "eraser" | "lasso";

// Fontes para o texto convertido (as mesmas do seletor de fonte do editor).
const CONV_FONTS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Sem serifa", v: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { name: "Com serifa", v: 'Georgia, "Times New Roman", serif' },
  { name: "Mono", v: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { name: "Manuscrita", v: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive' },
];

export default function InkOverlay({
  layer,
  onChange,
  active,
  onClose,
}: {
  layer: InkLayer;
  onChange: (next: InkLayer) => void;
  active: boolean;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>("pen");
  const [colorIdx, setColorIdx] = useState(0); // -1 = cor personalizada
  const [custom, setCustom] = useState("#7c3aed");
  const [sizeIdx, setSizeIdx] = useState(1);
  const [writing, setWriting] = useState(true);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [smooth, setSmooth] = useState(layer.smooth);
  const [enhance, setEnhance] = useState(false);
  const [tidyAmt, setTidyAmt] = useState(0.6);
  const [, setTick] = useState(0);

  // Converter escrita em texto digitado
  const [convOpen, setConvOpen] = useState(false);
  const [convFont, setConvFont] = useState(0);
  const [convBusy, setConvBusy] = useState(false);
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convText, setConvText] = useState<string | null>(null);
  const [convIds, setConvIds] = useState<string[]>([]);
  const [convPos, setConvPos] = useState<{ left: number; top: number } | null>(null);
  const [convErase, setConvErase] = useState(true);

  const itemsRef = useRef<Item[]>(layer.items);
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

  const show = active || layer.items.length > 0;

  useEffect(() => {
    itemsRef.current = layer.items;
  }, [layer.items]);
  useEffect(() => {
    setSmooth(layer.smooth);
  }, [layer.smooth]);

  // Acompanha o tamanho da página (cresce quando o texto cresce).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [show]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h } = size;
    if (!canvas || !w || !h) return;
    // Páginas muito compridas usam menos pixels por ponto para não estourar a memória do navegador.
    let dpr = Math.min(3, window.devicePixelRatio || 1);
    dpr = Math.max(0.5, Math.min(dpr, Math.sqrt(16000000 / (w * h)), 16000 / h));
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const it of itemsRef.current) drawItem(ctx, smoothItemCached(it, smooth), w, w);
    if (draftRef.current) drawItem(ctx, smoothItem(draftRef.current, smooth), w, w);

    const lasso = lassoRef.current;
    if (lasso && lasso.length >= 4) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lasso[0] * w, lasso[1] * w);
      for (let i = 2; i + 1 < lasso.length; i += 2) ctx.lineTo(lasso[i] * w, lasso[i + 1] * w);
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
      const x = box[0] * w - pad;
      const y = box[1] * w - pad;
      ctx.fillRect(x, y, (box[2] - box[0]) * w + pad * 2, (box[3] - box[1]) * w + pad * 2);
      ctx.strokeRect(x, y, (box[2] - box[0]) * w + pad * 2, (box[3] - box[1]) * w + pad * 2);
      ctx.restore();
    }
  }, [size, smooth]);

  useEffect(() => {
    paint();
  }, [paint, layer.items]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paint();
    });
  };

  const setSelection = (ids: string[]) => {
    selRef.current = new Set(ids);
    setSelIds(ids);
    schedule();
  };

  // Ao abrir ou fechar a camada, volta ao estado inicial.
  useEffect(() => {
    if (active) {
      setWriting(true);
      penSeenRef.current = false;
    } else {
      selRef.current = new Set();
      setSelIds([]);
      lassoRef.current = null;
      draftRef.current = null;
      setConvOpen(false);
      setConvText(null);
      setConvErr(null);
    }
  }, [active]);

  const commit = (next: Item[], base: Item[]) => {
    undoRef.current.push(base);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    itemsRef.current = next;
    onChange({ items: next, smooth: smoothRef.current });
    setTick((t) => t + 1);
  };

  const toPoint = (clientX: number, clientY: number): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const y = Math.max(0, (clientY - r.top) / r.width);
    return [x, y];
  };

  const eraseAt = (x: number, y: number) => {
    const w = size.w;
    const rest = itemsRef.current.filter((it) => !hitItem(it, x, y, w, w, 10));
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
    if (!active || !writing || !size.w) return;
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
        if (Math.hypot(x - lx, y - ly) * size.w >= 0.6) p.push(x, y);
      }
    }
    // Escrevendo perto da borda da tela: a página rola junto.
    if (draftRef.current) {
      if (e.clientY > window.innerHeight - 150) window.scrollBy(0, 14);
      else if (e.clientY < 50) window.scrollBy(0, -14);
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
    if (d) commit([...itemsRef.current, d], itemsRef.current);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(itemsRef.current);
    itemsRef.current = prev;
    onChange({ items: prev, smooth: smoothRef.current });
    setSelection([]);
    setTick((t) => t + 1);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(itemsRef.current);
    itemsRef.current = next;
    onChange({ items: next, smooth: smoothRef.current });
    setSelection([]);
    setTick((t) => t + 1);
  };

  const clearAll = () => {
    if (!itemsRef.current.length) return;
    if (!window.confirm("Apagar toda a escrita sobre esta página? O texto não será afetado.")) return;
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

  const commitSmooth = () => {
    if (Math.abs(smoothRef.current - layer.smooth) > 0.001) onChange({ items: itemsRef.current, smooth: smoothRef.current });
  };

  const pickTool = (t: Tool) => {
    setTool(t);
    if (t !== "lasso") setSelection([]);
  };

  // Modo "Organizada": alinha linhas, uniformiza tamanho e espaçamento das palavras (da seleção ou da página toda).
  // Fica no histórico: o ↶ volta à escrita como estava.
  const organize = () => {
    if (!size.w) return;
    const base = itemsRef.current;
    const picked = selRef.current;
    const target = picked.size ? base.filter((it) => picked.has(idOf(it))) : base;
    const tidied = tidyItems(target, size.w, tidyAmt);
    const byId = new Map(tidied.map((it) => [idOf(it), it] as const));
    commit(base.map((it) => byId.get(idOf(it)) ?? it), base);
  };

  // Reconhece a escrita (da seleção com o laço, ou da página toda) e mostra o texto para conferir antes de inserir.
  const convert = async () => {
    if (convBusy) return;
    const src = selRef.current.size ? itemsRef.current.filter((it) => selRef.current.has(idOf(it))) : itemsRef.current;
    setConvBusy(true);
    setConvErr(null);
    try {
      const { lines, failed } = await recognizeInk(src, size.w);
      if (!lines.length) {
        setConvErr("Não encontrei escrita de caneta para converter (marca-texto e círculos são ignorados).");
        return;
      }
      setConvText(lines.map((l) => l.text).join("\n"));
      setConvIds(lines.flatMap((l) => l.ids));
      const rect = canvasRef.current?.getBoundingClientRect();
      setConvPos(rect ? { left: rect.left + lines[0].left, top: rect.top + lines[0].top } : null);
      if (failed) setConvErr(`${failed} ${failed === 1 ? "linha não foi reconhecida e ficou de fora" : "linhas não foram reconhecidas e ficaram de fora"}.`);
    } catch (e) {
      setConvErr(e instanceof Error ? e.message : "Não consegui reconhecer a escrita agora.");
    } finally {
      setConvBusy(false);
    }
  };

  const insertConverted = () => {
    const lines = (convText ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    window.dispatchEvent(
      new CustomEvent("mednotes-ink-text", {
        detail: { lines, fontFamily: CONV_FONTS[convFont].v, left: convPos?.left, top: convPos?.top },
      })
    );
    if (convErase && convIds.length) {
      const ids = new Set(convIds);
      const base = itemsRef.current;
      commit(base.filter((it) => !ids.has(idOf(it))), base);
      setSelection([]);
    }
    setConvText(null);
    setConvErr(null);
    setConvOpen(false);
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
  const drawing = tool === "pen" || tool === "highlighter";
  const row: React.CSSProperties = { display: "flex", gap: 6, alignItems: "center", overflowX: "auto", padding: "2px 0" };
  const hasPen = itemsRef.current.some((it) => it.kind === "ink" && it.tool === "pen");

  if (!show) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Escrita sobre a página"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 5,
          pointerEvents: active && writing ? "auto" : "none",
          touchAction: active && writing ? "none" : "auto",
          cursor: active && writing ? "crosshair" : "default",
        }}
      />
      {active && (
        <div
          role="toolbar"
          aria-label="Escrita sobre a página"
          style={{
            position: "fixed",
            left: 8,
            right: 8,
            bottom: "calc(var(--kb, 0px) + 8px + env(safe-area-inset-bottom, 0px))",
            zIndex: 60,
            display: "grid",
            gap: 4,
            padding: 8,
            borderRadius: 12,
            border: "1px solid var(--line, #d5dbe3)",
            background: "var(--card, #fff)",
            boxShadow: "0 6px 24px rgba(0,0,0,.18)",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {convOpen && (
            <div role="group" aria-label="Converter escrita em texto" style={{ display: "grid", gap: 6 }}>
              {convText === null ? (
                <>
                  <div style={row}>
                    {CONV_FONTS.map((f, i) => (
                      <button
                        type="button"
                        key={f.name}
                        aria-label={`Fonte ${f.name}`}
                        style={{ ...btn(convFont === i), fontSize: 14, fontFamily: f.v ?? undefined }}
                        onClick={() => setConvFont(i)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  <div style={row}>
                    <button type="button" style={{ ...btn(true, convBusy), fontWeight: 700 }} disabled={convBusy} onClick={convert}>
                      {convBusy
                        ? "Reconhecendo…"
                        : selIds.length
                          ? `Converter os ${selIds.length} traços selecionados`
                          : "Converter toda a escrita da página"}
                    </button>
                  </div>
                  {convErr && <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{convErr}</p>}
                  <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                    Para converter só um trecho, use o ⬚ Laço e selecione. Só a caneta é reconhecida.
                  </p>
                </>
              ) : (
                <>
                  <textarea
                    value={convText}
                    aria-label="Texto reconhecido: confira e corrija antes de inserir"
                    onChange={(e) => setConvText(e.target.value)}
                    rows={4}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      minHeight: 72,
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--line, #d5dbe3)",
                      fontSize: 16,
                      fontFamily: CONV_FONTS[convFont].v ?? undefined,
                      userSelect: "text",
                      WebkitUserSelect: "text",
                    }}
                  />
                  {convErr && <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{convErr}</p>}
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                    <input type="checkbox" checked={convErase} onChange={(e) => setConvErase(e.target.checked)} />
                    Apagar a escrita à mão convertida (dá para desfazer com ↶)
                  </label>
                  <div style={row}>
                    <button type="button" style={{ ...btn(true), fontWeight: 700 }} onClick={insertConverted}>Inserir no texto</button>
                    <button
                      type="button"
                      style={btn()}
                      onClick={() => {
                        setConvText(null);
                        setConvErr(null);
                      }}
                    >
                      Voltar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {enhance && (
            <div role="group" aria-label="Aperfeiçar escrita" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <b style={{ fontSize: 13, minWidth: 64 }}>Suavizar</b>
                <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Natural</span>
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
                <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Suave</span>
                <b style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{Math.round(smooth * 100)}%</b>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <b style={{ fontSize: 13, minWidth: 64 }}>Organizar</b>
                <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Leve</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={Math.round(tidyAmt * 100)}
                  aria-label="Intensidade da organização da escrita"
                  onChange={(e) => setTidyAmt(Number(e.target.value) / 100)}
                  style={{ flex: 1, minWidth: 80 }}
                />
                <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Forte</span>
                <b style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{Math.round(tidyAmt * 100)}%</b>
              </div>
              <div style={row}>
                <button type="button" style={{ ...btn(true, !hasPen), fontWeight: 700 }} disabled={!hasPen} onClick={organize}>
                  {selIds.length ? "Organizar a seleção" : "Organizar a escrita da página"}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                Alinha as linhas, deixa as palavras do mesmo tamanho e com o mesmo espaço, mantendo o seu traço. Não gostou? Toque em ↶.
              </p>
            </div>
          )}
          {tool === "lasso" && selIds.length > 0 && (
            <div role="toolbar" aria-label="Ações da seleção" style={row}>
              <button type="button" style={btn()} onClick={deleteSelection}>Excluir seleção</button>
              <button type="button" style={btn()} onClick={duplicateSelection}>Duplicar</button>
              <button type="button" style={btn()} onClick={recolorSelection}>Pintar com a cor atual</button>
              <button type="button" style={btn()} onClick={() => setSelection([])}>Soltar</button>
            </div>
          )}
          <div style={row}>
            <button
              type="button"
              aria-label={writing ? "Parar de escrever e rolar a página" : "Voltar a escrever"}
              style={btn(writing)}
              onClick={() => {
                penSeenRef.current = false;
                setWriting((v) => !v);
              }}
            >
              {writing ? "✍ Escrevendo" : "✋ Rolando"}
            </button>
            <button type="button" aria-label="Caneta" style={btn(tool === "pen")} onClick={() => pickTool("pen")}>✎</button>
            <button type="button" aria-label="Marca-texto" style={btn(tool === "highlighter")} onClick={() => pickTool("highlighter")}>▮</button>
            <button type="button" aria-label="Borracha" style={btn(tool === "eraser")} onClick={() => pickTool("eraser")}>⌫</button>
            <button type="button" aria-label="Laço: selecionar, mover e apagar traços" style={btn(tool === "lasso")} onClick={() => pickTool("lasso")}>⬚ Laço</button>
            <button type="button" aria-label="Aperfeiçoar escrita" style={btn(enhance)} onClick={() => setEnhance((v) => !v)}>✨</button>
            <button
              type="button"
              aria-label="Converter escrita em texto digitado"
              style={btn(convOpen)}
              onClick={() => {
                setConvOpen((v) => !v);
                setConvText(null);
                setConvErr(null);
              }}
            >
              Aa
            </button>
            <button type="button" aria-label="Desfazer" disabled={!undoRef.current.length} style={btn(false, !undoRef.current.length)} onClick={undo}>↶</button>
            <button type="button" aria-label="Refazer" disabled={!redoRef.current.length} style={btn(false, !redoRef.current.length)} onClick={redo}>↷</button>
            <button type="button" aria-label="Apagar toda a escrita sobre a página" style={btn()} onClick={clearAll}>Limpar</button>
            <button type="button" aria-label="Concluir e voltar a editar o texto" style={{ ...btn(), fontWeight: 700 }} onClick={onClose}>Concluir</button>
          </div>
          {drawing && (
            <div style={row}>
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
            </div>
          )}
        </div>
      )}
    </>
  );
}
