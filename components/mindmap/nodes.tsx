"use client";

import { useEffect, useRef } from "react";
import { Handle, MarkerType, NodeResizer, Position, useConnection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { type MapDoc, type MapEdge, type MapNode, childrenOf, hiddenIds, nodeById, paletteStyle } from "@/lib/mindmap";

export type NodeCtx = {
  editing: boolean;
  childCount: number;
  onToggle: (id: string) => void;
  onLabel: (id: string, text: string | null) => void; // null = cancelar
};
export type MMNode = Node<{ n: MapNode; ctx: NodeCtx }, "concept" | "note" | "image">;

const FONT = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

const SIDES = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left } as const;

function Handles() {
  // enquanto uma seta está sendo arrastada, o nó inteiro vira alvo (não só as bolinhas)
  const connecting = useConnection((c) => c.inProgress);
  return (
    <>
      <Handle id="c" type="source" position={Position.Top} isConnectableStart={false} className="mm-handle-body" style={{ pointerEvents: connecting ? "all" : "none" }} />
      {(Object.keys(SIDES) as (keyof typeof SIDES)[]).map((id) => (
        <Handle key={id} id={id} type="source" position={SIDES[id]} className="mm-handle" />
      ))}
    </>
  );
}

function InlineEditor({ id, initial, onLabel, multiline }: { id: string; initial: string; onLabel: NodeCtx["onLabel"]; multiline?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mountedAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  // nó recém-criado nasce invisível até o React Flow medi-lo, e elemento invisível não aceita foco: tenta de novo
  useEffect(() => {
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) { el.select(); return; }
      if (++tries < 40) raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <textarea
      ref={ref}
      className="mm-inline nodrag nowheel nopan"
      defaultValue={initial}
      rows={multiline ? 4 : 2}
      onBlur={(e) => {
        // se o React Flow tomou o foco logo após criar o nó (seleção automática), devolve em vez de encerrar a edição
        const next = e.relatedTarget as HTMLElement | null;
        const justCreated = typeof performance !== "undefined" && performance.now() - mountedAt.current < 500;
        if (justCreated && next && next.closest?.(".react-flow") && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(next.tagName)) {
          const el = e.currentTarget;
          requestAnimationFrame(() => el.focus());
          return;
        }
        onLabel(id, e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onLabel(id, null); }
        else if (e.key === "Enter" && !e.shiftKey && !multiline) { e.preventDefault(); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
    />
  );
}

export function ConceptNode({ data, selected }: NodeProps<MMNode>) {
  const { n, ctx } = data;
  const d = n.data;
  const st = paletteStyle(d.color);
  const fs = d.fontSize ?? 15;
  const sized = !!(n.w && n.h);
  const borderStyle = d.borderStyle ?? (d.inferred ? "dashed" : "solid");
  return (
    <div
      className={`mm-node mm-shape-${d.shape ?? "rounded"}${selected ? " is-selected" : ""}${sized ? " is-sized" : ""}`}
      style={{
        background: st.fill, color: st.ink, borderColor: st.border,
        borderStyle: borderStyle === "none" ? "none" : borderStyle,
        borderWidth: borderStyle === "none" ? 0 : d.borderWidth ?? 2,
        fontSize: fs, fontWeight: d.bold ? 750 : 600, fontStyle: d.italic ? "italic" : "normal", fontFamily: FONT[d.font ?? "sans"],
      }}
    >
      <NodeResizer isVisible={!!selected} minWidth={70} minHeight={32} handleClassName="mm-resize" lineClassName="mm-resize-line" />
      <Handles />
      {ctx.editing ? (
        <InlineEditor id={n.id} initial={d.label} onLabel={ctx.onLabel} />
      ) : (
        <span className="mm-text">
          <span className="mm-label">{d.label || "Sem texto"}</span>
          {d.showDetail && d.detail ? <span className="mm-sub" style={{ fontSize: Math.max(10, fs * 0.78) }}>{d.detail}</span> : null}
        </span>
      )}
      <span className="mm-badges">
        {d.pageId ? <i className="mm-badge" title="Vinculado a uma anotação">▤</i> : null}
        {d.detail && !d.showDetail ? <i className="mm-badge" title={d.detail}>i</i> : null}
        {d.inferred ? <i className="mm-badge mm-badge-ai" title="Sugestão da IA que não está nas suas anotações: confira">IA</i> : null}
      </span>
      {ctx.childCount > 0 && (
        <button type="button" className="mm-toggle nodrag" aria-label={d.collapsed ? "Expandir ramo" : "Recolher ramo"} onClick={(e) => { e.stopPropagation(); ctx.onToggle(n.id); }}>
          {d.collapsed ? `+${ctx.childCount}` : "−"}
        </button>
      )}
    </div>
  );
}

export function NoteNode({ data, selected }: NodeProps<MMNode>) {
  const { n, ctx } = data;
  const st = paletteStyle(n.data.color);
  return (
    <div className={`mm-note${selected ? " is-selected" : ""}`} style={{ background: st.fill, borderColor: st.border, color: st.ink, fontSize: n.data.fontSize ?? 13, fontFamily: FONT[n.data.font ?? "sans"], fontWeight: n.data.bold ? 700 : 400, fontStyle: n.data.italic ? "italic" : "normal" }}>
      <NodeResizer isVisible={!!selected} minWidth={80} minHeight={44} handleClassName="mm-resize" lineClassName="mm-resize-line" />
      <Handles />
      {ctx.editing ? <InlineEditor id={n.id} initial={n.data.label} onLabel={ctx.onLabel} multiline /> : <span className="mm-note-text">{n.data.label || "Toque duas vezes para escrever"}</span>}
      {n.data.pageId ? <i className="mm-badge mm-note-badge" title="Vinculado a uma anotação">▤</i> : null}
    </div>
  );
}

export function ImageNode({ data, selected }: NodeProps<MMNode>) {
  const { n, ctx } = data;
  const c = n.data.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const w = Math.max(0.1, 1 - c.l - c.r), h = Math.max(0.1, 1 - c.t - c.b);
  return (
    <div className={`mm-image${selected ? " is-selected" : ""}`} style={{ borderColor: paletteStyle(n.data.color).border }}>
      <NodeResizer isVisible={!!selected} minWidth={50} minHeight={40} keepAspectRatio handleClassName="mm-resize" lineClassName="mm-resize-line" />
      <Handles />
      <div className="mm-image-frame">
        {n.data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.data.imageUrl} alt={n.data.label || "Imagem do mapa"} draggable={false} style={{ width: `${100 / w}%`, height: `${100 / h}%`, left: `${-(c.l / w) * 100}%`, top: `${-(c.t / h) * 100}%` }} />
        ) : <span className="mm-empty">Sem imagem</span>}
      </div>
      {ctx.editing ? <InlineEditor id={n.id} initial={n.data.label} onLabel={ctx.onLabel} /> : n.data.label ? <span className="mm-caption">{n.data.label}</span> : null}
    </div>
  );
}

export const nodeTypes = { concept: ConceptNode, note: NoteNode, image: ImageNode };

/* ---------- documento → React Flow ---------- */

export function toFlowNodes(doc: MapDoc, selected: Set<string>, editingId: string | null, handlers: Pick<NodeCtx, "onToggle" | "onLabel">, measured?: Map<string, { width: number; height: number }>): MMNode[] {
  const hidden = hiddenIds(doc);
  return doc.nodes.map((n) => {
    const fixedSize = n.kind !== "concept" || (n.w && n.h);
    return {
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: { n, ctx: { editing: editingId === n.id, childCount: n.kind === "concept" ? childrenOf(doc, n.id).length : 0, ...handlers } },
      hidden: hidden.has(n.id),
      selected: selected.has(n.id),
      ...(measured?.get(n.id) ? { measured: measured.get(n.id) } : {}),
      zIndex: n.kind === "image" ? 0 : n.kind === "note" ? 1 : 2,
      ...(fixedSize ? { style: { width: n.w ?? (n.kind === "image" ? 220 : 220), height: n.h ?? (n.kind === "image" ? 160 : 110) } } : {}),
    } as MMNode;
  });
}

export function toFlowEdges(doc: MapDoc, selected: Set<string>): Edge[] {
  const hidden = hiddenIds(doc);
  return doc.edges.map((e: MapEdge) => {
    const src = nodeById(doc, e.source);
    const color = e.color ?? (e.kind === "tree" ? paletteStyle(src?.data.color).border : "#5b6675");
    const width = e.width ?? (e.kind === "tree" ? 2.6 : 1.9);
    const marker = (on?: boolean) => (on ? { type: MarkerType.ArrowClosed, color, width: 18, height: 18 } : undefined);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sh,
      targetHandle: e.th,
      type: e.curve === "straight" ? "straight" : e.curve === "step" ? "smoothstep" : "default",
      label: e.label || undefined,
      hidden: hidden.has(e.source) || hidden.has(e.target),
      selected: selected.has(e.id),
      interactionWidth: 28,
      style: { stroke: color, strokeWidth: width, ...(e.dashed ? { strokeDasharray: "7 5" } : {}) },
      markerEnd: marker(e.arrowEnd),
      markerStart: marker(e.arrowStart),
      labelStyle: { fontSize: 12, fontWeight: 650, fill: "#2c3541" },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      zIndex: 1,
    } as Edge;
  });
}
