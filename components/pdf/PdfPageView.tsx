"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { drawItem, drawItems, hitItem } from "./draw";
import {
  opAddItem,
  opRemoveItems,
  uid,
  type EllipseItem,
  type InkItem,
  type Item,
  type Op,
  type PageAnn,
  type Tool,
} from "./types";

export type PageProps = {
  doc: PDFDocumentProxy;
  n: number;
  width: number; // largura em pixels da tela
  ratio: number; // altura / largura da página original
  active: boolean; // só páginas perto da tela são desenhadas
  ann: PageAnn;
  tool: Tool;
  color: string;
  size: number; // espessura (fração da largura)
  fingerDraw: boolean;
  editable: boolean;
  openNoteId: string | null;
  registerEl: (n: number, el: HTMLDivElement | null) => void;
  onRatio: (n: number, ratio: number) => void;
  onApply: (n: number, next: PageAnn) => void;
  onRecord: (op: Op) => void;
  onOpenNote: (id: string | null) => void;
  onNoteText: (n: number, id: string, text: string) => void;
  onNoteDelete: (n: number, id: string) => void;
  claim: (pointerId: number) => boolean;
  isPinching: () => boolean;
};

type Session =
  | { kind: "ink"; pid: number; tool: "pen" | "highlighter"; color: string; width: number; pts: number[] }
  | { kind: "ellipse"; pid: number; color: string; width: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "erase"; pid: number; cur: PageAnn; removed: Item[] };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function PdfPageView(p: PageProps) {
  const { doc, n, width, ratio, active } = p;
  const height = width * ratio;

  const wrap = useRef<HTMLDivElement>(null);
  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<Session | null>(null);
  const annRef = useRef(p.ann);
  annRef.current = p.ann;
  const propsRef = useRef(p);
  propsRef.current = p;

  // A página só é redesenhada em alta resolução depois que o zoom "assenta".
  const [renderW, setRenderW] = useState(width);
  useEffect(() => {
    const t = setTimeout(() => setRenderW(width), 160);
    return () => clearTimeout(t);
  }, [width]);

  // 1) Desenha o PDF (somente leitura: o arquivo original nunca é alterado).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        propsRef.current.onRatio(n, base.height / base.width);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = (renderW / base.width) * dpr;
        const px = base.width * scale * base.height * scale;
        if (px > 16_000_000) scale *= Math.sqrt(16_000_000 / px);
        const vp = page.getViewport({ scale });
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.floor(vp.width));
        off.height = Math.max(1, Math.floor(vp.height));
        const octx = off.getContext("2d");
        if (!octx) return;
        task = page.render({ canvasContext: octx, viewport: vp });
        await task.promise;
        if (cancelled) return;
        const main = pdfCanvas.current;
        if (!main) return;
        main.width = off.width;
        main.height = off.height;
        main.getContext("2d")?.drawImage(off, 0, 0);
      } catch {
        /* renderização cancelada ao mudar o zoom: normal */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [active, doc, n, renderW]);

  // 2) Desenha as anotações salvas (camada separada, por cima do PDF).
  useEffect(() => {
    if (!active) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(width * dpr));
    const H = Math.max(1, Math.round(height * dpr));
    const base = baseCanvas.current;
    const live = liveCanvas.current;
    if (!base || !live) return;
    if (base.width !== W || base.height !== H) {
      base.width = W;
      base.height = H;
    }
    if (live.width !== W || live.height !== H) {
      live.width = W;
      live.height = H;
    }
    const ctx = base.getContext("2d");
    if (ctx) drawItems(ctx, p.ann.items, W, H);
  }, [active, width, height, p.ann.items]);

  function paintLive() {
    const live = liveCanvas.current;
    if (!live) return;
    const ctx = live.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    const s = session.current;
    if (!s || s.kind === "erase") return;
    if (s.kind === "ink") {
      const it: InkItem = { id: "live", kind: "ink", tool: s.tool, color: s.color, width: s.width, pts: s.pts };
      drawItem(ctx, it, live.width, live.height);
    } else {
      const it: EllipseItem = {
        id: "live",
        kind: "ellipse",
        color: s.color,
        width: s.width,
        cx: (s.x0 + s.x1) / 2,
        cy: (s.y0 + s.y1) / 2,
        rx: Math.abs(s.x1 - s.x0) / 2,
        ry: Math.abs(s.y1 - s.y0) / 2,
      };
      drawItem(ctx, it, live.width, live.height);
    }
  }

  function toPage(clientX: number, clientY: number): [number, number] {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return [0, 0];
    return [clamp01((clientX - r.left) / r.width), clamp01((clientY - r.top) / r.height)];
  }

  function move(s: Session, clientX: number, clientY: number) {
    const [x, y] = toPage(clientX, clientY);
    if (s.kind === "ink") {
      const len = s.pts.length;
      const lx = s.pts[len - 2];
      const ly = s.pts[len - 1];
      if (Math.hypot((x - lx) * width, (y - ly) * height) >= 0.8) s.pts.push(r4(x), r4(y));
    } else if (s.kind === "ellipse") {
      s.x1 = x;
      s.y1 = y;
    } else {
      const W = width;
      const H = height;
      const hit = s.cur.items.filter((it) => hitItem(it, x, y, W, H, 10));
      if (hit.length > 0) {
        const ids = new Set(hit.map((h) => h.id));
        s.removed.push(...hit);
        s.cur = { ...s.cur, items: s.cur.items.filter((it) => !ids.has(it.id)) };
        p.onApply(n, s.cur);
      }
    }
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!p.editable || p.tool === "hand" || p.tool === "note") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch" && !p.fingerDraw) return;
    if (!p.claim(e.pointerId)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toPage(e.clientX, e.clientY);
    let s: Session;
    if (p.tool === "pen" || p.tool === "highlighter") {
      s = { kind: "ink", pid: e.pointerId, tool: p.tool, color: p.color, width: p.size, pts: [r4(x), r4(y)] };
    } else if (p.tool === "circle") {
      s = { kind: "ellipse", pid: e.pointerId, color: p.color, width: p.size, x0: x, y0: y, x1: x, y1: y };
    } else {
      s = { kind: "erase", pid: e.pointerId, cur: annRef.current, removed: [] };
      move(s, e.clientX, e.clientY);
    }
    session.current = s;
    paintLive();
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = session.current;
    if (!s || s.pid !== e.pointerId) return;
    if (p.isPinching()) {
      session.current = null;
      paintLive();
      return;
    }
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const list = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    for (const ev of list) move(s, ev.clientX, ev.clientY);
    paintLive();
  }

  function finish(e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) {
    const s = session.current;
    if (!s || s.pid !== e.pointerId) return;
    session.current = null;
    const before = annRef.current;
    if (s.kind === "erase") {
      if (s.removed.length > 0) p.onRecord(opRemoveItems(n, s.removed));
    } else if (!cancelled) {
      let item: Item | null = null;
      if (s.kind === "ink") {
        item = { id: uid(), kind: "ink", tool: s.tool, color: s.color, width: s.width, pts: s.pts };
      } else {
        const rx = Math.abs(s.x1 - s.x0) / 2;
        const ry = Math.abs(s.y1 - s.y0) / 2;
        if (rx * width >= 4 || ry * height >= 4) {
          item = {
            id: uid(),
            kind: "ellipse",
            color: s.color,
            width: s.width,
            cx: r4((s.x0 + s.x1) / 2),
            cy: r4((s.y0 + s.y1) / 2),
            rx: r4(rx),
            ry: r4(ry),
          };
        }
      }
      if (item) {
        p.onApply(n, { ...before, items: [...before.items, item] });
        p.onRecord(opAddItem(n, item));
      }
    }
    paintLive();
  }

  const drawingTool = p.tool === "pen" || p.tool === "highlighter" || p.tool === "circle" || p.tool === "eraser";
  const hasOpenNote = p.ann.notes.some((x) => x.id === p.openNoteId);

  return (
    <div
      ref={(el) => {
        wrap.current = el;
        p.registerEl(n, el);
      }}
      className="pdfpage"
      data-pdfpage={n}
      style={{ width, height, zIndex: hasOpenNote ? 20 : undefined }}
      aria-label={`Página ${n}`}
    >
      {active ? (
        <>
          <canvas ref={pdfCanvas} className="pdfpage-pdf" />
          <canvas ref={baseCanvas} className="pdfpage-ink" />
          <canvas
            ref={liveCanvas}
            className="pdfpage-live"
            data-tool={p.tool}
            style={{ pointerEvents: drawingTool ? "auto" : "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
          />
        </>
      ) : (
        <span className="pdfpage-wait">Página {n}</span>
      )}

      {p.ann.notes.map((note) => (
        <div key={note.id} data-nopan="" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="pdfnote-pin"
            style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, background: note.color }}
            aria-label="Abrir comentário"
            onClick={() => p.onOpenNote(p.openNoteId === note.id ? null : note.id)}
          >
            💬
          </button>
          {p.openNoteId === note.id && (
            <div
              className="pdfnote-pop"
              style={{
                top: `calc(${note.y * 100}% + 8px)`,
                ...(note.x > 0.55 ? { right: `${(1 - note.x) * 100}%` } : { left: `${note.x * 100}%` }),
              }}
            >
              <textarea
                autoFocus
                rows={4}
                value={note.text}
                placeholder="Escreva seu comentário…"
                aria-label="Comentário"
                onChange={(e) => p.onNoteText(n, note.id, e.target.value)}
              />
              <div className="pdfnote-actions">
                <button type="button" className="pdfnb-btn" onClick={() => p.onNoteDelete(n, note.id)}>
                  Excluir
                </button>
                <button type="button" className="pdfnb-btn on" onClick={() => p.onOpenNote(null)}>
                  Pronto
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default memo(PdfPageView);
