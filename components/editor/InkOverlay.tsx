"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INK_COLORS, MARK_COLORS, MARK_WIDTHS, PEN_WIDTHS, uid, type InkItem, type Item } from "../pdf/types";
import { hitItem } from "../pdf/draw";
import { smoothItemCached } from "./ink-smooth";
import { boundsOf, moveItem, pickedByLasso } from "./ink-geometry";
import { recognizeInk } from "./ink-recognize";
import { findMate, joinText } from "./ink-merge";
import { tidyItems } from "./ink-tidy";
import { drawInkItem, scaleLayerItem, strokePressure, type PenInk } from "./ink-pressure";
import { drawText, hitText, isInkLike, loadHandwritingFonts, textFromLine, textInPoly, unionBox, type LayerItem, type TextItem } from "./ink-text";

// Camada de escrita sobre a página inteira. Fica separada do texto (o conteúdo não muda) e é guardada
// junto com a página na chave "inkLayer". Posições: x e y divididos pela LARGURA da página; y conta a partir do topo.
// Além dos traços, a camada guarda os textos digitados criados pela conversão automática.
export type InkLayer = { items: LayerItem[]; smooth: number };

export function readInkLayer(value: unknown): InkLayer {
  const v = value as { items?: unknown; smooth?: unknown } | null | undefined;
  const items = v && Array.isArray(v.items) ? (v.items as LayerItem[]) : [];
  const smooth = v && typeof v.smooth === "number" ? Math.max(0, Math.min(1, v.smooth)) : 0.35;
  return { items, smooth };
}

type Tool = "pen" | "highlighter" | "eraser" | "lasso";

// Fontes para o texto convertido (as quatro primeiras são as do seletor de fonte do editor).
const CONV_FONTS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Sem serifa", v: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { name: "Com serifa", v: 'Georgia, "Times New Roman", serif' },
  { name: "Mono", v: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { name: "Caveat", v: 'Caveat, "Segoe Print", "Bradley Hand", cursive' },
  { name: "Patrick Hand", v: '"Patrick Hand", "Segoe Print", "Bradley Hand", cursive' },
  { name: "Kalam", v: 'Kalam, "Segoe Print", "Bradley Hand", cursive' },
];

const AUTO_DELAY_MS = 2400; // pausa sem escrever antes de converter sozinha (ao passar para outra linha, converte na hora)
const FADE_MS = 320; // duração da transição da letra à mão para o texto
const PUSH_DELAY_MS = 400; // espera antes de enviar a escrita ao editor (salvamento); sai na hora ao concluir

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
  // Duas camadas de desenho: "canvasRef" guarda tudo o que já está pronto; "liveRef" recebe só o traço
  // que está sendo escrito (desenhado aos poucos, sem redesenhar a página inteira a cada movimento).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
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
  const [convFont, setConvFont] = useState(4);
  const [convBusy, setConvBusy] = useState(false);
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convText, setConvText] = useState<string | null>(null);
  const [convIds, setConvIds] = useState<string[]>([]);
  const [convPos, setConvPos] = useState<{ left: number; top: number } | null>(null);
  const [convErase, setConvErase] = useState(true);

  // Conversão automática: depois de uma pausa, a escrita recente vira texto na fonte escolhida, no mesmo lugar
  const [autoOn, setAutoOn] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const autoOnRef = useRef(false);
  autoOnRef.current = autoOn;
  const convFontRef = useRef(convFont);
  convFontRef.current = convFont;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pendingRef = useRef<Set<string>>(new Set());
  const autoTimerRef = useRef(0);
  const autoBusyRef = useRef(false);
  const runAutoRef = useRef<() => void>(() => undefined);
  // Transição da conversão: a letra à mão some aos poucos enquanto o texto aparece.
  const fadeRef = useRef<{ t0: number; gone: Item[]; texts: Set<string> } | null>(null);
  const fadeLoopRef = useRef(0);

  const itemsRef = useRef<LayerItem[]>(layer.items);
  const smoothRef = useRef(smooth);
  smoothRef.current = smooth;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const draftRef = useRef<PenInk | null>(null);
  const lassoRef = useRef<number[] | null>(null);
  const selRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ sx: number; sy: number; base: LayerItem[] } | null>(null);
  // Dois dedos com o laço: aumenta ou diminui o que está selecionado (gesto de pinça).
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; base: LayerItem[]; cx: number; cy: number } | null>(null);
  const undoRef = useRef<LayerItem[][]>([]);
  const redoRef = useRef<LayerItem[][]>([]);
  const pointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const eraseBaseRef = useRef<LayerItem[] | null>(null);
  const penSeenRef = useRef(false);
  const rafRef = useRef(0);
  const liveRafRef = useRef(0);
  const liveDrawnRef = useRef(0); // até qual ponto do traço atual já foi desenhado na camada "viva"
  const dprRef = useRef(1);
  const pushTimerRef = useRef(0);
  const lastPushedRef = useRef<LayerItem[] | null>(null);

  const show = active || layer.items.length > 0;

  // Envia a escrita ao editor (que guarda a página). Durante a escrita isso espera uma pausa curta,
  // para não serializar a página inteira a cada traço; ao concluir, sair da página ou fechar o app, sai na hora.
  const pushNow = () => {
    window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = 0;
    lastPushedRef.current = itemsRef.current;
    onChangeRef.current({ items: itemsRef.current, smooth: smoothRef.current });
  };
  const queuePush = () => {
    window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = 0;
      pushNow();
    }, PUSH_DELAY_MS);
  };
  const flushPush = () => {
    if (pushTimerRef.current) pushNow();
  };

  useEffect(() => {
    const flush = () => {
      if (pushTimerRef.current) pushNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        flush();
      } catch {
        // o editor já pode ter sido fechado
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Redesenha tudo o que já está pronto (traços, textos, laço e seleção). O traço em andamento fica na camada "viva".
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h } = size;
    if (!canvas || !w || !h) return;
    // Páginas muito compridas usam menos pixels por ponto para não estourar a memória do navegador.
    let dpr = Math.min(3, window.devicePixelRatio || 1);
    dpr = Math.max(0.5, Math.min(dpr, Math.sqrt(16000000 / (w * h)), 16000 / h));
    dprRef.current = dpr;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const live = liveRef.current;
    if (live && (live.width !== cw || live.height !== ch)) {
      live.width = cw;
      live.height = ch;
      liveDrawnRef.current = 0; // redimensionar apaga a camada viva: o traço atual é refeito do começo
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Transição da conversão: a escrita à mão some e o texto aparece, em poucos quadros.
    const fade = fadeRef.current;
    let k = 1;
    if (fade) {
      const t = Math.min(1, (performance.now() - fade.t0) / FADE_MS);
      k = t * t * (3 - 2 * t);
      if (t >= 1) fadeRef.current = null;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      for (const g of fade.gone) drawInkItem(ctx, smoothItemCached(g, smooth), w);
      ctx.restore();
    }
    for (const it of itemsRef.current) {
      if (it.kind === "text") {
        if (fade && fade.texts.has(it.id)) {
          ctx.save();
          ctx.globalAlpha = k;
          drawText(ctx, it, w);
          ctx.restore();
        } else {
          drawText(ctx, it, w);
        }
      } else {
        drawInkItem(ctx, smoothItemCached(it, smooth), w);
      }
    }
    if (fadeRef.current && !fadeLoopRef.current) {
      fadeLoopRef.current = requestAnimationFrame(() => {
        fadeLoopRef.current = 0;
        paintRef.current();
      });
    }

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
    const box = unionBox(itemsRef.current, selRef.current, w);
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

  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    paint();
  }, [paint]);

  // Mudanças vindas de fora (desfazer do editor, outra aba) atualizam o desenho.
  // O que nós mesmos enviamos ao editor não precisa ser redesenhado.
  useEffect(() => {
    if (layer.items === lastPushedRef.current || pushTimerRef.current) return;
    itemsRef.current = layer.items;
    paintRef.current();
  }, [layer.items]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(liveRafRef.current);
      cancelAnimationFrame(fadeLoopRef.current);
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

  // Desenha só o pedaço novo do traço em andamento (curvas suaves entre os pontos médios), sem apagar nada.
  // Obs.: sem a opção "desynchronized" do canvas. Em páginas compridas alguns tablets pintavam a camada inteira
  // de preto ao escrever; o traço continua fluido porque só o pedaço novo é desenhado.
  const drawLive = () => {
    const d = draftRef.current;
    const canvas = liveRef.current;
    const w = sizeRef.current.w;
    if (!d || !canvas || !w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = Math.max(1, d.width * w);
    const p = d.pts;
    const n = p.length / 2;
    const X = (i: number) => p[2 * i] * w;
    const Y = (i: number) => p[2 * i + 1] * w;
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(X(0), Y(0), ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Caneta com pressão (S Pen): cada pedaço do traço sai com a espessura da pressão naquele ponto.
    const pr = d.pr;
    if (pr && pr.length === n) {
      liveDrawnRef.current = strokePressure(ctx, p, pr, w, ctx.lineWidth, liveDrawnRef.current);
      return;
    }
    const k = liveDrawnRef.current;
    ctx.beginPath();
    if (k === 0) ctx.moveTo(X(0), Y(0));
    else ctx.moveTo((X(k) + X(k + 1)) / 2, (Y(k) + Y(k + 1)) / 2);
    let last = k;
    for (let i = k + 1; i <= n - 2; i++) {
      ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
      last = i;
    }
    ctx.lineTo(X(n - 1), Y(n - 1)); // ponta do traço sempre acompanha a caneta
    ctx.stroke();
    liveDrawnRef.current = last;
  };

  const scheduleLive = () => {
    if (liveRafRef.current) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = 0;
      drawLive();
    });
  };

  const clearLive = () => {
    const canvas = liveRef.current;
    liveDrawnRef.current = 0;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Ao levantar a caneta: o traço pronto é desenhado direto na camada principal (sem redesenhar a página).
  const drawFinished = (it: Item) => {
    const canvas = canvasRef.current;
    const w = sizeRef.current.w;
    if (!canvas || !w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawInkItem(ctx, smoothItemCached(it, smoothRef.current), w);
  };

  // Carrega as fontes manuscritas e redesenha quando ficarem prontas.
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  useEffect(() => {
    loadHandwritingFonts(() => scheduleRef.current());
  }, []);

  const setSelection = (ids: string[]) => {
    selRef.current = new Set(ids);
    setSelIds(ids);
    schedule();
  };

  const stopAuto = () => {
    window.clearTimeout(autoTimerRef.current);
    pendingRef.current = new Set();
  };

  // Ao abrir ou fechar a camada, volta ao estado inicial.
  useEffect(() => {
    if (active) {
      setWriting(true);
      penSeenRef.current = false;
    } else {
      flushPush();
      selRef.current = new Set();
      setSelIds([]);
      lassoRef.current = null;
      draftRef.current = null;
      touchesRef.current.clear();
      pinchRef.current = null;
      clearLive();
      setConvOpen(false);
      setConvText(null);
      setConvErr(null);
      setAutoMsg(null);
      window.clearTimeout(autoTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => window.clearTimeout(autoTimerRef.current), []);

  const commit = (next: LayerItem[], base: LayerItem[]) => {
    undoRef.current.push(base);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    itemsRef.current = next;
    queuePush();
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
    const rest = itemsRef.current.filter((it) => (it.kind === "text" ? !hitText(it, x, y, w, 10) : !hitItem(it, x, y, w, w, 10)));
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

  // Conversão automática: lê a escrita recente, troca os traços por texto na fonte escolhida (um item por linha).
  const armAuto = () => {
    window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = window.setTimeout(() => runAutoRef.current(), AUTO_DELAY_MS);
  };

  // "only": converte só estes traços (a linha que ficou para trás); sem ele, converte tudo o que está esperando.
  const runAuto = async (only?: Set<string>) => {
    if (autoBusyRef.current) {
      if (only) only.forEach((id) => pendingRef.current.add(id));
      armAuto();
      return;
    }
    const ids = only ?? pendingRef.current;
    if (!only) pendingRef.current = new Set();
    const src = itemsRef.current.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && ids.has(it.id));
    const w = sizeRef.current.w;
    if (!src.length || !w) return;
    autoBusyRef.current = true;
    setAutoMsg("Convertendo…");
    try {
      const { lines, failed } = await recognizeInk(src, w);
      const font = CONV_FONTS[convFontRef.current].v;
      const base = itemsRef.current;
      const gone = new Set(lines.flatMap((l) => l.ids));
      const existing = base.filter((it): it is TextItem => it.kind === "text");
      const updated = new Map<string, TextItem>();
      const current = () => existing.map((t) => updated.get(t.id) ?? t);
      const fresh: TextItem[] = [];
      // Pedaço que continua uma linha já convertida (pausa no meio da frase, ou escrita durante a conversão)
      // entra no mesmo texto, com o mesmo tamanho e a mesma altura, em vez de virar outro texto solto.
      for (const l of lines) {
        const mate = findMate(current(), l, w);
        const joined = mate ? joinText(mate, l.text, /^[.,;:!?)\]]/.test(l.text), w) : null;
        if (joined) updated.set(joined.id, joined);
        else fresh.push(textFromLine(l, w, font));
      }
      // Ponto ou vírgula escritos sozinhos depois da conversão: vão para o fim do texto da mesma linha.
      for (const it of src) {
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
        const atOrBelowMiddle = (at.top + at.bottom) / 2 >= mate.y * w - px * 0.15; // acento fica acima do meio da letra
        if (!small || bw > bh * 1.8 || !atOrBelowMiddle) continue;
        const joined = joinText(mate, bh >= bw * 1.8 ? "," : ".", true, w);
        if (!joined) continue;
        updated.set(joined.id, joined);
        gone.add(it.id);
      }
      if (gone.size || fresh.length || updated.size) {
        fadeRef.current = {
          t0: performance.now(),
          gone: base.filter((it): it is Item => it.kind !== "text" && gone.has(it.id)),
          texts: new Set(fresh.map((t) => t.id)),
        };
        const kept = base.filter((it) => !gone.has(it.id)).map((it): LayerItem => (it.kind === "text" ? (updated.get(it.id) ?? it) : it));
        commit([...kept, ...fresh], base);
        schedule();
      }
      setAutoMsg(failed ? `${failed} ${failed === 1 ? "linha ficou" : "linhas ficaram"} como escrita à mão (não reconhecida).` : null);
    } catch (e) {
      setAutoMsg(e instanceof Error ? e.message : "Não consegui converter agora.");
    } finally {
      autoBusyRef.current = false;
    }
  };
  runAutoRef.current = () => {
    void runAuto();
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !writing || !size.w) return;
    if (e.pointerType === "pen") {
      penSeenRef.current = true;
      touchesRef.current.clear();
    }
    // Laço com algo selecionado: dois dedos na tela aumentam ou diminuem a seleção (gesto de pinça).
    // Isso vale mesmo com a S Pen em uso; toques largos (palma da mão) são ignorados.
    if (e.pointerType === "touch" && tool === "lasso" && selRef.current.size) {
      if (Math.max(e.width, e.height) <= 60) touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchesRef.current.size === 2 && !pinchRef.current) {
        const [a, b] = Array.from(touchesRef.current.values());
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        const box = unionBox(itemsRef.current, selRef.current, size.w);
        if (box && d0 > 10) {
          e.preventDefault();
          // O primeiro dedo pode ter começado a arrastar: volta ao ponto de partida antes de redimensionar.
          if (dragRef.current) {
            itemsRef.current = dragRef.current.base;
            dragRef.current = null;
          }
          lassoRef.current = null;
          pointerRef.current = null;
          pinchRef.current = { d0, base: itemsRef.current, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2 };
          schedule();
          return;
        }
      }
    }
    // Com a S Pen em uso, a palma da mão (toque) é ignorada.
    if (penSeenRef.current && e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerRef.current = e.pointerId;
    window.clearTimeout(autoTimerRef.current); // voltou a escrever: espera a próxima pausa
    const [x, y] = toPoint(e.clientX, e.clientY);

    if (tool === "lasso") {
      const box = unionBox(itemsRef.current, selRef.current, size.w);
      const slack = e.pointerType === "touch" ? 0.06 : 0.015; // com o dedo, a área de pegar a seleção é maior
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
    clearLive();
    // Só a caneta (S Pen) guarda a pressão; dedo, mouse e marca-texto continuam com espessura constante.
    const pr0 = !marker && e.pointerType === "pen" ? [Math.round((e.pressure > 0 ? e.pressure : 0.5) * 100) / 100] : null;
    draftRef.current = {
      id: uid(),
      kind: "ink",
      tool: marker ? "highlighter" : "pen",
      color: colorFor(marker),
      width: marker ? MARK_WIDTHS[sizeIdx] : PEN_WIDTHS[sizeIdx],
      pts: [x, y],
      ...(pr0 ? { pr: pr0 } : {}),
    };
    scheduleLive();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pin = pinchRef.current;
      if (pin) {
        e.preventDefault();
        const [a, b] = Array.from(touchesRef.current.values());
        if (a && b) {
          const s = Math.max(0.2, Math.min(6, Math.hypot(a.x - b.x, a.y - b.y) / pin.d0));
          itemsRef.current = pin.base.map((it) => (selRef.current.has(it.id) ? scaleLayerItem(it, s, pin.cx, pin.cy) : it));
          schedule();
        }
        return;
      }
    }
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
        itemsRef.current = base.map((it): LayerItem => {
          if (!selRef.current.has(it.id)) return it;
          return it.kind === "text" ? { ...it, x: it.x + dx, y: it.y + dy } : moveItem(it, dx, dy);
        });
      } else if (lassoRef.current) {
        lassoRef.current.push(x, y);
      } else if (erasingRef.current) {
        eraseAt(x, y);
      } else if (draftRef.current) {
        const p = draftRef.current.pts;
        const lx = p[p.length - 2];
        const ly = p[p.length - 1];
        if (Math.hypot(x - lx, y - ly) * size.w >= 0.6) {
          p.push(x, y);
          const pr = draftRef.current.pr;
          if (pr) {
            // pressão suavizada para a espessura não "tremer"
            const raw = ev.pressure > 0 ? ev.pressure : 0.5;
            pr.push(Math.round((pr[pr.length - 1] * 0.6 + raw * 0.4) * 100) / 100);
          }
        }
      }
    }
    // Escrevendo perto da borda da tela: a página rola junto.
    if (draftRef.current) {
      if (e.clientY > window.innerHeight - 150) window.scrollBy(0, 14);
      else if (e.clientY < 50) window.scrollBy(0, -14);
      scheduleLive();
    } else {
      schedule();
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchesRef.current.delete(e.pointerId)) {
      const pin = pinchRef.current;
      if (pin) {
        // Ao soltar um dos dedos, a pinça termina e o novo tamanho entra no histórico (↶ desfaz).
        if (touchesRef.current.size < 2) {
          pinchRef.current = null;
          if (pin.base !== itemsRef.current) commit(itemsRef.current, pin.base);
          schedule();
        }
        return;
      }
    }
    if (e.pointerId !== pointerRef.current) return;
    pointerRef.current = null;

    if (dragRef.current) {
      const { base } = dragRef.current;
      dragRef.current = null;
      if (base !== itemsRef.current) commit(itemsRef.current, base);
      schedule();
      return;
    }
    if (lassoRef.current) {
      const poly = lassoRef.current;
      lassoRef.current = null;
      const ids =
        poly.length >= 6
          ? itemsRef.current.filter((it) => (it.kind === "text" ? textInPoly(it, poly, size.w) : pickedByLasso(it, poly))).map((it) => it.id)
          : [];
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
    if (d) {
      commit([...itemsRef.current, d], itemsRef.current);
      drawFinished(d);
      clearLive();
      if (autoOnRef.current && d.tool === "pen") {
        // Se este traço começou outra linha, a linha anterior já está pronta e é convertida agora.
        // Se continua na mesma linha, espera a pausa para não converter no meio da escrita.
        const before = pendingRef.current;
        if (before.size) {
          const ink = itemsRef.current.filter(isInkLike);
          const pb = boundsOf(ink, before);
          const nb = boundsOf(ink, new Set([d.id]));
          if (pb && nb) {
            const overlap = Math.min(pb[3], nb[3]) - Math.max(pb[1], nb[1]);
            const minH = Math.min(pb[3] - pb[1], nb[3] - nb[1]);
            if (overlap < 0.3 * minH) {
              pendingRef.current = new Set();
              void runAuto(new Set(before));
            }
          }
        }
        pendingRef.current.add(d.id);
        armAuto();
      }
    }
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(itemsRef.current);
    itemsRef.current = prev;
    fadeRef.current = null;
    pushNow();
    setSelection([]);
    setTick((t) => t + 1);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(itemsRef.current);
    itemsRef.current = next;
    fadeRef.current = null;
    pushNow();
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
    commit(base.filter((it) => !selRef.current.has(it.id)), base);
    setSelection([]);
  };

  const duplicateSelection = () => {
    const base = itemsRef.current;
    const copies = base
      .filter((it) => selRef.current.has(it.id))
      .map((it) => ({ ...(it.kind === "text" ? { ...it, x: it.x + 0.03, y: it.y + 0.03 } : moveItem(it, 0.03, 0.03)), id: uid() }) as LayerItem);
    if (!copies.length) return;
    commit([...base, ...copies], base);
    setSelection(copies.map((it) => it.id));
  };

  const recolorSelection = () => {
    const base = itemsRef.current;
    commit(
      base.map((it): LayerItem => {
        if (!selRef.current.has(it.id)) return it;
        if (it.kind === "text") return { ...it, color: colorFor(false) };
        return { ...it, color: colorFor(it.kind === "ink" && it.tool === "highlighter") };
      }),
      base
    );
    schedule();
  };

  const commitSmooth = () => {
    if (Math.abs(smoothRef.current - layer.smooth) > 0.001) pushNow();
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
    const ink = base.filter(isInkLike);
    const target = picked.size ? ink.filter((it) => picked.has(it.id)) : ink;
    const tidied = tidyItems(target, size.w, tidyAmt);
    const byId = new Map(tidied.map((it) => [it.id, it] as const));
    commit(base.map((it): LayerItem => (it.kind === "text" ? it : (byId.get(it.id) ?? it))), base);
    schedule();
  };

  // Reconhece a escrita (da seleção com o laço, ou da página toda) e mostra o texto para conferir antes de inserir.
  const convert = async () => {
    if (convBusy) return;
    const ink = itemsRef.current.filter(isInkLike);
    const src = selRef.current.size ? ink.filter((it) => selRef.current.has(it.id)) : ink;
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
      commit(base.filter((it) => !ids.has(it.id)), base);
      setSelection([]);
      schedule();
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
      {/* Camada só para o traço que está sendo escrito (o marca-texto fica translúcido aqui, sem escurecer onde se cruza). */}
      <canvas
        ref={liveRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 6,
          pointerEvents: "none",
          opacity: tool === "highlighter" ? 0.4 : 1,
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
          {autoMsg && <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>{autoMsg}</p>}
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
                        style={{ ...btn(convFont === i), fontSize: 15, fontFamily: f.v ?? undefined }}
                        onClick={() => setConvFont(i)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={autoOn}
                      onChange={(e) => {
                        setAutoOn(e.target.checked);
                        if (!e.target.checked) {
                          stopAuto();
                          setAutoMsg(null);
                        }
                      }}
                    />
                    Converter sozinha quando eu parar de escrever
                  </label>
                  {autoOn && (
                    <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                      Escreva uma linha e faça uma pausa de 2 a 3 segundos, ou comece a escrever na linha de baixo: a letra vira texto na fonte escolhida, no mesmo lugar e na mesma cor. Desenhos também podem ser convertidos sem querer; ↶ desfaz. Precisa de internet.
                    </p>
                  )}
                  <div style={row}>
                    <button type="button" style={{ ...btn(false, convBusy), fontWeight: 700 }} disabled={convBusy} onClick={convert}>
                      {convBusy
                        ? "Reconhecendo…"
                        : selIds.length
                          ? `Inserir no texto da página: os ${selIds.length} selecionados`
                          : "Inserir toda a escrita no texto da página"}
                    </button>
                  </div>
                  {convErr && <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{convErr}</p>}
                  <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                    O botão acima converte uma vez e coloca o resultado no texto da página, para você editar. Use o ⬚ Laço para escolher só um trecho.
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
            <button type="button" aria-label="Laço: selecionar, mover, aumentar com dois dedos e apagar traços" style={btn(tool === "lasso")} onClick={() => pickTool("lasso")}>⬚ Laço</button>
            <button type="button" aria-label="Aperfeiçoar escrita" style={btn(enhance)} onClick={() => setEnhance((v) => !v)}>✨</button>
            <button
              type="button"
              aria-label="Converter escrita em texto digitado"
              style={btn(convOpen || autoOn)}
              onClick={() => {
                setConvOpen((v) => !v);
                setConvText(null);
                setConvErr(null);
              }}
            >
              {autoOn ? "Aa ●" : "Aa"}
            </button>
            <button type="button" aria-label="Desfazer" disabled={!undoRef.current.length} style={btn(false, !undoRef.current.length)} onClick={undo}>↶</button>
            <button type="button" aria-label="Refazer" disabled={!redoRef.current.length} style={btn(false, !redoRef.current.length)} onClick={redo}>↷</button>
            <button type="button" aria-label="Apagar toda a escrita sobre a página" style={btn()} onClick={clearAll}>Limpar</button>
            <button
              type="button"
              aria-label="Concluir e voltar a editar o texto"
              style={{ ...btn(), fontWeight: 700 }}
              onClick={() => {
                flushPush();
                onClose();
              }}
            >
              Concluir
            </button>
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
