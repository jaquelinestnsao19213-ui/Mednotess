"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Callout, FileCard, FontSize, ResizableImage, Toggle, WebEmbed } from "./editor/extensions";
import { FontFamily, StyledTableCell, StyledTableHeader } from "./editor/format-extensions";
import { AudioNote, VideoNote } from "./editor/media-extensions";
import { InkBlock } from "./editor/ink-extension";
import InkOverlay, { readInkLayer } from "./editor/InkOverlay";
import { toDoc } from "@/lib/doc";
import { SharedViewContext, setVisitorMode } from "@/lib/shared-view";
import { buildAnchors, measureBlocks, warpItems, type BlockMap } from "@/lib/ink-anchors";

export type SharedPage = {
  id: string;
  type: string;
  title: string;
  icon: string | null;
  cover_url: string | null;
  props: { date?: string; discipline?: string; room?: string } | null;
  content: unknown;
};

// Tamanho de referência da escrita à mão: a largura da folha (em pixels) e o espaço entre parágrafos da tela
// em que a dona do caderno escreveu. A escrita à mão é posicionada em cima do texto, então o texto precisa
// quebrar as linhas do mesmo jeito para cada traço ficar no lugar certo.
// "tops" e "h": topo de cada bloco do texto (e altura total) na tela da dona, para corrigir diferenças de altura
// (imagens, vídeos, tabelas) no link do visitante.
type InkRef = { w: number; pg: "compact" | "normal" | "airy"; tops?: number[]; h?: number };

function readInkRef(value: unknown): InkRef | null {
  const r = value as { w?: unknown; pg?: unknown; tops?: unknown; h?: unknown } | null | undefined;
  if (!r || typeof r.w !== "number" || !Number.isFinite(r.w) || r.w < 200 || r.w > 4000) return null;
  const ref: InkRef = { w: Math.round(r.w), pg: r.pg === "compact" || r.pg === "airy" ? r.pg : "normal" };
  if (
    Array.isArray(r.tops) &&
    r.tops.length > 0 &&
    r.tops.length <= 5000 &&
    r.tops.every((t) => typeof t === "number" && Number.isFinite(t)) &&
    typeof r.h === "number" &&
    Number.isFinite(r.h) &&
    r.h > 0
  ) {
    ref.tops = r.tops as number[];
    ref.h = r.h;
  }
  return ref;
}

// Página publicada: mesmo visual da página original, mas somente leitura (sem barra de edição).
// Nos PDFs, o visitante vê os comentários da dona e pode fazer os próprios (ficam só neste aparelho).
export default function SharedPageView({ page, token }: { page: SharedPage; token?: string }) {
  const doc = useMemo(() => toDoc(page.content), [page.content]);
  const layer = useMemo(() => readInkLayer(doc.inkLayer), [doc]);
  const inkRef = useMemo(() => readInkRef((doc as { inkRef?: unknown }).inkRef), [doc]);
  // Só ajusta a folha quando há escrita à mão e se sabe em que largura ela foi feita.
  const fitW = layer.items.length > 0 && inkRef ? inkRef.w : 0;
  const fitPg = inkRef?.pg ?? "normal";

  const view = useMemo(() => (token ? { token } : null), [token]);

  // Visitante não tem conta: imagens colocadas em comentários ficam embutidas no comentário.
  useEffect(() => {
    setVisitorMode(true);
    return () => setVisitorMode(false);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage,
      Table.configure({ resizable: false }),
      TableRow,
      StyledTableHeader,
      StyledTableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      Toggle,
      FileCard,
      WebEmbed,
      AudioNote,
      VideoNote,
      InkBlock,
    ],
    content: doc,
    editorProps: { attributes: { "aria-label": "Página compartilhada (somente leitura)" } },
  });

  // Folha com escrita à mão: usa o espaço entre parágrafos da dona e deixa a largura livre (o ajuste é feito abaixo).
  useEffect(() => {
    if (!fitW) return;
    const root = document.documentElement;
    const before = { pg: root.dataset.pg, pw: root.dataset.pw };
    root.dataset.pg = fitPg;
    root.dataset.pw = "full";
    return () => {
      if (before.pg === undefined) delete root.dataset.pg;
      else root.dataset.pg = before.pg;
      if (before.pw === undefined) delete root.dataset.pw;
      else root.dataset.pw = before.pw;
    };
  }, [fitW, fitPg]);

  // A folha é montada na largura em que a escrita foi feita e depois reduzida (sem refazer as linhas) para caber na tela.
  // Assim texto, imagens e escrita à mão ficam sempre juntos, em qualquer aparelho.
  const slotRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [innerH, setInnerH] = useState(0);
  // Topo de cada bloco do texto nesta tela (imagens, vídeos e fontes podem ocupar alturas diferentes das da tela da dona).
  const [vis, setVis] = useState<BlockMap | null>(null);
  const ready = !!editor;

  useEffect(() => {
    if (!fitW || !ready) return;
    const slot = slotRef.current;
    const inner = innerRef.current;
    if (!slot || !inner) return;
    const update = () => {
      setAvail(slot.clientWidth);
      setInnerH(inner.offsetHeight);
      const m = measureBlocks(inner.querySelector<HTMLElement>(".tiptap"), inner, false);
      setVis((prev) => (prev && m && prev.h === m.h && prev.tops.join() === m.tops.join() ? prev : m));
    };
    update();
    // Imagens, vídeos e fontes terminam de carregar depois: mede de novo para a escrita acompanhar.
    const late = [300, 1200, 3000].map((ms) => window.setTimeout(update, ms));
    inner.addEventListener("load", update, true);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(update).catch(() => undefined);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        late.forEach((t) => window.clearTimeout(t));
        inner.removeEventListener("load", update, true);
      };
    }
    const ro = new ResizeObserver(update);
    ro.observe(slot);
    ro.observe(inner);
    return () => {
      ro.disconnect();
      late.forEach((t) => window.clearTimeout(t));
      inner.removeEventListener("load", update, true);
    };
  }, [fitW, ready]);

  const scale = fitW && avail ? Math.min(1, avail / fitW) : 1;

  // Escrita à mão ajustada: cada traço acompanha o bloco do texto ao lado do qual a dona o escreveu,
  // mesmo que imagens, vídeos ou tabelas acima tenham altura diferente aqui.
  const anchors = useMemo(() => {
    if (!fitW || !inkRef?.tops || !inkRef.h || !vis) return null;
    return buildAnchors(inkRef.tops, inkRef.h, vis.tops, vis.h);
  }, [fitW, inkRef, vis]);
  const shownLayer = useMemo(
    () => (anchors && fitW ? { ...layer, items: warpItems(layer.items, fitW, anchors) } : layer),
    [anchors, fitW, layer]
  );

  const props = page.props ?? {};
  const isLesson = page.type === "lesson";

  return (
    <SharedViewContext.Provider value={view}>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        Página compartilhada · somente leitura. Os seus comentários e marcações nos PDFs ficam só neste aparelho.
      </p>
      {fitW > 0 && scale < 0.98 && (
        <p className="muted small" style={{ margin: "0 0 8px" }}>
          A página foi ajustada à tela para a escrita à mão ficar no lugar. Use o zoom (pinça) para ler de perto.
        </p>
      )}

      {page.cover_url && <div className="cover" style={{ backgroundImage: `url(${page.cover_url})` }} />}

      <div className="titlebar">
        {page.icon && <span className="icon-btn" aria-hidden="true">{page.icon}</span>}
        <h1 className="display" style={{ margin: 0 }}>{page.title || "Sem título"}</h1>
      </div>

      {isLesson && (props.date || props.discipline || props.room) && (
        <p className="muted">
          {[props.date ? new Date(`${props.date}T12:00:00`).toLocaleDateString("pt-BR") : "", props.discipline, props.room].filter(Boolean).join(" · ")}
        </p>
      )}

      {editor && fitW > 0 && (
        <div className="editor">
          <div
            ref={slotRef}
            style={{
              position: "relative",
              width: "100%",
              height: innerH ? Math.ceil(innerH * scale) : undefined,
              overflow: "hidden",
              visibility: avail ? "visible" : "hidden",
            }}
          >
            <div
              ref={innerRef}
              style={{
                position: "absolute",
                top: 0,
                left: Math.max(0, (avail - fitW * scale) / 2),
                width: fitW,
                transformOrigin: "0 0",
                transform: scale < 1 ? `scale(${scale})` : undefined,
              }}
            >
              <EditorContent editor={editor} />
              <InkOverlay layer={shownLayer} onChange={() => {}} active={false} onClose={() => {}} />
            </div>
          </div>
        </div>
      )}

      {editor && fitW === 0 && (
        <div className="editor">
          <div style={{ position: "relative" }}>
            <EditorContent editor={editor} />
            <InkOverlay layer={layer} onChange={() => {}} active={false} onClose={() => {}} />
          </div>
        </div>
      )}
    </SharedViewContext.Provider>
  );
}
