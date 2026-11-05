"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs";
import PdfPageView from "./PdfPageView";
import { usePdfAnnotations } from "./usePdfAnnotations";
import {
  EMPTY,
  INK_COLORS,
  MARK_COLORS,
  MARK_WIDTHS,
  PEN_WIDTHS,
  TOOLS,
  opAddNote,
  opRemoveNote,
  uid,
  type Note,
  type Tool,
} from "./types";

const PAD = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const A4_RATIO = Math.SQRT2;

type ViewMode = "scroll" | "page";
type ViewPrefs = { zoom: number; mode: ViewMode; page: number };
type ColorKey = "pen" | "highlighter" | "circle" | "note";
type ToolPrefs = { colors: Record<ColorKey, string>; sizeIdx: number; fingerDraw?: boolean };

type Ptr = { id: number; type: string; x: number; y: number; sx: number; sy: number; t0: number; claimed: boolean; moved: boolean };
type Pinch = { a: number; b: number; d0: number; z0: number; ax: number; ay: number; sl: number; st: number; mx: number; my: number; r: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const viewKey = (url: string) => `mednotes:pdf-view:${url}`;
const TOOL_KEY = "mednotes:pdf-tools";

function readView(url: string): ViewPrefs {
  try {
    const raw = localStorage.getItem(viewKey(url));
    if (raw) {
      const v = JSON.parse(raw) as Partial<ViewPrefs>;
      return {
        zoom: clamp(Number(v.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
        mode: v.mode === "page" ? "page" : "scroll",
        page: Math.max(1, Math.floor(Number(v.page) || 1)),
      };
    }
  } catch {
    /* ignora */
  }
  return { zoom: 1, mode: "scroll", page: 1 };
}

const DEFAULT_TOOLS: ToolPrefs = {
  colors: { pen: INK_COLORS[0], highlighter: MARK_COLORS[0], circle: INK_COLORS[1], note: "#facc15" },
  sizeIdx: 1,
};

function readTools(): ToolPrefs {
  try {
    const raw = localStorage.getItem(TOOL_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<ToolPrefs>;
      return {
        colors: { ...DEFAULT_TOOLS.colors, ...(v.colors ?? {}) },
        sizeIdx: clamp(Math.floor(Number(v.sizeIdx) || 1), 0, 2),
        fingerDraw: typeof v.fingerDraw === "boolean" ? v.fingerDraw : undefined,
      };
    }
  } catch {
    /* ignora */
  }
  return DEFAULT_TOOLS;
}

export default function PdfNotebook({ url, name, onRemove }: { url: string; name: string; onRemove?: () => void }) {
  const ann = usePdfAnnotations(url);
  const { get, apply, record, undo, redo } = ann;

  const [view] = useState(() => readView(url));
  const [toolPrefs] = useState(readTools);

  const [started, setStarted] = useState(false);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [defaultRatio, setDefaultRatio] = useState(A4_RATIO);
  const [cw, setCw] = useState(0);
  const [range, setRange] = useState<[number, number]>([1, 3]);

  const [zoom, setZoom] = useState(view.zoom);
  const [mode, setMode] = useState<ViewMode>(view.mode);
  const [current, setCurrent] = useState(view.page);
  const [full, setFull] = useState(false);

  const [tool, setTool] = useState<Tool>("hand");
  const [colors, setColors] = useState(toolPrefs.colors);
  const [sizeIdx, setSizeIdx] = useState(toolPrefs.sizeIdx);
  const [fingerDraw, setFingerDraw] = useState(toolPrefs.fingerDraw ?? true);
  const [openNote, setOpenNote] = useState<{ page: number; id: string } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const restored = useRef(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const fullRef = useRef(full);
  fullRef.current = full;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const currentRef = useRef(current);
  currentRef.current = current;
  const openRef = useRef(openNote);
  openRef.current = openNote;
  const fingerAuto = useRef(toolPrefs.fingerDraw === undefined);

  const ptrs = useRef<Map<number, Ptr>>(new Map());
  const panRef = useRef<{ id: number; vx: number; vy: number; t: number } | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const inertiaRef = useRef(0);

  // ---------- Abrir o PDF (só quando o caderno chega perto da tela) ----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let created: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const d = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          void d.destroy();
          return;
        }
        created = d;
        const first = await d.getPage(1);
        if (cancelled) return;
        const vp = first.getViewport({ scale: 1 });
        setDefaultRatio(vp.height / vp.width);
        setNumPages(d.numPages);
        setDoc(d);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (created) void created.destroy();
    };
  }, [started, url]);

  // ---------- Medidas ----------
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measureWidth = () => setCw(el.clientWidth);
    measureWidth();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseW = Math.max(200, cw - PAD * 2);
  const pageW = Math.round(baseW * zoom);

  const measure = useCallback(() => {
    const sc = scroller.current;
    if (!sc || numPages === 0 || modeRef.current === "page") return;
    const top = sc.scrollTop;
    const bottom = top + sc.clientHeight;
    const margin = sc.clientHeight;
    let first = numPages;
    let last = 1;
    let cur = 1;
    for (let i = 1; i <= numPages; i++) {
      const el = pageEls.current[i];
      if (!el) continue;
      const t = el.offsetTop;
      const b = t + el.offsetHeight;
      if (b >= top - margin && t <= bottom + margin) {
        if (i < first) first = i;
        if (i > last) last = i;
      }
      if (t <= top + sc.clientHeight * 0.35) cur = i;
    }
    if (first > last) {
      first = cur;
      last = cur;
    }
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    setCurrent((c) => (c === cur ? c : cur));
  }, [numPages]);

  // Depois de mudar o zoom: limpa a "prévia" da pinça e reposiciona a rolagem.
  useLayoutEffect(() => {
    const sc = scroller.current;
    const el = inner.current;
    if (el && !pinchRef.current) {
      el.style.transform = "";
      el.style.transformOrigin = "";
    }
    const ps = pendingScroll.current;
    if (sc && ps) {
      sc.scrollLeft = ps.left;
      sc.scrollTop = ps.top;
      pendingScroll.current = null;
    }
    measure();
  }, [zoom, cw, mode, numPages, ratios, measure]);

  // Volta para a página em que você estava.
  useLayoutEffect(() => {
    if (restored.current || numPages === 0 || cw === 0) return;
    restored.current = true;
    const n = Math.min(currentRef.current, numPages);
    setCurrent(n);
    if (modeRef.current === "scroll" && n > 1) {
      const el = pageEls.current[n];
      if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - PAD;
    }
  }, [numPages, cw]);

  // Lembra zoom, modo e página deste documento.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(viewKey(url), JSON.stringify({ zoom, mode, page: current }));
      } catch {
        /* ignora */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [url, zoom, mode, current]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TOOL_KEY,
        JSON.stringify({ colors, sizeIdx, fingerDraw: fingerAuto.current ? undefined : fingerDraw })
      );
    } catch {
      /* ignora */
    }
  }, [colors, sizeIdx, fingerDraw]);

  // Tela cheia
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  // ---------- Navegação e zoom ----------
  const goTo = useCallback(
    (p: number) => {
      const n = clamp(Math.floor(p), 1, Math.max(1, numPages));
      if (modeRef.current === "page") {
        setCurrent(n);
        scroller.current?.scrollTo({ top: 0, left: 0 });
        return;
      }
      const el = pageEls.current[n];
      if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - PAD, behavior: "smooth" });
    },
    [numPages]
  );

  const applyZoom = useCallback((target: number, cx?: number, cy?: number) => {
    const sc = scroller.current;
    if (!sc) return;
    const z0 = zoomRef.current;
    const z1 = clamp(target, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z1 - z0) < 0.001) return;
    const rect = sc.getBoundingClientRect();
    const mx = (cx ?? rect.left + rect.width / 2) - rect.left;
    const my = (cy ?? rect.top + rect.height / 2) - rect.top;
    const r = z1 / z0;
    pendingScroll.current = { left: (sc.scrollLeft + mx) * r - mx, top: (sc.scrollTop + my) * r - my };
    zoomRef.current = z1;
    setZoom(z1);
  }, []);

  // Ctrl + roda do mouse (ou pinça do trackpad) amplia no computador.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  function onScroll() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      measure();
    });
  }

  // ---------- Gestos: arrastar com o dedo, pinça e inércia ----------
  const scrollByChain = useCallback((sx: number, sy: number) => {
    const sc = scroller.current;
    if (!sc) return;
    const bx = sc.scrollLeft;
    const by = sc.scrollTop;
    sc.scrollLeft = bx + sx;
    sc.scrollTop = by + sy;
    const leftover = sy - (sc.scrollTop - by);
    // Chegou ao fim do PDF: o resto do gesto rola o caderno.
    if (!fullRef.current && Math.abs(leftover) > 1) window.scrollBy(0, leftover);
  }, []);

  const startPinch = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    const ts = Array.from(ptrs.current.values()).filter((p) => p.type === "touch");
    if (ts.length < 2) return;
    const [a, b] = ts;
    const rect = sc.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - rect.left;
    const my = (a.y + b.y) / 2 - rect.top;
    pinchRef.current = {
      a: a.id,
      b: b.id,
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      z0: zoomRef.current,
      ax: sc.scrollLeft + mx,
      ay: sc.scrollTop + my,
      sl: sc.scrollLeft,
      st: sc.scrollTop,
      mx,
      my,
      r: 1,
    };
    a.moved = true;
    b.moved = true;
    panRef.current = null;
  }, []);

  const updatePinch = useCallback(() => {
    const pn = pinchRef.current;
    const sc = scroller.current;
    const el = inner.current;
    if (!pn || !sc || !el) return;
    const a = ptrs.current.get(pn.a);
    const b = ptrs.current.get(pn.b);
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    pn.r = clamp((pn.z0 * d) / pn.d0, MIN_ZOOM, MAX_ZOOM) / pn.z0;
    const rect = sc.getBoundingClientRect();
    pn.mx = (a.x + b.x) / 2 - rect.left;
    pn.my = (a.y + b.y) / 2 - rect.top;
    el.style.transformOrigin = "0 0";
    el.style.transform = `translate(${pn.mx + pn.sl - pn.r * pn.ax}px, ${pn.my + pn.st - pn.r * pn.ay}px) scale(${pn.r})`;
  }, []);

  const endPinch = useCallback(() => {
    const pn = pinchRef.current;
    pinchRef.current = null;
    const sc = scroller.current;
    const el = inner.current;
    if (!pn || !sc) return;
    if (Math.abs(pn.r - 1) < 0.003) {
      if (el) el.style.transform = "";
      sc.scrollLeft = pn.sl;
      sc.scrollTop = pn.st;
      return;
    }
    const z1 = pn.z0 * pn.r;
    pendingScroll.current = { left: pn.r * pn.ax - pn.mx, top: pn.r * pn.ay - pn.my };
    zoomRef.current = z1;
    setZoom(z1);
  }, []);

  const startInertia = useCallback(() => {
    const pn = panRef.current;
    panRef.current = null;
    if (!pn || performance.now() - pn.t > 80) return;
    let vx = pn.vx * 16;
    let vy = pn.vy * 16;
    const step = () => {
      vx *= 0.94;
      vy *= 0.94;
      if (Math.hypot(vx, vy) < 0.4) return;
      scrollByChain(vx, vy);
      inertiaRef.current = requestAnimationFrame(step);
    };
    inertiaRef.current = requestAnimationFrame(step);
  }, [scrollByChain]);

  const addNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      const hit = document
        .elementsFromPoint(clientX, clientY)
        .find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.pdfpage !== undefined);
      if (!hit) return false;
      const page = Number(hit.dataset.pdfpage);
      const r = hit.getBoundingClientRect();
      const x = clamp((clientX - r.left) / r.width, 0, 1);
      const y = clamp((clientY - r.top) / r.height, 0, 1);
      const note: Note = {
        id: uid(),
        x: Math.round(x * 10000) / 10000,
        y: Math.round(y * 10000) / 10000,
        text: "",
        color: colors.note,
      };
      const a = get(page);
      apply(page, { ...a, notes: [...a.notes, note] });
      record(opAddNote(page, note));
      setOpenNote({ page, id: note.id });
      return true;
    },
    [apply, record, get, colors.note]
  );

  const closeNote = useCallback(() => {
    const o = openRef.current;
    if (!o) return;
    setOpenNote(null);
    const a = get(o.page);
    const note = a.notes.find((x) => x.id === o.id);
    // Comentário vazio não fica no caderno.
    if (note && note.text.trim() === "") apply(o.page, { ...a, notes: a.notes.filter((x) => x.id !== o.id) });
  }, [apply, get]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = ptrs.current.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
      if (pinchRef.current) {
        if (p.type === "touch") updatePinch();
        return;
      }
      if (p.claimed || !p.moved) return;
      const t = toolRef.current;
      if (p.type === "mouse" && t !== "hand" && t !== "note") return;
      const cur = panRef.current;
      if (cur && cur.id !== p.id) return;
      const dt = Math.max(1, e.timeStamp - (cur?.t ?? e.timeStamp - 16));
      panRef.current = {
        id: p.id,
        vx: (cur?.vx ?? 0) * 0.6 + (-dx / dt) * 0.4,
        vy: (cur?.vy ?? 0) * 0.6 + (-dy / dt) * 0.4,
        t: e.timeStamp,
      };
      scrollByChain(-dx, -dy);
    };
    const onUp = (e: PointerEvent) => {
      const p = ptrs.current.get(e.pointerId);
      if (!p) return;
      ptrs.current.delete(e.pointerId);
      if (pinchRef.current && (pinchRef.current.a === p.id || pinchRef.current.b === p.id)) {
        endPinch();
        ptrs.current.forEach((q) => {
          q.moved = true;
        });
        return;
      }
      if (e.type === "pointerup" && !p.claimed && !p.moved && e.timeStamp - p.t0 < 500) {
        if (toolRef.current === "note" && addNoteAt(e.clientX, e.clientY)) return;
        closeNote();
      }
      if (panRef.current?.id === p.id) startInertia();
    };
    const onBlur = () => {
      ptrs.current.clear();
      endPinch();
      panRef.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onBlur);
      cancelAnimationFrame(inertiaRef.current);
    };
  }, [updatePinch, endPinch, scrollByChain, startInertia, addNoteAt, closeNote]);

  function onDownCapture(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-nopan]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(inertiaRef.current);
    if (e.pointerType === "pen" && fingerAuto.current) {
      // Chegou uma caneta: a partir daqui o dedo só rola e dá zoom (sem riscar).
      fingerAuto.current = false;
      setFingerDraw(false);
    }
    if (e.pointerType === "touch") {
      for (const q of ptrs.current.values()) if (q.type === "pen") return; // palma da mão apoiada
    }
    ptrs.current.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      t0: e.timeStamp,
      claimed: false,
      moved: false,
    });
    const touches = Array.from(ptrs.current.values()).filter((q) => q.type === "touch");
    if (touches.length >= 2 && !pinchRef.current) startPinch();
  }

  const claim = useCallback((id: number) => {
    if (pinchRef.current) return false;
    const p = ptrs.current.get(id);
    if (!p) return true;
    if (p.type === "touch") {
      const touches = Array.from(ptrs.current.values()).filter((q) => q.type === "touch");
      if (touches.length > 1) return false;
    }
    p.claimed = true;
    return true;
  }, []);

  const isPinching = useCallback(() => pinchRef.current !== null, []);

  // ---------- Callbacks das páginas ----------
  const registerEl = useCallback((n: number, el: HTMLDivElement | null) => {
    pageEls.current[n] = el;
  }, []);

  const onRatio = useCallback((n: number, r: number) => {
    setRatios((prev) => (prev[n] !== undefined && Math.abs(prev[n] - r) < 0.001 ? prev : { ...prev, [n]: r }));
  }, []);

  const onOpenNote = useCallback(
    (id: string | null) => {
      if (id === null) {
        closeNote();
        return;
      }
      // procura em qual página está o comentário
      const page = Object.keys(ann.pages)
        .map(Number)
        .find((pg) => ann.pages[pg].notes.some((x) => x.id === id));
      if (page !== undefined) setOpenNote({ page, id });
    },
    [ann.pages, closeNote]
  );

  const onNoteText = useCallback(
    (n: number, id: string, text: string) => {
      const a = get(n);
      apply(n, { ...a, notes: a.notes.map((x) => (x.id === id ? { ...x, text } : x)) });
    },
    [apply, get]
  );

  const onNoteDelete = useCallback(
    (n: number, id: string) => {
      const a = get(n);
      const note = a.notes.find((x) => x.id === id);
      if (!note) return;
      apply(n, { ...a, notes: a.notes.filter((x) => x.id !== id) });
      record(opRemoveNote(n, note));
      setOpenNote(null);
    },
    [apply, get, record]
  );

  // ---------- Barra de ferramentas ----------
  const editable = ann.loaded && !ann.loadError;
  const palette = tool === "highlighter" ? MARK_COLORS : INK_COLORS;
  const colorKey: ColorKey | null = tool === "pen" || tool === "highlighter" || tool === "circle" || tool === "note" ? tool : null;
  const color = colorKey ? colors[colorKey] : INK_COLORS[0];
  const widths = tool === "highlighter" ? MARK_WIDTHS : PEN_WIDTHS;
  const showSize = tool === "pen" || tool === "highlighter" || tool === "circle";
  const drawingTool = tool === "pen" || tool === "highlighter" || tool === "circle" || tool === "eraser";

  function reveal(pg: number | null) {
    if (pg === null) return;
    if (modeRef.current === "page") setCurrent(pg);
    else if (pg < range[0] || pg > range[1]) goTo(pg);
  }

  function chooseTool(t: Tool) {
    closeNote();
    setTool(t);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      reveal(e.shiftKey ? redo() : undo());
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      reveal(redo());
    } else if (modeRef.current === "page" && (e.key === "ArrowRight" || e.key === "PageDown")) {
      e.preventDefault();
      goTo(currentRef.current + 1);
    } else if (modeRef.current === "page" && (e.key === "ArrowLeft" || e.key === "PageUp")) {
      e.preventDefault();
      goTo(currentRef.current - 1);
    }
  }

  const cur = clamp(current, 1, Math.max(1, numPages));
  const pageList = mode === "page" ? [cur] : Array.from({ length: numPages }, (_, i) => i + 1);

  let statusText = "";
  if (ann.status === "loading") statusText = "Carregando anotações…";
  else if (ann.status === "saving") statusText = "Salvando…";
  else if (ann.status === "saved") statusText = "Anotações salvas";

  return (
    <div ref={rootRef} className={full ? "pdfnb full" : "pdfnb"} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="pdfnb-bar">
        <span className="pdfnb-name" title={name}>📄 {name}</span>
        <span className="pdfnb-sep" />
        <button type="button" className="pdfnb-btn" aria-label="Página anterior" disabled={cur <= 1} onClick={() => goTo(cur - 1)}>‹</button>
        <span className="pdfnb-page" aria-live="polite">{cur} / {numPages || "–"}</span>
        <button type="button" className="pdfnb-btn" aria-label="Próxima página" disabled={cur >= numPages} onClick={() => goTo(cur + 1)}>›</button>
        <span className="pdfnb-sep" />
        <button type="button" className="pdfnb-btn" aria-label="Diminuir zoom" onClick={() => applyZoom(zoomRef.current / 1.25)}>−</button>
        <button type="button" className="pdfnb-btn" aria-label="Ajustar à largura" title="Ajustar à largura" onClick={() => applyZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="pdfnb-btn" aria-label="Aumentar zoom" onClick={() => applyZoom(zoomRef.current * 1.25)}>＋</button>
        <span className="pdfnb-sep" />
        <button
          type="button"
          className="pdfnb-btn"
          aria-label="Modo de visualização"
          onClick={() => {
            const next: ViewMode = mode === "scroll" ? "page" : "scroll";
            setMode(next);
            if (next === "scroll") {
              requestAnimationFrame(() => {
                const el = pageEls.current[currentRef.current];
                if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - PAD;
              });
            } else {
              scroller.current?.scrollTo({ top: 0, left: 0 });
            }
          }}
        >
          {mode === "scroll" ? "Rolagem" : "Uma página"}
        </button>
        <button type="button" className="pdfnb-btn" aria-pressed={full} onClick={() => setFull((v) => !v)}>
          {full ? "Sair" : "Tela cheia"}
        </button>
        <a className="pdfnb-btn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir o PDF original em outra aba">Original ↗</a>
        {onRemove && (
          <button
            type="button"
            className="pdfnb-btn"
            onClick={() => {
              if (window.confirm("Remover este PDF do caderno? As anotações continuam guardadas.")) onRemove();
            }}
          >
            Remover
          </button>
        )}
      </div>

      <div className="pdfnb-bar" role="toolbar" aria-label="Ferramentas de anotação">
        {TOOLS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={tool === t.id ? "pdfnb-btn on" : "pdfnb-btn"}
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={t.label}
            disabled={t.id !== "hand" && !editable}
            onClick={() => chooseTool(t.id)}
          >
            <span aria-hidden="true">{t.glyph}</span>&nbsp;{t.label}
          </button>
        ))}
        {colorKey && (
          <>
            <span className="pdfnb-sep" />
            {palette.map((c) => (
              <button
                type="button"
                key={c}
                className={c === color ? "swatch picked" : "swatch"}
                style={{ background: c }}
                aria-label={`Cor ${c}`}
                onClick={() => setColors((prev) => ({ ...prev, [colorKey]: c }))}
              />
            ))}
          </>
        )}
        {showSize && (
          <>
            <span className="pdfnb-sep" />
            {widths.map((w, i) => (
              <button
                type="button"
                key={i}
                className={i === sizeIdx ? "pdfnb-btn on" : "pdfnb-btn"}
                aria-label={["Traço fino", "Traço médio", "Traço grosso"][i]}
                onClick={() => setSizeIdx(i)}
              >
                <span className="pdfnb-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
              </button>
            ))}
          </>
        )}
        <span className="pdfnb-sep" />
        <button type="button" className="pdfnb-btn" aria-label="Desfazer" disabled={!ann.canUndo} onClick={() => reveal(undo())}>↶</button>
        <button type="button" className="pdfnb-btn" aria-label="Refazer" disabled={!ann.canRedo} onClick={() => reveal(redo())}>↷</button>
        {drawingTool && (
          <button
            type="button"
            className={fingerDraw ? "pdfnb-btn on" : "pdfnb-btn"}
            aria-pressed={fingerDraw}
            title="Com a opção desligada, só a caneta risca; o dedo rola e dá zoom."
            onClick={() => {
              fingerAuto.current = false;
              setFingerDraw((v) => !v);
            }}
          >
            {fingerDraw ? "Dedo risca" : "Só caneta"}
          </button>
        )}
        <span className="pdfnb-status" role="status">
          {ann.status === "error" && !ann.loadError ? (
            <button type="button" className="pdfnb-btn" onClick={ann.retrySave}>Erro ao salvar — tentar de novo</button>
          ) : (
            statusText
          )}
        </span>
      </div>

      {ann.loadError && (
        <p className="pdfnb-msg">
          Não foi possível carregar as anotações. Confira se rodou o schema5.sql no Supabase.{" "}
          <button type="button" className="pdfnb-btn" onClick={ann.reload}>Tentar de novo</button>
        </p>
      )}

      <div
        ref={scroller}
        className="pdfnb-scroller"
        data-tool={tool}
        onPointerDownCapture={onDownCapture}
        onScroll={onScroll}
      >
        {loadFailed ? (
          <p className="pdfnb-msg">
            Não foi possível abrir este PDF aqui. <a href={url} target="_blank" rel="noopener noreferrer">Abrir em outra aba</a>
          </p>
        ) : !doc ? (
          <p className="pdfnb-msg">Carregando PDF…</p>
        ) : cw > 0 ? (
          <div ref={inner} className="pdfnb-inner">
            {pageList.map((n) => (
              <PdfPageView
                key={n}
                doc={doc}
                n={n}
                width={pageW}
                ratio={ratios[n] ?? defaultRatio}
                active={mode === "page" || (n >= range[0] && n <= range[1])}
                ann={ann.pages[n] ?? EMPTY}
                tool={tool}
                color={color}
                size={widths[sizeIdx]}
                fingerDraw={fingerDraw}
                editable={editable}
                openNoteId={openNote && openNote.page === n ? openNote.id : null}
                registerEl={registerEl}
                onRatio={onRatio}
                onApply={apply}
                onRecord={record}
                onOpenNote={onOpenNote}
                onNoteText={onNoteText}
                onNoteDelete={onNoteDelete}
                claim={claim}
                isPinching={isPinching}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
