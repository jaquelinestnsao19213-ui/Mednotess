"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INK_COLORS, MARK_COLORS, MARK_WIDTHS, PEN_WIDTHS, uid, type InkItem, type Item } from "../pdf/types";
import { hitItem, isMarker } from "../pdf/draw";
import { smoothItemCached } from "./ink-smooth";
import { boundsOf, moveItem, pickedByLasso } from "./ink-geometry";
import { recognizeInk, shapeIds, type Anchor } from "./ink-recognize";
import { recognizeShape } from "./ink-shapes";
import { findMate, joinText } from "./ink-merge";
import { tidyItems } from "./ink-tidy";
import { drawInkItem, scaleLayerItem, strokePressure, type PenInk } from "./ink-pressure";
import { drawText, hitText, isInkLike, loadHandwritingFonts, textBounds, textFromLine, textInPoly, unionBox, type LayerItem, type TextItem } from "./ink-text";

// Camada de escrita sobre a página inteira. Fica separada do texto (o conteúdo não muda) e é guardada
// junto com a página na chave "inkLayer". Posições: x e y divididos pela LARGURA da página; y conta a partir do topo.
// Além dos traços, a camada guarda os textos digitados criados pela conversão automática.
export type InkLayer = { items: LayerItem[]; smooth: number };

// Aviso do editor: o texto digitado cresceu ou encolheu "dy" pixels a partir da altura "y" (em pixels, a contar do topo da página).
// Tudo o que está escrito à mão abaixo desse ponto acompanha o texto. "n" muda a cada aviso.
export type InkReflow = { n: number; y: number; dy: number };

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

const FADE_MS = 320; // (não usado mais na conversão: o texto aparece na hora; fica só para o desenho antigo)
const GHOST_A = 0.18; // (idem: a letra à mão não fica mais clarinha atrás do texto depois de converter)
const HOVER_EXTRA_MS = 1500; // caneta parada pairando sobre a tela: a conversão sai depois da pausa mais esse tempo
const PUSH_DELAY_MS = 1500; // espera antes de enviar a escrita ao editor (salvamento); sai na hora ao concluir
const PREFETCH_MS = 2300; // pausa depois de um traço: a leitura da escrita começa em segundo plano, para "converter" sair na hora (mais pausa = menos chamadas à IA)
const PALM_PX = 60; // toque maior que isso é palma da mão, não dedo
const PREFS_KEY = "mednotes-ink-prefs"; // preferências de conversão guardadas no aparelho (fonte e pausa)
const PEN_AWAY_MS = 350; // modo automático: tempo sem a caneta perto da tela até o dedo voltar a mexer no texto
const BAR_IDLE_MS = 10000; // modo automático: a barra de ferramentas some depois desse tempo sem a caneta
const TAP_MS = 250; // toque rápido da caneta (sem arrastar) conta como "toque", não como traço
const TAP_MOVE_PX = 6; // quanto a caneta pode se mexer e ainda ser um toque
const DOUBLE_TAP_MS = 400; // dois toques da caneta nesse intervalo e perto um do outro = colocar o cursor ali
const DOUBLE_TAP_PX = 30;
const SEL_TAP_PX = 6; // com o laço, tocar num texto sem arrastar mais que isso abre a correção do texto
const HOLD_MS = 550; // caneta parada no fim do traço por esse tempo: a forma é corrigida (reta, seta, retângulo)
const HOLD_JITTER_PX = 5; // tremor da mão que ainda conta como "parada"
const SNAP_CANCEL_PX = 10; // se a caneta se mexe mais que isso depois da forma aparecer, volta ao traço livre

// Traço que já é uma forma corrigida automaticamente (reta, seta, retângulo): nunca vira texto.
function isShape(it: unknown): boolean {
  return !!(it as { shape?: boolean } | null)?.shape;
}

// Coloca o cursor do texto no ponto da tela (x, y). A camada de escrita fica por cima da página,
// então ela é "desligada" por um instante para o navegador achar o texto que está por baixo.
function placeCaretAt(canvas: HTMLCanvasElement | null, x: number, y: number) {
  const prev = canvas?.style.pointerEvents ?? "";
  if (canvas) canvas.style.pointerEvents = "none";
  try {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(x, y);
    } else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p) {
        range = document.createRange();
        range.setStart(p.offsetNode, p.offset);
        range.collapse(true);
      }
    }
    if (!range) return;
    const node = range.startContainer;
    const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>('[contenteditable="true"]');
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // navegador sem suporte: o dedo continua servindo para tocar no texto
  } finally {
    if (canvas) canvas.style.pointerEvents = prev;
  }
}

export default function InkOverlay({
  layer,
  onChange,
  active,
  onClose,
  auto = false,
  onAutoChange,
  reflow = null,
}: {
  layer: InkLayer;
  onChange: (next: InkLayer) => void;
  active: boolean;
  onClose: () => void;
  // Caneta automática: a caneta escreve direto; dedo e teclado continuam digitando e rolando a página.
  auto?: boolean;
  onAutoChange?: (v: boolean) => void;
  reflow?: InkReflow | null;
}) {
  // Duas camadas de desenho: "canvasRef" guarda tudo o que já está pronto; "liveRef" recebe só o traço
  // que está sendo escrito (desenhado aos poucos, sem redesenhar a página inteira a cada movimento).
  // O marca-texto fica numa camada à parte ("markRef"), atrás da escrita e misturada com o texto da página (multiply):
  // a cor aparece por trás das letras, que continuam escuras e legíveis.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);
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

  // Formas automáticas: segurar a caneta parada no fim do traço endireita retas, setas e retângulos.
  const [shapesOn, setShapesOn] = useState(true);
  const shapesOnRef = useRef(true);
  shapesOnRef.current = shapesOn;
  const holdTimerRef = useRef(0);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  // Forma já reconhecida (enquanto a caneta ainda está na tela): pontos prontos e onde a caneta estava.
  const snapRef = useRef<{ pts: number[]; cx: number; cy: number } | null>(null);

  // Caneta automática: "penNear" = a caneta está sobre a página (o desenho captura só a caneta);
  // "barOn" = a barra de ferramentas está visível (some sozinha quando você só digita).
  const [penNear, setPenNear] = useState(false);
  const [barOn, setBarOn] = useState(true);
  const penNearTimerRef = useRef(0);
  const barTimerRef = useRef(0);
  const lastReflowRef = useRef(0);
  // Toque da caneta: começo do gesto atual e o último toque (para o toque duplo que coloca o cursor no texto).
  const tapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ id: string; t: number; x: number; y: number } | null>(null);

  // Converter escrita em texto digitado
  const [convOpen, setConvOpen] = useState(false);
  const [convSettings, setConvSettings] = useState(false);
  const [convFont, setConvFont] = useState(4);
  const [convBusy, setConvBusy] = useState(false);
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convText, setConvText] = useState<string | null>(null);
  const [convIds, setConvIds] = useState<string[]>([]);
  const [convPos, setConvPos] = useState<{ left: number; top: number } | null>(null);
  const [convErase, setConvErase] = useState(true);

  // Corrigir o texto já convertido, direto no lugar (cada linha vira um campo de texto).
  const [editIds, setEditIds] = useState<string[] | null>(null);
  const editBaseRef = useRef<LayerItem[] | null>(null);
  // Textos que acabaram de ser convertidos (para o botão "Corrigir" logo depois da conversão automática).
  const [lastConv, setLastConv] = useState<string[]>([]);
  // (Não é mais usado na conversão: a letra à mão some na hora. Fica só para limpar o desenho antigo.)
  const ghostRef = useRef<Item[] | null>(null);
  const ghostTimerRef = useRef(0);

  // Conversão automática: depois de uma pausa (que você escolhe), a escrita recente vira texto na fonte escolhida, no mesmo lugar
  const [autoOn, setAutoOn] = useState(false);
  const [autoDelay, setAutoDelay] = useState(2); // segundos de pausa antes de converter sozinha
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const autoOnRef = useRef(false);
  autoOnRef.current = autoOn;
  const autoDelayRef = useRef(autoDelay);
  autoDelayRef.current = autoDelay;
  const convFontRef = useRef(convFont);
  convFontRef.current = convFont;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pendingRef = useRef<Set<string>>(new Set());
  const autoTimerRef = useRef(0);
  const autoBusyRef = useRef(false);
  const runAutoRef = useRef<() => void>(() => undefined);
  // Leitura da escrita em segundo plano: só dos traços escritos nesta sessão; o resultado fica guardado para o "converter" sair na hora.
  const prefetchTimerRef = useRef(0);
  const sessionInkRef = useRef<Set<string>>(new Set());
  // S Pen sobre a área de escrita (tocando ou pairando): a contagem da pausa só começa quando ela sai.
  const penHoverRef = useRef(false);
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
  // Dois dedos: com o laço e algo selecionado, aumentam ou diminuem a seleção (pinça); nos demais casos, movem a página.
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; base: LayerItem[]; cx: number; cy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const undoRef = useRef<LayerItem[][]>([]);
  const redoRef = useRef<LayerItem[][]>([]);
  const pointerRef = useRef<number | null>(null);
  const drawTypeRef = useRef("");
  const erasingRef = useRef(false);
  const eraseBaseRef = useRef<LayerItem[] | null>(null);
  const penSeenRef = useRef(false);
  const rafRef = useRef(0);
  const liveRafRef = useRef(0);
  const liveDrawnRef = useRef(0); // até qual ponto do traço atual já foi desenhado na camada "viva"
  const dprRef = useRef(1);
  const pushTimerRef = useRef(0);
  const lastPushedRef = useRef<LayerItem[] | null>(null);
  const prefsLoadedRef = useRef(false);

  const show = active || layer.items.length > 0;

  // Preferências de conversão (fonte e pausa) e das formas automáticas: lembradas entre cadernos e sessões.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { convFont?: unknown; autoDelay?: unknown; shapesOn?: unknown } | null;
        if (p && typeof p.convFont === "number" && Number.isInteger(p.convFont) && p.convFont >= 0 && p.convFont < CONV_FONTS.length) {
          setConvFont(p.convFont);
        }
        if (p && typeof p.autoDelay === "number" && p.autoDelay >= 2 && p.autoDelay <= 10) {
          setAutoDelay(Math.round(p.autoDelay));
        }
        if (p && typeof p.shapesOn === "boolean") {
          setShapesOn(p.shapesOn);
        }
      }
    } catch {
      // armazenamento indisponível: segue com os valores padrão
    }
    prefsLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ convFont, autoDelay, shapesOn }));
    } catch {
      // armazenamento indisponível: a preferência vale só nesta sessão
    }
  }, [convFont, autoDelay, shapesOn]);

  // Envia a escrita ao editor (que guarda a página). Durante a escrita isso espera uma pausa mais longa,
  // para não serializar a página inteira (e travar o próximo traço) a cada palavra; ao concluir, sair da página ou fechar o app, sai na hora.
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
      // Caneta no meio de um traço: o salvamento espera mais um pouco para não atrapalhar a escrita.
      if (pointerRef.current !== null) {
        queuePush();
        return;
      }
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
    const mark = markRef.current;
    if (mark && (mark.width !== cw || mark.height !== ch)) {
      mark.width = cw;
      mark.height = ch;
    }
    const mctx = mark?.getContext("2d") ?? null;
    if (mctx) {
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, w, h);
    }

    // Transição da conversão: a escrita à mão some (até ficar clarinha) e o texto aparece, em poucos quadros.
    const fade = fadeRef.current;
    let k = 1;
    if (fade) {
      const t = Math.min(1, (performance.now() - fade.t0) / FADE_MS);
      k = t * t * (3 - 2 * t);
      if (t >= 1) {
        fadeRef.current = null;
      } else {
        ctx.save();
        ctx.globalAlpha = Math.max(ghostRef.current ? GHOST_A : 0, 1 - k);
        for (const g of fade.gone) drawInkItem(ctx, smoothItemCached(g, smooth), w);
        ctx.restore();
      }
    }
    // A letra à mão que virou texto fica clarinha por alguns segundos, para você conferir se o app leu certo.
    const ghost = ghostRef.current;
    if (ghost && !fadeRef.current) {
      ctx.save();
      ctx.globalAlpha = GHOST_A;
      for (const g of ghost) drawInkItem(ctx, smoothItemCached(g, smooth), w);
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
        drawInkItem(isMarker(it) && mctx ? mctx : ctx, smoothItemCached(it, smooth), w);
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
      window.clearTimeout(penNearTimerRef.current);
      window.clearTimeout(barTimerRef.current);
      window.clearTimeout(ghostTimerRef.current);
      window.clearTimeout(holdTimerRef.current);
      window.clearTimeout(prefetchTimerRef.current);
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

  // Desenha na hora (sem esperar o próximo quadro): o ponto aparece assim que a caneta encosta e o traço acompanha cada movimento.
  const drawLiveNow = () => {
    if (liveRafRef.current) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = 0;
    }
    drawLive();
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

  // Formas automáticas. A cada movimento da caneta a contagem recomeça; se ela ficar parada no fim do traço
  // por HOLD_MS, o traço é comparado com reta, seta e retângulo e, se parecer com um deles, a forma perfeita
  // aparece no lugar (ainda com a caneta na tela). Ao levantar a caneta, a forma fica; se a caneta se mexer
  // de novo antes disso, a forma some e o traço continua livre.
  const clearHold = () => {
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = 0;
    holdAnchorRef.current = null;
  };

  const snapNow = () => {
    const d = draftRef.current;
    const anchor = holdAnchorRef.current;
    const w = sizeRef.current.w;
    if (!d || !anchor || snapRef.current || !w || !shapesOnRef.current) return;
    const shape = recognizeShape(d.pts, w);
    if (!shape) return;
    snapRef.current = { pts: shape.pts, cx: anchor.x, cy: anchor.y };
    clearLive();
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawInkItem(ctx, { ...d, pts: shape.pts, pr: undefined, shape: true } as unknown as Item, w);
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(12);
    } catch {
      // aparelho sem vibração: a forma aparece do mesmo jeito
    }
  };

  const armHold = (cx: number, cy: number) => {
    window.clearTimeout(holdTimerRef.current);
    holdAnchorRef.current = { x: cx, y: cy };
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = 0;
      snapNow();
    }, HOLD_MS);
  };

  // Ao levantar a caneta: o traço pronto é desenhado direto na camada principal (sem redesenhar a página).
  const drawFinished = (it: Item) => {
    const canvas = isMarker(it) && markRef.current ? markRef.current : canvasRef.current;
    const w = sizeRef.current.w;
    if (!canvas || !w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawInkItem(ctx, smoothItemCached(it, smoothRef.current), w);
  };

  // Um segundo dedo encostou: o que estava sendo feito com o primeiro (traço, borracha, laço) é descartado
  // e os dois dedos passam a mover a página.
  const cancelGesture = () => {
    if (dragRef.current) {
      itemsRef.current = dragRef.current.base;
      dragRef.current = null;
    }
    if (erasingRef.current) {
      erasingRef.current = false;
      if (eraseBaseRef.current) itemsRef.current = eraseBaseRef.current;
      eraseBaseRef.current = null;
    }
    lassoRef.current = null;
    draftRef.current = null;
    clearHold();
    snapRef.current = null;
    pointerRef.current = null;
    clearLive();
    schedule();
  };

  const touchCentroid = () => {
    const pts = Array.from(touchesRef.current.values());
    if (pts.length < 2) return null;
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
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
      clearHold();
      snapRef.current = null;
      touchesRef.current.clear();
      pinchRef.current = null;
      panRef.current = null;
      penHoverRef.current = false;
      tapRef.current = null;
      lastTapRef.current = null;
      ghostRef.current = null;
      editBaseRef.current = null;
      window.clearTimeout(prefetchTimerRef.current);
      clearLive();
      setConvOpen(false);
      setConvText(null);
      setConvErr(null);
      setEditIds(null);
      setLastConv([]);
      setAutoMsg(null);
      window.clearTimeout(autoTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Trocar entre escrever e rolar zera os dedos que estavam na tela.
  useEffect(() => {
    touchesRef.current.clear();
    pinchRef.current = null;
    panRef.current = null;
  }, [writing]);

  useEffect(() => () => window.clearTimeout(autoTimerRef.current), []);

  // O aviso "Convertido" (com o botão Corrigir) some sozinho depois de alguns segundos.
  useEffect(() => {
    if (autoMsg !== "Convertido.") return;
    const t = window.setTimeout(() => {
      setAutoMsg((m) => (m === "Convertido." ? null : m));
      setLastConv([]);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [autoMsg]);

  // Mostra a barra de ferramentas e programa o sumiço dela (só no modo automático).
  const showBar = useCallback(() => {
    setBarOn(true);
    window.clearTimeout(barTimerRef.current);
    barTimerRef.current = window.setTimeout(() => {
      barTimerRef.current = 0;
      setBarOn(false);
    }, BAR_IDLE_MS);
  }, []);

  useEffect(() => {
    if (active && auto) {
      showBar();
    } else {
      window.clearTimeout(barTimerRef.current);
      window.clearTimeout(penNearTimerRef.current);
      setBarOn(true);
      setPenNear(false);
    }
  }, [active, auto, showBar]);

  // Caneta automática: enquanto a caneta está perto da página, o desenho captura só ela.
  // Sem a caneta por perto, dedo e teclado voltam a mexer no texto (tocar para digitar, arrastar para rolar).
  useEffect(() => {
    const host = canvasRef.current?.parentElement;
    if (!host || !active || !auto) return;
    const onNear = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      window.clearTimeout(penNearTimerRef.current);
      penNearTimerRef.current = 0;
      setPenNear(true);
      showBar();
    };
    const onFar = (e: PointerEvent) => {
      if (e.pointerType !== "pen" || pointerRef.current !== null) return;
      window.clearTimeout(penNearTimerRef.current);
      penNearTimerRef.current = window.setTimeout(() => {
        penNearTimerRef.current = 0;
        setPenNear(false);
      }, PEN_AWAY_MS);
    };
    host.addEventListener("pointermove", onNear, { passive: true });
    host.addEventListener("pointerdown", onNear, { passive: true });
    host.addEventListener("pointerleave", onFar, { passive: true });
    return () => {
      host.removeEventListener("pointermove", onNear);
      host.removeEventListener("pointerdown", onNear);
      host.removeEventListener("pointerleave", onFar);
    };
  }, [active, auto, show, showBar]);

  const commit = (next: LayerItem[], base: LayerItem[]) => {
    undoRef.current.push(base);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    itemsRef.current = next;
    queuePush();
    setTick((t) => t + 1);
  };

  // O texto digitado cresceu (ou encolheu): a escrita que está abaixo do ponto onde você digitou acompanha o texto.
  // O histórico (↶ ↷) recebe o mesmo deslocamento, para o desfazer não devolver a escrita ao lugar antigo.
  useEffect(() => {
    if (!reflow || reflow.n === lastReflowRef.current) return;
    lastReflowRef.current = reflow.n;
    const w = sizeRef.current.w;
    if (!w || !itemsRef.current.length) return;
    const y0 = (reflow.y - 4) / w;
    let dy = reflow.dy / w;
    const topOf = (it: LayerItem): number | null => {
      const b = unionBox([it], new Set([it.id]), w);
      return b ? b[1] : null;
    };
    if (dy < 0) {
      // Ao encolher, nada sobe além do topo da página.
      let minTop = Infinity;
      for (const it of itemsRef.current) {
        const t = topOf(it);
        if (t !== null && t >= y0) minTop = Math.min(minTop, t);
      }
      if (minTop === Infinity) return;
      dy = Math.max(dy, -minTop);
    }
    if (Math.abs(dy) * w < 1) return;
    const shift = (list: LayerItem[]): LayerItem[] =>
      list.map((it): LayerItem => {
        const t = topOf(it);
        if (t === null || t < y0) return it;
        return it.kind === "text" ? { ...it, y: it.y + dy } : moveItem(it, 0, dy);
      });
    itemsRef.current = shift(itemsRef.current);
    undoRef.current = undoRef.current.map(shift);
    redoRef.current = redoRef.current.map(shift);
    fadeRef.current = null;
    ghostRef.current = null;
    if (selRef.current.size) {
      selRef.current = new Set();
      setSelIds([]);
    }
    queuePush();
    schedule();
    setTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflow]);

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

  // Textos já convertidos (em pixels): contam como vizinhos para saber se um traço é hífen no meio de uma palavra ou um traço solto.
  const textAnchors = (w: number): Anchor[] =>
    itemsRef.current
      .filter((it): it is TextItem => it.kind === "text")
      .map((t) => {
        const b = textBounds(t, w);
        return { left: b[0] * w, top: b[1] * w, right: b[2] * w, bottom: b[3] * w };
      });

  // Leitura em segundo plano: poucos instantes depois do último traço, as linhas escritas nesta sessão já são lidas
  // e o resultado fica guardado. Quando você toca em converter (ou a conversão automática dispara), a resposta sai na hora.
  // Se falhar (sem internet, sem login), nada acontece: a conversão normal tenta de novo quando for pedida.
  const schedulePrefetch = () => {
    window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = 0;
      const w = sizeRef.current.w;
      if (!w || pointerRef.current !== null) return;
      const mine = sessionInkRef.current;
      const pens = itemsRef.current.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && !isShape(it) && mine.has(it.id));
      if (!pens.length || pens.length > 600) return;
      recognizeInk(pens, w, textAnchors(w)).catch(() => undefined);
    }, PREFETCH_MS);
  };

  // ---------- Corrigir o texto convertido, direto no lugar ----------
  // Abre um campo de texto por linha convertida. Cada letra digitada já aparece na página; "Pronto" fecha e entra no histórico (↶).
  const openEdit = (ids: string[]) => {
    const want = new Set(ids);
    const list = itemsRef.current
      .filter((it): it is TextItem => it.kind === "text" && want.has(it.id))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (!list.length) return;
    editBaseRef.current = itemsRef.current;
    setEditIds(list.map((t) => t.id));
    setConvOpen(false);
    setEnhance(false);
    setAutoMsg((m) => (m === "Convertido." ? null : m));
    setLastConv([]);
    setSelection(list.map((t) => t.id));
  };

  const editTextOf = (id: string, text: string) => {
    itemsRef.current = itemsRef.current.map((it): LayerItem => (it.kind === "text" && it.id === id ? { ...it, text } : it));
    schedule();
    queuePush();
    setTick((t) => t + 1);
  };

  const closeEdit = () => {
    const base = editBaseRef.current;
    editBaseRef.current = null;
    const ids = new Set(editIds ?? []);
    // Campo apagado: a linha some.
    const empty = itemsRef.current.filter((it) => it.kind === "text" && ids.has(it.id) && !it.text.trim()).map((it) => it.id);
    if (empty.length) {
      const gone = new Set(empty);
      itemsRef.current = itemsRef.current.filter((it) => !gone.has(it.id));
    }
    if (base && base !== itemsRef.current) {
      undoRef.current.push(base);
      if (undoRef.current.length > 60) undoRef.current.shift();
      redoRef.current = [];
    }
    ghostRef.current = null;
    queuePush();
    setEditIds(null);
    setSelection([]);
    setTick((t) => t + 1);
  };

  // Conversão automática: lê a escrita recente, troca os traços por texto na fonte escolhida (um item por linha).
  // A contagem da pausa só começa quando a S Pen sai da área de escrita; pairando parada, ela espera um pouco mais e converte.
  const armAuto = () => {
    window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = 0;
    if (penHoverRef.current) return;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = 0;
      if (penHoverRef.current) return; // segunda verificação: a caneta voltou durante a espera
      runAutoRef.current();
    }, autoDelayRef.current * 1000);
  };

  // Caneta pairando sobre a tela: cada movimento reinicia a espera. Se ela ficar parada (ou for embora sem avisar),
  // a conversão sai depois da pausa mais um tempinho, em vez de esperar para sempre.
  const armHover = () => {
    window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = 0;
    if (!autoOnRef.current || !pendingRef.current.size) return;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = 0;
      runAutoRef.current();
    }, autoDelayRef.current * 1000 + HOVER_EXTRA_MS);
  };

  // "only": converte só estes traços (a linha que ficou para trás, ou o que você mandou converter); sem ele, converte tudo o que está esperando.
  // O que não for convertido (falha de rede, linha não reconhecida) continua na fila para outra tentativa.
  // Setas, traços soltos, linhas longas e círculos não são letras: ficam como desenho e não entram na fila.
  const runAuto = async (only?: Set<string>, manual = false) => {
    if (autoBusyRef.current) {
      if (only) only.forEach((id) => pendingRef.current.add(id));
      armAuto();
      return;
    }
    const ids = only ? new Set(only) : new Set(pendingRef.current);
    if (!only) pendingRef.current = new Set();
    const src = itemsRef.current.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && !isShape(it) && ids.has(it.id));
    const w = sizeRef.current.w;
    if (!src.length) return;
    if (!w) {
      src.forEach((it) => pendingRef.current.add(it.id));
      return;
    }
    const anchors = textAnchors(w);
    const shapes = shapeIds(src, w, anchors);
    const work = shapes.size ? src.filter((it) => !shapes.has(it.id)) : src;
    if (!work.length) {
      if (manual) setAutoMsg("Só há setas, traços ou desenhos aqui: eles ficam como estão.");
      return;
    }
    autoBusyRef.current = true;
    setAutoMsg("Convertendo…");
    try {
      const { lines, failed } = await recognizeInk(work, w, anchors);
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
        const atOrBelowMiddle = (at.top + at.bottom) / 2 >= mate.y * w - px * 0.15; // acento fica acima do meio da letra
        if (!small || bw > bh * 1.8 || !atOrBelowMiddle) continue;
        const joined = joinText(mate, bh >= bw * 1.8 ? "," : ".", true, w);
        if (!joined) continue;
        updated.set(joined.id, joined);
        gone.add(it.id);
      }
      // Tudo o que não foi convertido continua na fila, disponível para uma nova tentativa.
      const stillPresent = new Set(itemsRef.current.filter(isInkLike).map((it) => it.id));
      const remaining = work.filter((it) => !gone.has(it.id) && stillPresent.has(it.id));
      remaining.forEach((it) => pendingRef.current.add(it.id));
      if (gone.size || fresh.length || updated.size) {
        // O texto entra na hora e a letra à mão some junto: sem transição e sem a letra clarinha atrás.
        fadeRef.current = null;
        ghostRef.current = null;
        window.clearTimeout(ghostTimerRef.current);
        const kept = base.filter((it) => !gone.has(it.id)).map((it): LayerItem => (it.kind === "text" ? (updated.get(it.id) ?? it) : it));
        commit([...kept, ...fresh], base);
        schedule();
      }
      if (remaining.length) {
        setAutoMsg("Parte da escrita não foi reconhecida. Ela foi preservada para você tentar novamente.");
      } else if (failed) {
        setAutoMsg(`${failed} ${failed === 1 ? "linha não foi reconhecida" : "linhas não foram reconhecidas"}.`);
      } else if (fresh.length || updated.size) {
        // Deu certo: aparece o botão "Corrigir" para ajustar qualquer palavra que o app tenha lido errado.
        setLastConv([...fresh.map((t) => t.id), ...Array.from(updated.keys())]);
        setAutoMsg("Convertido.");
      } else {
        setAutoMsg(null);
      }
    } catch (e) {
      // Erro de rede ou do serviço: a escrita continua na página e volta para a fila.
      const stillPresent = new Set(itemsRef.current.filter(isInkLike).map((it) => it.id));
      work.forEach((it) => {
        if (stillPresent.has(it.id)) pendingRef.current.add(it.id);
      });
      setAutoMsg(e instanceof Error ? `${e.message} Sua escrita foi preservada.` : "Falha na conversão. Sua escrita foi preservada.");
    } finally {
      autoBusyRef.current = false;
    }
  };
  runAutoRef.current = () => {
    void runAuto();
  };

  // Conversão depois de escrever: tudo de uma vez (ou só o que está selecionado com o laço), no mesmo lugar.
  const convertNow = () => {
    const pens = itemsRef.current.filter((it): it is InkItem => it.kind === "ink" && it.tool === "pen" && !isShape(it));
    const picked = selRef.current;
    const src = picked.size ? pens.filter((it) => picked.has(it.id)) : pens;
    if (!src.length) {
      setAutoMsg("Não há escrita de caneta para converter.");
      return;
    }
    stopAuto();
    setSelection([]);
    void runAuto(new Set(src.map((it) => it.id)), true);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !writing || !size.w) return;
    if (e.pointerType === "pen") {
      penSeenRef.current = true;
      penHoverRef.current = true;
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = 0;
      touchesRef.current.clear();
      panRef.current = null;
    }
    // Dois dedos na tela: com o laço e algo selecionado, a pinça aumenta ou diminui a seleção; nos demais casos,
    // movem a página sem sair do modo de escrita. Vale mesmo com a S Pen em uso; palma da mão (toque largo) é ignorada,
    // assim como toques enquanto a caneta está escrevendo.
    if (e.pointerType === "touch") {
      const palm = Math.max(e.width, e.height) > PALM_PX;
      const penBusy = pointerRef.current !== null && drawTypeRef.current === "pen";
      if (!palm && !penBusy) {
        touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchesRef.current.size === 2 && !pinchRef.current && !panRef.current) {
          const [a, b] = Array.from(touchesRef.current.values());
          const d0 = Math.hypot(a.x - b.x, a.y - b.y);
          const box = tool === "lasso" && selRef.current.size ? unionBox(itemsRef.current, selRef.current, size.w) : null;
          e.preventDefault();
          if (box && d0 > 10) {
            // O primeiro dedo pode ter começado a arrastar: volta ao ponto de partida antes de redimensionar.
            if (dragRef.current) {
              itemsRef.current = dragRef.current.base;
              dragRef.current = null;
            }
            lassoRef.current = null;
            pointerRef.current = null;
            pinchRef.current = { d0, base: itemsRef.current, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2 };
            schedule();
          } else {
            cancelGesture();
            panRef.current = touchCentroid();
          }
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
    drawTypeRef.current = e.pointerType;
    window.clearTimeout(autoTimerRef.current); // voltou a escrever: espera a próxima pausa
    autoTimerRef.current = 0;
    window.clearTimeout(prefetchTimerRef.current); // e a leitura em segundo plano também espera
    prefetchTimerRef.current = 0;
    const [x, y] = toPoint(e.clientX, e.clientY);

    // S Pen: com o botão da caneta (ou a ponta de borracha) apertado, ela apaga naquele gesto, sem trocar de ferramenta.
    const eff: Tool = e.pointerType === "pen" && (e.buttons & 34) !== 0 ? "eraser" : tool;
    // Começo de um possível "toque" da caneta (toque rápido, sem arrastar).
    tapRef.current = e.pointerType === "pen" && eff === "pen" ? { t: performance.now(), x: e.clientX, y: e.clientY } : null;

    if (eff === "lasso") {
      const box = unionBox(itemsRef.current, selRef.current, size.w);
      const slack = e.pointerType === "touch" ? 0.06 : 0.015; // com o dedo, a área de pegar a seleção é maior
      if (box && x >= box[0] - slack && x <= box[2] + slack && y >= box[1] - slack && y <= box[3] + slack) {
        dragRef.current = { sx: x, sy: y, base: itemsRef.current };
        return;
      }
      // Tocar num texto convertido seleciona o texto; se soltar sem arrastar, abre a correção das palavras.
      let hitT: TextItem | null = null;
      for (let i = itemsRef.current.length - 1; i >= 0; i--) {
        const it = itemsRef.current[i];
        if (it.kind === "text" && hitText(it, x, y, size.w, 12)) {
          hitT = it;
          break;
        }
      }
      if (hitT) {
        setSelection([hitT.id]);
        dragRef.current = { sx: x, sy: y, base: itemsRef.current };
        return;
      }
      setSelection([]);
      lassoRef.current = [x, y];
      schedule();
      return;
    }
    if (eff === "eraser") {
      erasingRef.current = true;
      eraseBaseRef.current = itemsRef.current;
      eraseAt(x, y);
      return;
    }
    const marker = eff === "highlighter";
    clearLive();
    ghostRef.current = null; // voltou a escrever: a letra clarinha da conversão anterior some
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
    snapRef.current = null;
    armHold(e.clientX, e.clientY);
    drawLiveNow(); // o ponto aparece assim que a caneta encosta
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
      // Dois dedos movendo a página: ela acompanha o centro entre os dedos.
      if (panRef.current) {
        e.preventDefault();
        const c = touchCentroid();
        if (c) {
          window.scrollBy(panRef.current.x - c.x, panRef.current.y - c.y);
          panRef.current = c;
        }
        return;
      }
    }
    // Caneta pairando sobre a tela: você ainda está escrevendo, então a conversão espera.
    // Cada movimento reinicia a espera; se a caneta ficar parada pairando, a conversão sai depois da pausa mais um tempinho.
    if (e.pointerType === "pen" && pointerRef.current === null) {
      penHoverRef.current = true;
      armHover();
    }
    if (e.pointerId !== pointerRef.current) return;
    e.preventDefault();
    // Formas automáticas: a caneta se mexeu, então a contagem de "parada" recomeça.
    if (draftRef.current) {
      const snap = snapRef.current;
      if (snap) {
        // Forma já na tela: um tremor pequeno é ignorado; se a caneta se mexer de verdade, a forma some e o traço continua livre.
        if (Math.hypot(e.clientX - snap.cx, e.clientY - snap.cy) < SNAP_CANCEL_PX) return;
        snapRef.current = null;
        clearLive();
      }
      const a = holdAnchorRef.current;
      if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > HOLD_JITTER_PX) armHold(e.clientX, e.clientY);
    }
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
      drawLiveNow(); // o traço acompanha a caneta no mesmo instante, sem esperar o próximo quadro
    } else {
      schedule();
    }
  };

  // A S Pen saiu da área de escrita: agora a contagem da pausa pode começar.
  const onPenLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "pen") return;
    // Ainda executando um traço: a caneta não se afastou.
    if (pointerRef.current === e.pointerId) return;
    penHoverRef.current = false;
    if (autoOnRef.current && pendingRef.current.size > 0) armAuto();
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
      if (touchesRef.current.size < 2) panRef.current = null;
      if (e.pointerId !== pointerRef.current) return;
    }
    if (e.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    // Levantou a S Pen, mas ela ainda pode estar pairando: só conta a pausa quando sair da área.
    if (e.pointerType === "pen") {
      penHoverRef.current = true;
    }

    if (dragRef.current) {
      const { base, sx, sy } = dragRef.current;
      dragRef.current = null;
      const [ux, uy] = toPoint(e.clientX, e.clientY);
      const moved = Math.hypot(ux - sx, uy - sy) * size.w > SEL_TAP_PX;
      if (!moved) {
        // Foi só um toque: se for num texto convertido, abre a correção das palavras.
        itemsRef.current = base;
        const only = selRef.current.size === 1 ? Array.from(selRef.current)[0] : null;
        if (only && base.some((it) => it.kind === "text" && it.id === only)) openEdit([only]);
        schedule();
        return;
      }
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
    // Forma corrigida (reta, seta, retângulo) que apareceu enquanto a caneta estava parada: é ela que fica na página.
    const snap = snapRef.current;
    snapRef.current = null;
    clearHold();
    if (d) {
      // A forma vai marcada como desenho ("keep"), para a conversão em texto nunca mexer nela.
      const fin = snap ? ({ ...d, pts: snap.pts, pr: undefined, shape: true, keep: true } as unknown as PenInk) : d;
      // Toque rápido da caneta, sem arrastar: sozinho é só um ponto (como um ponto final);
      // dois toques seguidos, perto um do outro, colocam o cursor do texto ali (o ponto do primeiro toque some).
      const now = performance.now();
      const tap = tapRef.current;
      tapRef.current = null;
      const isTap =
        auto && !snap && !!tap && d.tool === "pen" && now - tap.t < TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < TAP_MOVE_PX;
      const prev = lastTapRef.current;
      if (isTap && prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
        lastTapRef.current = null;
        if (itemsRef.current.some((it) => it.id === prev.id)) {
          itemsRef.current = itemsRef.current.filter((it) => it.id !== prev.id);
          undoRef.current.pop(); // o ponto do primeiro toque sai também do histórico
          pendingRef.current.delete(prev.id);
          sessionInkRef.current.delete(prev.id);
          queuePush();
        }
        clearLive();
        schedule();
        setTick((t) => t + 1);
        placeCaretAt(canvasRef.current, e.clientX, e.clientY);
        return;
      }
      commit([...itemsRef.current, fin], itemsRef.current);
      drawFinished(fin);
      clearLive();
      lastTapRef.current = isTap ? { id: d.id, t: now, x: e.clientX, y: e.clientY } : null;
      if (d.tool === "pen" && !snap) {
        // Traço de caneta novo: a leitura dele começa em segundo plano depois de uma pausa.
        sessionInkRef.current.add(d.id);
        schedulePrefetch();
      }
      if (autoOnRef.current && d.tool === "pen" && !snap) {
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
        // Caneta ainda pairando: a espera conta mesmo assim (um pouco mais longa), senão a conversão nunca sairia.
        if (penHoverRef.current) armHover();
        else armAuto();
      }
    }
  };

  // O navegador ou o aparelho interrompeu o gesto (ex.: palma da mão, rolagem do sistema): o traço incompleto é
  // descartado em vez de ser salvo como se estivesse pronto.
  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchesRef.current.delete(e.pointerId)) {
      const pin = pinchRef.current;
      if (pin) {
        itemsRef.current = pin.base;
        pinchRef.current = null;
        schedule();
      }
      if (touchesRef.current.size < 2) panRef.current = null;
      if (e.pointerId !== pointerRef.current) return;
    }
    if (e.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    // Restaura qualquer seleção ou borracha interrompida.
    if (dragRef.current) {
      itemsRef.current = dragRef.current.base;
      dragRef.current = null;
    }
    if (erasingRef.current && eraseBaseRef.current) {
      itemsRef.current = eraseBaseRef.current;
    }
    erasingRef.current = false;
    eraseBaseRef.current = null;
    // Descarta o traço incompleto.
    draftRef.current = null;
    clearHold();
    snapRef.current = null;
    lassoRef.current = null;
    tapRef.current = null;
    if (e.pointerType === "pen") {
      penHoverRef.current = false;
    }
    clearLive();
    schedule();
    if (autoOnRef.current && pendingRef.current.size) armAuto();
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(itemsRef.current);
    itemsRef.current = prev;
    fadeRef.current = null;
    ghostRef.current = null;
    editBaseRef.current = null;
    setEditIds(null);
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
    ghostRef.current = null;
    editBaseRef.current = null;
    setEditIds(null);
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

  // "Manter como desenho": os traços de caneta selecionados nunca viram texto (seta, risco, sublinhado, esquema...).
  const keepAsDrawing = () => {
    const base = itemsRef.current;
    const picked = selRef.current;
    commit(
      base.map((it): LayerItem => (picked.has(it.id) && it.kind === "ink" && it.tool === "pen" ? ({ ...it, keep: true, force: false } as LayerItem) : it)),
      base
    );
    picked.forEach((id) => pendingRef.current.delete(id));
    setAutoMsg("Marcado como desenho: não vira texto.");
    setSelection([]);
  };

  // "Converter como texto": força a conversão dos traços selecionados, mesmo que o app ache que são um desenho (ex.: um "l", um "1" ou um hífen).
  const forceText = () => {
    const base = itemsRef.current;
    const picked = new Set(Array.from(selRef.current).filter((id) => base.some((it) => it.id === id && it.kind === "ink" && it.tool === "pen")));
    if (!picked.size) return;
    commit(
      base.map((it): LayerItem => (picked.has(it.id) ? ({ ...it, keep: false, force: true } as unknown as LayerItem) : it)),
      base
    );
    stopAuto();
    setSelection([]);
    void runAuto(picked, true);
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
    const ink = itemsRef.current.filter(isInkLike).filter((it) => !isShape(it));
    const src = selRef.current.size ? ink.filter((it) => selRef.current.has(it.id)) : ink;
    setConvBusy(true);
    setConvErr(null);
    try {
      const { lines, failed } = await recognizeInk(src, size.w, textAnchors(size.w));
      if (!lines.length) {
        setConvErr("Não encontrei escrita de caneta para converter (marca-texto, setas, traços soltos e círculos ficam de fora).");
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
  const row: React.CSSProperties = {
    display: "flex",
    gap: 6,
    alignItems: "center",
    overflowX: "auto",
    padding: "3px 0",
    scrollbarWidth: "none",
    flexWrap: "nowrap",
  };
  const hasPen = itemsRef.current.some((it) => it.kind === "ink" && it.tool === "pen");
  const selHasText = selIds.some((id) => itemsRef.current.some((it) => it.kind === "text" && it.id === id));
  const selHasPen = selIds.some((id) => itemsRef.current.some((it) => it.kind === "ink" && it.tool === "pen" && it.id === id));

  // Aviso "Convertido" com o botão Corrigir: uma pastilha pequena, sem abrir a barra de ferramentas inteira.
  const doneChip = active && autoMsg === "Convertido." && lastConv.length > 0 && !editIds;

  // Modo automático: o desenho só captura a caneta (e só quando ela está perto); no modo clássico captura tudo.
  const capture = active && writing && (!auto || penNear);
  // Modo automático: a barra some sozinha enquanto você só digita (e volta quando a caneta se aproxima ou ao tocar no ✍).
  const barVisible =
    !auto || barOn || convOpen || enhance || selIds.length > 0 || (!!autoMsg && autoMsg !== "Convertido.") || convBusy || !!editIds;

  if (!show) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Escrita sobre a página"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={onPenLeave}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 5,
          pointerEvents: capture ? "auto" : "none",
          touchAction: capture ? "none" : "auto",
          cursor: capture ? "crosshair" : "default",
        }}
      />
      {/* Camada do marca-texto: fica atrás da escrita e se mistura com o texto da página (o texto continua escuro por cima da cor). */}
      <canvas
        ref={markRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 4,
          pointerEvents: "none",
          mixBlendMode: "multiply",
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
          mixBlendMode: tool === "highlighter" ? "multiply" : "normal",
        }}
      />
      {doneChip && (
        <div
          role="status"
          style={{
            position: "fixed",
            right: 12,
            bottom: `calc(var(--kb, 0px) + var(--dock-h, 0px) + ${barVisible ? 170 : 68}px + env(safe-area-inset-bottom, 0px))`,
            zIndex: 61,
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "6px 8px 6px 12px",
            borderRadius: 999,
            border: "1px solid var(--line, #d5dbe3)",
            background: "var(--card, #fff)",
            boxShadow: "0 4px 16px rgba(0,0,0,.18)",
            fontSize: 14,
          }}
        >
          <span>Convertido ✓</span>
          <button type="button" style={{ ...btn(true), height: 32, fontWeight: 700 }} onClick={() => openEdit(lastConv)}>
            Corrigir
          </button>
        </div>
      )}
      {active && !barVisible && (
        <button
          type="button"
          aria-label="Mostrar as ferramentas de escrita à mão"
          onClick={showBar}
          style={{
            position: "fixed",
            right: 12,
            bottom: "calc(var(--kb, 0px) + var(--dock-h, 0px) + 12px + env(safe-area-inset-bottom, 0px))",
            zIndex: 60,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "1px solid var(--line, #d5dbe3)",
            background: "var(--card, #fff)",
            boxShadow: "0 4px 16px rgba(0,0,0,.18)",
            fontSize: 20,
          }}
        >
          ✍
        </button>
      )}
      {active && barVisible && (
        <div
          role="toolbar"
          aria-label="Escrita sobre a página"
          onPointerDown={() => {
            if (auto) showBar();
          }}
          onMouseDown={(e) => {
            // No modo automático, tocar nas ferramentas não tira o cursor (nem fecha o teclado) do texto.
            if (auto && !(e.target as HTMLElement).closest("textarea,input,select")) e.preventDefault();
          }}
          style={{
            position: "fixed",
            left: 8,
            right: 8,
            bottom: "calc(var(--kb, 0px) + var(--dock-h, 0px) + 8px + env(safe-area-inset-bottom, 0px))",
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
            maxHeight: "min(48vh, 440px)",
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {autoMsg && autoMsg !== "Convertido." && (
            <div
              role="status"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 9,
                background: "var(--bg, #f1f5f9)",
                fontSize: 13,
              }}
            >
              <span>{autoMsg}</span>
              {autoMsg !== "Convertendo…" && pendingRef.current.size > 0 && (
                <button
                  type="button"
                  style={btn(true)}
                  onClick={() => {
                    setAutoMsg("Convertendo…");
                    void runAuto();
                  }}
                >
                  Tentar novamente
                </button>
              )}
            </div>
          )}
          {editIds && (
            <div role="group" aria-label="Corrigir o texto convertido" style={{ display: "grid", gap: 6 }}>
              <b style={{ fontSize: 13 }}>Corrigir o texto</b>
              {editIds.map((id, i) => {
                const t = itemsRef.current.find((it): it is TextItem => it.kind === "text" && it.id === id);
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
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      height: 42,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line, #d5dbe3)",
                      fontSize: 17,
                      fontFamily: t.font ?? undefined,
                      userSelect: "text",
                      WebkitUserSelect: "text",
                    }}
                  />
                );
              })}
              <div style={row}>
                <button type="button" style={{ ...btn(true), fontWeight: 700 }} onClick={closeEdit}>
                  Pronto
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Apague o campo e toque em Pronto para remover a linha; ↶ desfaz.</p>
            </div>
          )}
          {convOpen && (
            <div role="group" aria-label="Converter escrita em texto" style={{ display: "grid", gap: 6 }}>
              {convText === null ? (
                <>
                  <div style={row}>
                    <button type="button" style={{ ...btn(true, !hasPen), fontWeight: 700 }} disabled={!hasPen} onClick={convertNow}>
                      {selIds.length ? `Converter os ${selIds.length} selecionados` : "Converter a escrita"}
                    </button>
                    <button type="button" aria-label="Ajustes da conversão: fonte e pausa" style={btn(convSettings)} onClick={() => setConvSettings((v) => !v)}>
                      {`⚙ ${CONV_FONTS[convFont].name}${autoOn ? ` · ${autoDelay} s` : ""}`}
                    </button>
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
                  {convSettings && (
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
                      {autoOn && (
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>Pausa</span>
                          <input
                            type="range"
                            min={2}
                            max={10}
                            step={1}
                            value={autoDelay}
                            aria-label="Tempo de pausa antes de converter"
                            onChange={(e) => setAutoDelay(Number(e.target.value))}
                            style={{ flex: 1, minWidth: 80 }}
                          />
                          <b style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{autoDelay} s</b>
                        </div>
                      )}
                      <div style={row}>
                        <button type="button" style={btn(false, convBusy)} disabled={convBusy} onClick={convert}>
                          {convBusy
                            ? "Reconhecendo…"
                            : selIds.length
                              ? `Enviar os ${selIds.length} selecionados para o texto da página`
                              : "Enviar toda a escrita para o texto da página (editável)"}
                        </button>
                      </div>
                    </>
                  )}
                  <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                    A letra vira texto no mesmo lugar e na mesma cor. Depois de converter, toque em Corrigir (ou toque no texto com o ⬚ Laço) para ajustar qualquer palavra. Para escolher só um trecho, use o ⬚ Laço. Precisa de internet.
                  </p>
                  {convErr && <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{convErr}</p>}
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
          {tool === "lasso" && selIds.length > 0 && !editIds && (
            <div role="toolbar" aria-label="Ações da seleção" style={row}>
              {selHasText && (
                <button type="button" style={{ ...btn(true), fontWeight: 700 }} onClick={() => openEdit(selIds)}>
                  ✏ Corrigir texto
                </button>
              )}
              {selHasPen && (
                <button type="button" style={btn()} onClick={keepAsDrawing}>
                  Manter como desenho
                </button>
              )}
              {selHasPen && (
                <button type="button" style={btn()} onClick={forceText}>
                  Converter como texto
                </button>
              )}
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
            {onAutoChange && (
              <button
                type="button"
                aria-label={
                  auto
                    ? "Caneta automática ligada: a caneta escreve direto; dedo e teclado digitam; dois toques da caneta colocam o cursor; o botão da caneta apaga. Toque para desligar"
                    : "Ligar a caneta automática: a caneta escreve direto; dedo e teclado digitam"
                }
                style={btn(auto)}
                onClick={() => onAutoChange(!auto)}
              >
                {auto ? "⚡ Auto" : "⚡"}
              </button>
            )}
            <button type="button" aria-label="Caneta" style={btn(tool === "pen")} onClick={() => pickTool("pen")}>✎</button>
            <button type="button" aria-label="Marca-texto" style={btn(tool === "highlighter")} onClick={() => pickTool("highlighter")}>▮</button>
            <button type="button" aria-label="Borracha" style={btn(tool === "eraser")} onClick={() => pickTool("eraser")}>⌫</button>
            <button type="button" aria-label="Laço: selecionar, mover, aumentar com dois dedos, corrigir texto convertido e apagar traços" style={btn(tool === "lasso")} onClick={() => pickTool("lasso")}>⬚ Laço</button>
            <button
              type="button"
              aria-label={
                shapesOn
                  ? "Formas automáticas ligadas: segure a caneta parada no fim do traço para endireitar retas, setas e retângulos. Toque para desligar"
                  : "Ligar as formas automáticas: segure a caneta parada no fim do traço para endireitar retas, setas e retângulos"
              }
              style={btn(shapesOn)}
              onClick={() => setShapesOn((v) => !v)}
            >
              ▭
            </button>
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
              aria-label={auto ? "Pausar a caneta e voltar só ao texto" : "Concluir e voltar a editar o texto"}
              style={{ ...btn(), fontWeight: 700 }}
              onClick={() => {
                if (editIds) closeEdit();
                flushPush();
                onClose();
              }}
            >
              {auto ? "Pausar" : "Concluir"}
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
