"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs";
import { drawItem, drawItems, hitItem } from "./draw";
import NoteCard from "./NoteCard";
import {
  opAddItem,
  opAddNote,
  opMoveNote,
  opRemoveItems,
  uid,
  type EllipseItem,
  type InkItem,
  type Item,
  type Note,
  type NoteClip,
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
  onCopyNote: (clip: NoteClip) => void;
  claim: (pointerId: number) => boolean;
  isPinching: () => boolean;
};

type Session =
  | { kind: "ink"; pid: number; tool: "pen" | "highlighter"; color: string; width: number; pts: number[] }
  | { kind: "ellipse"; pid: number; color: string; width: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "erase"; pid: number; cur: PageAnn; removed: Item[] };

type Crop = { x0: number; y0: number; x1: number; y1: number };
type PinDrag = { id: string; pid: number; sx: number; sy: number; ox: number; oy: number; x0: number; y0: number; moved: boolean };

// A camada de texto é criada uma vez em escala 2 e depois só é redimensionada por CSS (acompanha o zoom).
const TEXT_SCALE = 2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function PdfPageView(p: PageProps) {
  const { doc, n, width, ratio, active } = p;
  const height = width * ratio;

  const wrap = useRef<HTMLDivElement>(null);
  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const textDiv = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const annRef = useRef(p.ann);
  annRef.current = p.ann;
  const propsRef = useRef(p);
  propsRef.current = p;

  const pinDrag = useRef<PinDrag | null>(null);
  const pinMoved = useRef(false);

  const [textW, setTextW] = useState(0);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [cropDragging, setCropDragging] = useState(false);
  const [cropMsg, setCropMsg] = useState("");
  const cropSession = useRef<{ pid: number; x0: number; y0: number } | null>(null);

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

  // 1b) Camada de texto invisível por cima do PDF: é ela que permite selecionar e copiar o texto.
  useEffect(() => {
    if (!active) return;
    const box = textDiv.current;
    if (!box) return;
    let cancelled = false;
    let layer: { cancel: () => void } | null = null;
    (async () => {
      try {
        const [pdfjs, page] = await Promise.all([loadPdfjs(), doc.getPage(n)]);
        if (cancelled) return;
        const vp = page.getViewport({ scale: TEXT_SCALE });
        box.replaceChildren();
        box.style.setProperty("--scale-factor", String(TEXT_SCALE));
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: box, viewport: vp });
        layer = tl;
        box.style.width = `${vp.width}px`;
        box.style.height = `${vp.height}px`;
        setTextW(vp.width);
        await tl.render();
      } catch {
        /* página sem texto ou camada cancelada: normal */
      }
    })();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [active, doc, n]);

  // Sai da ferramenta "Copiar imagem": limpa o retângulo.
  useEffect(() => {
    if (p.tool !== "clip") {
      setCrop(null);
      setCropMsg("");
      setCropDragging(false);
      cropSession.current = null;
    }
  }, [p.tool]);

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
    if (!p.editable || p.tool === "hand" || p.tool === "note" || p.tool === "select" || p.tool === "clip") return;
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

  function patchNote(id: string, patch: Partial<Note>) {
    const a = annRef.current;
    const next = { ...a, notes: a.notes.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    annRef.current = next;
    p.onApply(n, next);
  }

  // ---------- Mover o emblema do comentário (arrastar) ----------
  function onPinDown(e: React.PointerEvent<HTMLButtonElement>, note: Note) {
    if (!p.editable) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [px, py] = toPage(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    pinDrag.current = {
      id: note.id,
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: note.x - px,
      oy: note.y - py,
      x0: note.x,
      y0: note.y,
      moved: false,
    };
    pinMoved.current = false;
  }

  function onPinMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = pinDrag.current;
    if (!d || d.pid !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    d.moved = true;
    pinMoved.current = true;
    const [px, py] = toPage(e.clientX, e.clientY);
    patchNote(d.id, { x: r4(clamp01(px + d.ox)), y: r4(clamp01(py + d.oy)) });
  }

  function onPinUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = pinDrag.current;
    if (!d || d.pid !== e.pointerId) return;
    pinDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    const now = annRef.current.notes.find((x) => x.id === d.id);
    if (now && (now.x !== d.x0 || now.y !== d.y0)) {
      p.onRecord(opMoveNote(n, d.id, { x: d.x0, y: d.y0 }, { x: now.x, y: now.y }));
    }
    // o clique que vem logo depois de arrastar não deve abrir/fechar o comentário
    window.setTimeout(() => {
      pinMoved.current = false;
    }, 0);
  }

  // Cria uma cópia do comentário logo ao lado (depois é só arrastar o emblema para onde quiser).
  function duplicateNote(id: string) {
    const a = annRef.current;
    const src = a.notes.find((x) => x.id === id);
    if (!src) return;
    const copy: Note = { ...src, id: uid(), x: r4(clamp01(src.x + 0.04)), y: r4(clamp01(src.y + 0.05)) };
    const next = { ...a, notes: [...a.notes, copy] };
    annRef.current = next;
    p.onApply(n, next);
    p.onRecord(opAddNote(n, copy));
    p.onOpenNote(null);
  }

  // ---------- Copiar imagem (recorte da página) ----------
  function onCropDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch" && !p.fingerDraw) return;
    if (!p.claim(e.pointerId)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toPage(e.clientX, e.clientY);
    cropSession.current = { pid: e.pointerId, x0: x, y0: y };
    setCropMsg("");
    setCropDragging(true);
    setCrop({ x0: x, y0: y, x1: x, y1: y });
  }

  function onCropMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = cropSession.current;
    if (!s || s.pid !== e.pointerId) return;
    if (p.isPinching()) {
      cropSession.current = null;
      setCropDragging(false);
      setCrop(null);
      return;
    }
    const [x, y] = toPage(e.clientX, e.clientY);
    setCrop({ x0: s.x0, y0: s.y0, x1: x, y1: y });
  }

  function onCropUp(e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const s = cropSession.current;
    if (!s || s.pid !== e.pointerId) return;
    cropSession.current = null;
    setCropDragging(false);
    setCrop((c) => {
      if (!c || cancelled) return null;
      const w = Math.abs(c.x1 - c.x0) * width;
      const h = Math.abs(c.y1 - c.y0) * height;
      return w < 12 || h < 12 ? null : c;
    });
  }

  // Redesenha só o trecho escolhido em alta resolução (sem as anotações), para a imagem sair nítida.
  async function renderCrop(c: Crop): Promise<Blob> {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const l = Math.min(c.x0, c.x1);
    const t = Math.min(c.y0, c.y1);
    const w = Math.abs(c.x1 - c.x0);
    const h = Math.abs(c.y1 - c.y0);
    const scale = Math.min(4, Math.max(2, 1800 / Math.max(1, w * base.width)));
    const full = page.getViewport({ scale });
    const vp = page.getViewport({ scale, offsetX: -l * full.width, offsetY: -t * full.height });
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * full.width));
    out.height = Math.max(1, Math.round(h * full.height));
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return await new Promise<Blob>((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("sem imagem"))), "image/png");
    });
  }

  async function cropCopy() {
    if (!crop) return;
    setCropMsg("Preparando a imagem…");
    try {
      const promise = renderCrop(crop);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard && typeof navigator.clipboard.write === "function") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": promise })]);
        setCropMsg("Imagem copiada! Cole no comentário ou na anotação.");
      } else {
        saveBlob(await promise, `pdf-pagina-${n}.png`);
        setCropMsg("Este navegador não deixa copiar imagem; ela foi baixada.");
      }
    } catch {
      setCropMsg("Não consegui copiar. Toque em Baixar.");
    }
  }

  async function cropDownload() {
    if (!crop) return;
    setCropMsg("Preparando a imagem…");
    try {
      saveBlob(await renderCrop(crop), `pdf-pagina-${n}.png`);
      setCropMsg("Imagem baixada.");
    } catch {
      setCropMsg("Não consegui gerar a imagem.");
    }
  }

  const drawingTool = p.tool === "pen" || p.tool === "highlighter" || p.tool === "circle" || p.tool === "eraser";
  const hasOpenNote = p.ann.notes.some((x) => x.id === p.openNoteId);

  const rect = crop
    ? { l: Math.min(crop.x0, crop.x1), t: Math.min(crop.y0, crop.y1), w: Math.abs(crop.x1 - crop.x0), h: Math.abs(crop.y1 - crop.y0) }
    : null;

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
          <div
            ref={textDiv}
            className="pdfpage-text"
            aria-hidden="true"
            style={textW > 0 ? { transform: `scale(${width / textW})` } : { display: "none" }}
          />
        </>
      ) : (
        <span className="pdfpage-wait">Página {n}</span>
      )}

      {active && p.tool === "clip" && (
        <div
          className="pdfpage-clip"
          onPointerDown={onCropDown}
          onPointerMove={onCropMove}
          onPointerUp={(e) => onCropUp(e, false)}
          onPointerCancel={(e) => onCropUp(e, true)}
        >
          {rect && (
            <div
              className="pdfpage-clip-box"
              style={{ left: `${rect.l * 100}%`, top: `${rect.t * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            />
          )}
        </div>
      )}

      {active && p.tool === "clip" && rect && !cropDragging && (
        <div
          className="pdfpage-clipbar"
          data-nopan=""
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            left: `${Math.min(rect.l * 100, 40)}%`,
            top: rect.t + rect.h > 0.85 ? `calc(${rect.t * 100}% - 56px)` : `calc(${(rect.t + rect.h) * 100}% + 8px)`,
          }}
        >
          <button type="button" className="pdfnb-btn on" onClick={() => void cropCopy()}>Copiar imagem</button>
          <button type="button" className="pdfnb-btn" onClick={() => void cropDownload()}>Baixar</button>
          <button
            type="button"
            className="pdfnb-btn"
            aria-label="Cancelar"
            onClick={() => {
              setCrop(null);
              setCropMsg("");
            }}
          >
            ✕
          </button>
          {cropMsg && <span className="pdfpage-clipmsg">{cropMsg}</span>}
        </div>
      )}

      {p.ann.notes.map((note) => (
        <div key={note.id} data-nopan="" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="pdfnote-pin"
            style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, background: note.color }}
            aria-label="Abrir comentário (arraste para mover)"
            title="Toque para abrir • arraste para mover"
            onPointerDown={(e) => onPinDown(e, note)}
            onPointerMove={onPinMove}
            onPointerUp={onPinUp}
            onPointerCancel={onPinUp}
            onClick={() => {
              if (pinMoved.current) return;
              p.onOpenNote(p.openNoteId === note.id ? null : note.id);
            }}
          >
            💬
          </button>
          {p.openNoteId === note.id && (
            <NoteCard
              note={note}
              onPatch={(patch) => patchNote(note.id, patch)}
              onDelete={() => p.onNoteDelete(n, note.id)}
              onClose={() => p.onOpenNote(null)}
              onCopy={p.onCopyNote}
              onDuplicate={() => duplicateNote(note.id)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default memo(PdfPageView);
