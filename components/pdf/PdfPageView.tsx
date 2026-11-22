"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs";
import { drawItem, drawItems, hitItem } from "./draw";
import NoteCard from "./NoteCard";
import ReadOnlyNote from "./ReadOnlyNote";
import { CONV_FONTS, setConvPrefs, useConvPrefs } from "./conv";
import { recognizeInk, shapeIds, type Anchor } from "../editor/ink-recognize";
import { findMate, joinText } from "../editor/ink-merge";
import { boundsOf, pickedByLasso } from "../editor/ink-geometry";
import { drawText, hitText, loadHandwritingFonts, textBounds, textFromLine, textInPoly, type TextItem } from "../editor/ink-text";
import {
  opAddItem,
  opAddNote,
  opMoveNote,
  opTextChange,
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
  | { kind: "lasso"; pid: number; pts: number[] }
  | { kind: "erase"; pid: number; cur: PageAnn; removed: Item[]; removedTexts: TextItem[] };

type Crop = { x0: number; y0: number; x1: number; y1: number };
type PinDrag = { id: string; pid: number; sx: number; sy: number; ox: number; oy: number; x0: number; y0: number; moved: boolean };

// A camada de texto é criada uma vez em escala 2 e depois só é redimensionada por CSS (acompanha o zoom).
const TEXT_SCALE = 2;
const GHOST_A = 0.18; // depois da conversão, a letra à mão fica clarinha atrás do texto para você conferir
const GHOST_MS = 9000;
const HOVER_EXTRA_MS = 1500; // caneta pairando: a conversão sai depois da pausa mais esse tempo
const SEL_TAP_PX = 8; // laço sem arrastar mais que isso = toque (abre a correção do texto)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

// Traço do PDF (y pela altura) para o espaço do reconhecedor (x e y pela largura).
const toW = (it: InkItem, r: number): InkItem => ({ ...it, pts: it.pts.map((v, i) => (i % 2 ? v * r : v)) });

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
  const markCanvas = useRef<HTMLCanvasElement>(null);
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

  // ---------- Conversão da escrita em fonte (igual à do caderno) ----------
  const prefs = useConvPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [convOpen, setConvOpen] = useState(false);
  const [convBusy, setConvBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [ghost, setGhost] = useState<Item[] | null>(null);
  const [editIds, setEditIds] = useState<string[] | null>(null);
  const [lastConv, setLastConv] = useState<string[]>([]);
  const [fontTick, setFontTick] = useState(0);
  const editBase = useRef<TextItem[]>([]);
  const ghostTimer = useRef(0);
  const msgTimer = useRef(0);
  const pending = useRef<Set<string>>(new Set());
  const autoTimer = useRef(0);
  const penHover = useRef(false);
  const busy = useRef(false);
  const runRef = useRef<(only: Set<string> | null, manual: boolean) => void>(() => undefined);

  // A página só é redesenhada em alta resolução depois que o zoom "assenta".
  const [renderW, setRenderW] = useState(width);
  useEffect(() => {
    const t = setTimeout(() => setRenderW(width), 160);
    return () => clearTimeout(t);
  }, [width]);

  useEffect(() => {
    loadHandwritingFonts(() => setFontTick((t) => t + 1));
    return () => {
      window.clearTimeout(ghostTimer.current);
      window.clearTimeout(msgTimer.current);
      window.clearTimeout(autoTimer.current);
    };
  }, []);

  function say(text: string | null) {
    setMsg(text);
    window.clearTimeout(msgTimer.current);
    if (text && text !== "Convertendo…") msgTimer.current = window.setTimeout(() => setMsg(null), 7000);
  }

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

  // Sai do laço: solta a seleção.
  useEffect(() => {
    if (p.tool !== "lasso" && !editIds) setSelIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tool]);

  // 2) Desenha as anotações salvas (camada separada, por cima do PDF).
  useEffect(() => {
    if (!active) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(width * dpr));
    const H = Math.max(1, Math.round(height * dpr));
    const base = baseCanvas.current;
    const mark = markCanvas.current;
    const live = liveCanvas.current;
    if (!base || !mark || !live) return;
    if (base.width !== W || base.height !== H) {
      base.width = W;
      base.height = H;
    }
    if (mark.width !== W || mark.height !== H) {
      mark.width = W;
      mark.height = H;
    }
    if (live.width !== W || live.height !== H) {
      live.width = W;
      live.height = H;
    }
    const ctx = base.getContext("2d");
    if (ctx) {
      drawItems(ctx, p.ann.items, W, H, "rest");
      // A letra à mão que virou texto fica clarinha por alguns segundos, para conferir se o app leu certo.
      if (ghost) {
        ctx.save();
        ctx.globalAlpha = GHOST_A;
        for (const g of ghost) drawItem(ctx, g, W, H);
        ctx.restore();
      }
      for (const t of p.ann.texts ?? []) drawText(ctx, t, W);
      if (selIds.length) {
        const sel = new Set(selIds);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const it of p.ann.items) {
          if (it.kind !== "ink" || !sel.has(it.id)) continue;
          for (let i = 0; i + 1 < it.pts.length; i += 2) {
            x0 = Math.min(x0, it.pts[i] * W);
            x1 = Math.max(x1, it.pts[i] * W);
            y0 = Math.min(y0, it.pts[i + 1] * H);
            y1 = Math.max(y1, it.pts[i + 1] * H);
          }
        }
        for (const t of p.ann.texts ?? []) {
          if (!sel.has(t.id)) continue;
          const b = textBounds(t, W);
          x0 = Math.min(x0, b[0] * W);
          x1 = Math.max(x1, b[2] * W);
          y0 = Math.min(y0, b[1] * W);
          y1 = Math.max(y1, b[3] * W);
        }
        if (x0 < x1 || y0 < y1) {
          const pad = 6 * dpr;
          ctx.save();
          ctx.setLineDash([6 * dpr, 5 * dpr]);
          ctx.strokeStyle = "#2563eb";
          ctx.fillStyle = "rgba(37,99,235,.07)";
          ctx.lineWidth = 1.5 * dpr;
          ctx.fillRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
          ctx.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
          ctx.restore();
        }
      }
    }
    const mctx = mark.getContext("2d");
    if (mctx) drawItems(mctx, p.ann.items, W, H, "marker");
  }, [active, width, height, p.ann.items, p.ann.texts, ghost, selIds, fontTick]);

  function paintLive() {
    const live = liveCanvas.current;
    if (!live) return;
    const ctx = live.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    const s = session.current;
    if (!s || s.kind === "erase") return;
    if (s.kind === "lasso") {
      if (s.pts.length < 4) return;
      const k = live.width / width;
      ctx.save();
      ctx.setLineDash([6 * k, 5 * k]);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.moveTo(s.pts[0] * live.width, s.pts[1] * live.height);
      for (let i = 2; i + 1 < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * live.width, s.pts[i + 1] * live.height);
      ctx.stroke();
      ctx.restore();
      return;
    }
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
    } else if (s.kind === "lasso") {
      const len = s.pts.length;
      if (Math.hypot((x - s.pts[len - 2]) * width, (y - s.pts[len - 1]) * height) >= 1) s.pts.push(x, y);
    } else if (s.kind === "ellipse") {
      s.x1 = x;
      s.y1 = y;
    } else {
      const W = width;
      const H = height;
      const r = H / W;
      const hit = s.cur.items.filter((it) => hitItem(it, x, y, W, H, 10));
      const hitT = (s.cur.texts ?? []).filter((t) => hitText(t, x, y * r, W, 10));
      if (hit.length > 0 || hitT.length > 0) {
        const ids = new Set(hit.map((h) => h.id));
        const tids = new Set(hitT.map((h) => h.id));
        s.removed.push(...hit);
        s.removedTexts.push(...hitT);
        s.cur = { ...s.cur, items: s.cur.items.filter((it) => !ids.has(it.id)), texts: (s.cur.texts ?? []).filter((t) => !tids.has(t.id)) };
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
    window.clearTimeout(autoTimer.current); // voltou a escrever: espera a próxima pausa
    autoTimer.current = 0;
    if (e.pointerType === "pen") penHover.current = true;
    const [x, y] = toPage(e.clientX, e.clientY);
    let s: Session;
    if (p.tool === "pen" || p.tool === "highlighter") {
      if (ghost) setGhost(null); // voltou a escrever: a letra clarinha da conversão anterior some
      s = { kind: "ink", pid: e.pointerId, tool: p.tool, color: p.color, width: p.size, pts: [r4(x), r4(y)] };
    } else if (p.tool === "circle") {
      s = { kind: "ellipse", pid: e.pointerId, color: p.color, width: p.size, x0: x, y0: y, x1: x, y1: y };
    } else if (p.tool === "lasso") {
      if (!editIds) setSelIds([]);
      s = { kind: "lasso", pid: e.pointerId, pts: [x, y] };
    } else {
      s = { kind: "erase", pid: e.pointerId, cur: annRef.current, removed: [], removedTexts: [] };
      move(s, e.clientX, e.clientY);
    }
    session.current = s;
    paintLive();
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = session.current;
    // Caneta pairando: você ainda está escrevendo, então a conversão espera (e sai depois da pausa mais um tempinho).
    if (!s && e.pointerType === "pen") {
      penHover.current = true;
      armAuto(true);
    }
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

  function onLeave(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType !== "pen" || session.current) return;
    penHover.current = false;
    armAuto(false);
  }

  function commitOp(op: Op) {
    const next = op.redo(annRef.current);
    annRef.current = next;
    propsRef.current.onApply(n, next);
    propsRef.current.onRecord(op);
  }

  function finish(e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) {
    const s = session.current;
    if (!s || s.pid !== e.pointerId) return;
    session.current = null;
    const before = annRef.current;
    if (s.kind === "lasso") {
      if (!cancelled) {
        const r = height / width;
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (let i = 0; i + 1 < s.pts.length; i += 2) {
          x0 = Math.min(x0, s.pts[i]);
          x1 = Math.max(x1, s.pts[i]);
          y0 = Math.min(y0, s.pts[i + 1]);
          y1 = Math.max(y1, s.pts[i + 1]);
        }
        const tap = Math.max((x1 - x0) * width, (y1 - y0) * height) <= SEL_TAP_PX;
        if (tap) {
          // Tocar num texto convertido abre a correção das palavras.
          const [x, y] = [s.pts[0], s.pts[1]];
          const hit = [...(before.texts ?? [])].reverse().find((t) => hitText(t, x, y * r, width, 12));
          if (hit) openEdit([hit.id]);
          else setSelIds([]);
        } else if (s.pts.length >= 6) {
          const poly = s.pts.map((v, i) => (i % 2 ? v * r : v));
          const ids = [
            ...before.items.filter((it): it is InkItem => it.kind === "ink" && pickedByLasso(toW(it, r), poly)).map((it) => it.id),
            ...(before.texts ?? []).filter((t) => textInPoly(t, poly, width)).map((t) => t.id),
          ];
          setSelIds(ids);
        }
      }
      paintLive();
      return;
    }
    if (s.kind === "erase") {
      if (s.removed.length > 0 || s.removedTexts.length > 0) {
        s.removed.forEach((it) => pending.current.delete(it.id));
        p.onRecord(opTextChange(n, { rmItems: s.removed, addItems: [], rmTexts: s.removedTexts, addTexts: [] }));
      }
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
        const next = { ...before, items: [...before.items, item] };
        annRef.current = next;
        p.onApply(n, next);
        p.onRecord(opAddItem(n, item));
        if (item.kind === "ink" && item.tool === "pen" && prefsRef.current.autoOn) {
          // Se este traço começou outra linha, a linha anterior já está pronta e é convertida agora.
          if (pending.current.size) {
            const r = height / width;
            const all = next.items.filter((it): it is InkItem => it.kind === "ink").map((it) => toW(it, r));
            const pb = boundsOf(all, pending.current);
            const nb = boundsOf(all, new Set([item.id]));
            if (pb && nb) {
              const overlap = Math.min(pb[3], nb[3]) - Math.max(pb[1], nb[1]);
              const minH = Math.min(pb[3] - pb[1], nb[3] - nb[1]);
              if (overlap < 0.3 * minH) {
                const prev = new Set(pending.current);
                pending.current = new Set();
                runRef.current(prev, false);
              }
            }
          }
          pending.current.add(item.id);
          if (e.pointerType === "pen") penHover.current = true;
          armAuto(penHover.current);
        }
      }
    }
    paintLive();
  }

  // ---------- Conversão automática e manual ----------
  function armAuto(hover: boolean) {
    window.clearTimeout(autoTimer.current);
    autoTimer.current = 0;
    if (!prefsRef.current.autoOn || !pending.current.size) return;
    if (penHover.current && !hover) return; // a contagem só começa quando a caneta sai
    autoTimer.current = window.setTimeout(
      () => {
        autoTimer.current = 0;
        if (penHover.current && !hover) return;
        runRef.current(null, false);
      },
      prefsRef.current.autoDelay * 1000 + (hover ? HOVER_EXTRA_MS : 0)
    );
  }

  // Troca os traços por texto na fonte escolhida (um item por linha), no mesmo lugar.
  // Setas, traços soltos, linhas longas e círculos ficam como desenho. O que não for lido continua na fila.
  async function runConv(only: Set<string> | null, manual: boolean) {
    if (busy.current) {
      if (only) only.forEach((id) => pending.current.add(id));
      armAuto(false);
      return;
    }
    const ids = only ?? new Set(pending.current);
    if (!only) pending.current = new Set();
    const w = propsRef.current.width;
    const r = propsRef.current.ratio;
    const a0 = annRef.current;
    const src = a0.items.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && ids.has(it.id)).map((it) => toW(it, r));
    if (!src.length) return;
    const anchors: Anchor[] = (a0.texts ?? []).map((t) => {
      const b = textBounds(t, w);
      return { left: b[0] * w, top: b[1] * w, right: b[2] * w, bottom: b[3] * w };
    });
    const shapes = shapeIds(src, w, anchors);
    const work = shapes.size ? src.filter((it) => !shapes.has(it.id)) : src;
    if (!work.length) {
      if (manual) say("Só há setas, traços ou desenhos aqui: eles ficam como estão.");
      return;
    }
    busy.current = true;
    setConvBusy(true);
    say("Convertendo…");
    try {
      const { lines, failed } = await recognizeInk(work, w, anchors);
      const font = CONV_FONTS[prefsRef.current.convFont].v;
      const cur = annRef.current;
      const gone = new Set(lines.flatMap((l) => l.ids));
      const existing = cur.texts ?? [];
      const updated = new Map<string, TextItem>();
      const current = () => existing.map((t) => updated.get(t.id) ?? t);
      const fresh: TextItem[] = [];
      // Pedaço que continua uma linha já convertida entra no mesmo texto, em vez de virar outro texto solto.
      for (const l of lines) {
        const mate = findMate(current(), l, w);
        const joined = mate ? joinText(mate, l.text, /^[.,;:!?)\]]/.test(l.text), w) : null;
        if (joined) updated.set(joined.id, joined);
        else fresh.push(textFromLine(l, w, font));
      }
      // Ponto ou vírgula escritos sozinhos depois da conversão: vão para o fim do texto da mesma linha.
      for (const it of work) {
        if (gone.has(it.id)) continue;
        const b = boundsOf([it], new Set([it.id]));
        if (!b) continue;
        const bw = (b[2] - b[0]) * w;
        const bh = (b[3] - b[1]) * w;
        const at = { left: b[0] * w, top: b[1] * w, bottom: b[3] * w };
        const mate = findMate(current(), at, w);
        if (!mate) continue;
        const px = mate.size * w;
        const small = Math.max(bw, bh) <= px * 0.4;
        const atOrBelowMiddle = (at.top + at.bottom) / 2 >= mate.y * w - px * 0.15;
        if (!small || bw > bh * 1.8 || !atOrBelowMiddle) continue;
        const joined = joinText(mate, bh >= bw * 1.8 ? "," : ".", true, w);
        if (!joined) continue;
        updated.set(joined.id, joined);
        gone.add(it.id);
      }
      const stillPresent = new Set(cur.items.map((it) => it.id));
      const remaining = work.filter((it) => !gone.has(it.id) && stillPresent.has(it.id));
      remaining.forEach((it) => pending.current.add(it.id));
      if (gone.size || fresh.length || updated.size) {
        const goneItems = cur.items.filter((it) => gone.has(it.id));
        const op = opTextChange(n, {
          rmItems: goneItems,
          addItems: [],
          rmTexts: existing.filter((t) => updated.has(t.id)),
          addTexts: [...updated.values(), ...fresh],
        });
        commitOp(op);
        if (goneItems.length) {
          setGhost(goneItems);
          window.clearTimeout(ghostTimer.current);
          ghostTimer.current = window.setTimeout(() => setGhost(null), GHOST_MS);
        }
      }
      if (remaining.length) {
        say("Parte da escrita não foi reconhecida. Ela foi preservada para você tentar novamente.");
      } else if (failed) {
        say(`${failed} ${failed === 1 ? "linha não foi reconhecida" : "linhas não foram reconhecidas"}.`);
      } else if (fresh.length || updated.size) {
        setLastConv([...fresh.map((t) => t.id), ...Array.from(updated.keys())]);
        say("Convertido.");
      } else {
        say(null);
      }
    } catch (err) {
      const stillPresent = new Set(annRef.current.items.map((it) => it.id));
      work.forEach((it) => {
        if (stillPresent.has(it.id)) pending.current.add(it.id);
      });
      say(err instanceof Error ? `${err.message} Sua escrita foi preservada.` : "Falha na conversão. Sua escrita foi preservada.");
    } finally {
      busy.current = false;
      setConvBusy(false);
    }
  }
  runRef.current = (only, manual) => {
    void runConv(only, manual);
  };

  // Botão "Converter": só o que está selecionado com o laço, ou toda a escrita de caneta da página.
  function convertNow() {
    const pens = annRef.current.items.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen");
    const picked = new Set(selIds);
    const src = picked.size ? pens.filter((it) => picked.has(it.id)) : pens;
    if (!src.length) {
      say("Não há escrita de caneta para converter.");
      return;
    }
    window.clearTimeout(autoTimer.current);
    autoTimer.current = 0;
    setSelIds([]);
    void runConv(new Set(src.map((it) => it.id)), true);
  }

  // "Manter como desenho": os traços selecionados nunca viram texto (seta, risco, sublinhado, esquema...).
  function keepAsDrawing() {
    const picked = new Set(selIds);
    const olds = annRef.current.items.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && picked.has(it.id));
    if (!olds.length) return;
    commitOp(opTextChange(n, { rmItems: olds, addItems: olds.map((it) => ({ ...it, keep: true, force: false })), rmTexts: [], addTexts: [] }));
    olds.forEach((it) => pending.current.delete(it.id));
    say("Marcado como desenho: não vira texto.");
    setSelIds([]);
  }

  // "Converter como texto": força a conversão, mesmo que o app ache que é um desenho (ex.: um "l", um "1" ou um hífen).
  function forceText() {
    const picked = new Set(selIds);
    const olds = annRef.current.items.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && picked.has(it.id));
    if (!olds.length) return;
    commitOp(opTextChange(n, { rmItems: olds, addItems: olds.map((it) => ({ ...it, keep: false, force: true })), rmTexts: [], addTexts: [] }));
    setSelIds([]);
    void runConv(new Set(olds.map((it) => it.id)), true);
  }

  function deleteSelection() {
    const picked = new Set(selIds);
    const a = annRef.current;
    const rmItems = a.items.filter((it) => picked.has(it.id));
    const rmTexts = (a.texts ?? []).filter((t) => picked.has(t.id));
    if (!rmItems.length && !rmTexts.length) return;
    rmItems.forEach((it) => pending.current.delete(it.id));
    commitOp(opTextChange(n, { rmItems, addItems: [], rmTexts, addTexts: [] }));
    setSelIds([]);
  }

  // ---------- Corrigir o texto convertido, direto no lugar ----------
  function openEdit(ids: string[]) {
    const want = new Set(ids);
    const list = (annRef.current.texts ?? []).filter((t) => want.has(t.id)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!list.length) return;
    editBase.current = list;
    setEditIds(list.map((t) => t.id));
    setSelIds(list.map((t) => t.id));
    setLastConv([]);
    if (msg === "Convertido.") say(null);
  }

  function editTextOf(id: string, text: string) {
    const a = annRef.current;
    const next = { ...a, texts: (a.texts ?? []).map((t) => (t.id === id ? { ...t, text } : t)) };
    annRef.current = next;
    propsRef.current.onApply(n, next);
  }

  function closeEdit() {
    const ids = new Set(editIds ?? []);
    const a = annRef.current;
    const final = (a.texts ?? []).filter((t) => ids.has(t.id) && t.text.trim());
    // Campo apagado: a linha some.
    const next = { ...a, texts: (a.texts ?? []).filter((t) => !ids.has(t.id) || t.text.trim()) };
    annRef.current = next;
    propsRef.current.onApply(n, next);
    if (JSON.stringify(editBase.current) !== JSON.stringify(final)) {
      propsRef.current.onRecord(opTextChange(n, { rmItems: [], addItems: [], rmTexts: editBase.current, addTexts: final }));
    }
    setGhost(null);
    setEditIds(null);
    setSelIds([]);
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
    if (note.ro) return; // comentário da dona do caderno (link publicado): não se move
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

  const drawingTool = p.tool === "pen" || p.tool === "highlighter" || p.tool === "circle" || p.tool === "eraser" || p.tool === "lasso";
  const hasOpenNote = p.ann.notes.some((x) => x.id === p.openNoteId);

  const rect = crop
    ? { l: Math.min(crop.x0, crop.x1), t: Math.min(crop.y0, crop.y1), w: Math.abs(crop.x1 - crop.x0), h: Math.abs(crop.y1 - crop.y0) }
    : null;

  const texts = p.ann.texts ?? [];
  const hasPen = p.ann.items.some((it) => it.kind === "ink" && it.tool === "pen");
  const selHasText = selIds.some((id) => texts.some((t) => t.id === id));
  const selHasPen = selIds.some((id) => p.ann.items.some((it) => it.kind === "ink" && it.tool === "pen" && it.id === id));
  const showConv = active && p.editable && (p.tool === "pen" || p.tool === "lasso") && (hasPen || convOpen || prefs.autoOn);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const chipBtn: React.CSSProperties = { fontWeight: 700 };
  const panel: React.CSSProperties = {
    display: "grid",
    gap: 6,
    padding: 8,
    borderRadius: 12,
    border: "1px solid #d5dbe3",
    background: "#fff",
    boxShadow: "0 6px 24px rgba(0,0,0,.18)",
    maxWidth: "min(320px, 90%)",
    fontSize: 14,
    color: "#172b36",
  };

  return (
    <div
      ref={(el) => {
        wrap.current = el;
        p.registerEl(n, el);
      }}
      className="pdfpage"
      data-pdfpage={n}
      style={{ width, height, zIndex: hasOpenNote || editIds || convOpen ? 20 : undefined }}
      aria-label={`Página ${n}`}
    >
      {active ? (
        <>
          <canvas ref={pdfCanvas} className="pdfpage-pdf" />
          <canvas ref={markCanvas} className="pdfpage-mark" />
          <canvas ref={baseCanvas} className="pdfpage-ink" />
          <canvas
            ref={liveCanvas}
            className="pdfpage-live"
            data-tool={p.tool}
            style={{ pointerEvents: drawingTool ? "auto" : "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
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

      {/* Conversão da escrita em fonte: botão "Aa" no canto da página (aparece com a caneta ou o laço) */}
      {showConv && (
        <div data-nopan="" onPointerDown={stop} style={{ position: "absolute", top: 8, right: 8, zIndex: 25, display: "grid", gap: 6, justifyItems: "end" }}>
          <button
            type="button"
            className={convOpen || prefs.autoOn ? "pdfnb-btn on" : "pdfnb-btn"}
            aria-label="Converter escrita em texto digitado"
            aria-expanded={convOpen}
            onClick={() => setConvOpen((v) => !v)}
          >
            {prefs.autoOn ? "Aa ●" : "Aa"}
          </button>
          {convOpen && (
            <div role="group" aria-label="Converter escrita em texto" style={panel}>
              <button type="button" className="pdfnb-btn on" style={chipBtn} disabled={!hasPen || convBusy} onClick={convertNow}>
                {convBusy ? "Convertendo…" : selIds.length ? `Converter os ${selIds.length} selecionados` : "Converter a escrita"}
              </button>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={prefs.autoOn}
                  onChange={(e) => {
                    setConvPrefs({ autoOn: e.target.checked });
                    if (!e.target.checked) {
                      pending.current = new Set();
                      window.clearTimeout(autoTimer.current);
                      say(null);
                    }
                  }}
                />
                Converter sozinha quando eu parar de escrever
              </label>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }} aria-label="Fonte do texto convertido">
                {CONV_FONTS.map((f, i) => (
                  <button
                    type="button"
                    key={f.name}
                    className={prefs.convFont === i ? "pdfnb-btn on" : "pdfnb-btn"}
                    aria-pressed={prefs.convFont === i}
                    style={{ fontFamily: f.v ?? undefined, whiteSpace: "nowrap" }}
                    onClick={() => setConvPrefs({ convFont: i })}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              {prefs.autoOn && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ whiteSpace: "nowrap" }}>Pausa</span>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={1}
                    value={prefs.autoDelay}
                    aria-label="Tempo de pausa antes de converter"
                    onChange={(e) => setConvPrefs({ autoDelay: Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 80 }}
                  />
                  <b>{prefs.autoDelay} s</b>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                A letra vira texto no mesmo lugar e na mesma cor. Use o ⬚ Laço para escolher um trecho, tocar no texto e corrigir palavras, ou marcar "Manter como desenho". Precisa de internet.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Avisos, "Corrigir" e ações da seleção (canto de cima à esquerda) */}
      {active && p.editable && (msg || (lastConv.length > 0 && !editIds) || (p.tool === "lasso" && selIds.length > 0 && !editIds) || editIds) && (
        <div data-nopan="" onPointerDown={stop} style={{ position: "absolute", top: 8, left: 8, zIndex: 25, display: "grid", gap: 6, maxWidth: "min(360px, 80%)" }}>
          {editIds ? (
            <div role="group" aria-label="Corrigir o texto convertido" style={panel}>
              <b>Corrigir o texto</b>
              {editIds.map((id, i) => {
                const t = texts.find((x) => x.id === id);
                if (!t) return null;
                return (
                  <input
                    key={id}
                    type="text"
                    value={t.text}
                    autoFocus={i === 0}
                    aria-label={`Texto da linha ${i + 1}`}
                    onChange={(e) => editTextOf(id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") closeEdit();
                    }}
                    style={{ width: "100%", boxSizing: "border-box", height: 42, padding: "0 10px", borderRadius: 8, border: "1px solid #d5dbe3", fontSize: 17, fontFamily: t.font ?? undefined }}
                  />
                );
              })}
              <button type="button" className="pdfnb-btn on" style={chipBtn} onClick={closeEdit}>Pronto</button>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>A letra à mão clarinha atrás do texto é só para conferir. Apague o campo e toque em Pronto para remover a linha; ↶ desfaz.</p>
            </div>
          ) : (
            <>
              {msg && (
                <div role="status" style={{ ...panel, fontSize: 13 }}>
                  {msg === "Convertido." ? (
                    <span>
                      Convertido ✓{" "}
                      {lastConv.length > 0 && (
                        <button type="button" className="pdfnb-btn on" style={chipBtn} onClick={() => openEdit(lastConv)}>Corrigir</button>
                      )}
                    </span>
                  ) : (
                    <span>{msg}</span>
                  )}
                </div>
              )}
              {!msg && lastConv.length > 0 && (
                <div style={panel}>
                  <button type="button" className="pdfnb-btn on" style={chipBtn} onClick={() => openEdit(lastConv)}>Corrigir texto convertido</button>
                </div>
              )}
              {p.tool === "lasso" && selIds.length > 0 && (
                <div role="toolbar" aria-label="Ações da seleção" style={{ ...panel, gridAutoFlow: "row" }}>
                  {selHasText && <button type="button" className="pdfnb-btn on" style={chipBtn} onClick={() => openEdit(selIds)}>✏ Corrigir texto</button>}
                  {selHasPen && <button type="button" className="pdfnb-btn" onClick={keepAsDrawing}>Manter como desenho</button>}
                  {selHasPen && <button type="button" className="pdfnb-btn" onClick={forceText}>Converter como texto</button>}
                  <button type="button" className="pdfnb-btn" onClick={deleteSelection}>Excluir seleção</button>
                  <button type="button" className="pdfnb-btn" onClick={() => setSelIds([])}>Soltar</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {p.ann.notes.map((note) => (
        <div key={note.id} data-nopan="" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={note.ro ? "pdfnote-pin ro" : "pdfnote-pin"}
            style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, background: note.color }}
            aria-label={note.ro ? "Abrir comentário do caderno" : "Abrir comentário (arraste para mover)"}
            title={note.ro ? "Comentário do caderno (somente leitura)" : "Toque para abrir • arraste para mover"}
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
          {p.openNoteId === note.id &&
            (note.ro ? (
              <ReadOnlyNote note={note} onClose={() => p.onOpenNote(null)} onCopy={p.onCopyNote} />
            ) : (
              <NoteCard
                note={note}
                onPatch={(patch) => patchNote(note.id, patch)}
                onDelete={() => p.onNoteDelete(n, note.id)}
                onClose={() => p.onOpenNote(null)}
                onCopy={p.onCopyNote}
                onDuplicate={() => duplicateNote(note.id)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

export default memo(PdfPageView);
