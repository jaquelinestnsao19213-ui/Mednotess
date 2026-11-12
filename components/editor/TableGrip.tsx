"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import { boundaryNear, moveNodeTo, stepTarget, tableStartAt } from "../../lib/block-move";

// Alça para mover a tabela: fica fora do texto das células (não seleciona nada ao arrastar) e aparece quando o
// ponteiro passa pela tabela ou quando o cursor está dentro dela. Arrastar leva a tabela para entre quaisquer
// blocos; as setas ↑ ↓ trocam de lugar com o bloco vizinho (ótimo no celular).
export default function TableGrip({ editor }: { editor: Editor }) {
  const [table, setTable] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const gripRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLElement | null>(null);
  tableRef.current = table;

  // qual tabela mostrar: a que está sob o ponteiro ou a que contém o cursor
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const over = (event: PointerEvent) => {
      const found = (event.target as HTMLElement | null)?.closest?.("table");
      if (found && dom.contains(found)) setTable(found as HTMLElement);
      else if (!tableRef.current || !editor.isActive("table")) setTable(null);
    };
    const sync = () => {
      if (!editor.isActive("table")) return;
      const node = editor.view.domAtPos(editor.state.selection.from).node;
      const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest("table");
      if (el && dom.contains(el)) setTable(el as HTMLElement);
    };
    const gone = () => {
      if (tableRef.current && !dom.contains(tableRef.current)) setTable(null);
    };
    dom.addEventListener("pointerover", over);
    editor.on("selectionUpdate", sync);
    editor.on("update", gone);
    return () => {
      dom.removeEventListener("pointerover", over);
      editor.off("selectionUpdate", sync);
      editor.off("update", gone);
    };
  }, [editor]);

  // acompanha a posição da tabela na tela
  useEffect(() => {
    if (!table) return setBox(null);
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = table.getBoundingClientRect();
      setBox(r.bottom < 0 || r.top > window.innerHeight ? null : { left: Math.max(4, r.left), top: Math.max(4, r.top - 40) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    editor.on("update", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      editor.off("update", schedule);
    };
  }, [table, editor]);

  const here = () => {
    const el = tableRef.current;
    if (!el) return null;
    try {
      return tableStartAt(editor.state.doc, editor.view.posAtDOM(el, 0));
    } catch {
      return null;
    }
  };

  function settle(tr: ReturnType<typeof moveNodeTo>) {
    if (!tr) return;
    // cursor dentro da tabela (e não a tabela inteira selecionada), para continuar editando
    tr.setSelection(Selection.near(tr.doc.resolve(tr.selection.from + 1)));
    editor.view.dispatch(tr.scrollIntoView());
  }

  function step(dir: -1 | 1) {
    const from = here();
    if (from === null) return;
    const to = stepTarget(editor.state.doc, from, dir);
    if (to !== null) settle(moveNodeTo(editor.state, from, to));
  }

  function startDrag(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); // não seleciona texto das células
    e.stopPropagation();
    const view = editor.view;
    const start = { x: e.clientX, y: e.clientY };
    let px = start.x, py = start.y, began = false, slot: { at: number } | null = null;
    let ghost: HTMLDivElement | null = null, line: HTMLDivElement | null = null, scroller = 0;
    const type = editor.schema.nodes.table;

    const locate = () => {
      slot = null;
      if (line) line.style.display = "none";
      const from = here();
      const hit = view.posAtCoords({ left: px, top: py });
      if (from === null || !hit) return;
      const before = boundaryNear(view.state.doc, hit.pos, false, type);
      const rect = (view.nodeDOM(before.from) as HTMLElement | null)?.getBoundingClientRect();
      const after = !!rect && py > rect.top + rect.height / 2;
      const target = after ? boundaryNear(view.state.doc, hit.pos, true, type) : before;
      if (!rect || !moveNodeTo(view.state, from, target.at)) return;
      slot = target;
      if (line) Object.assign(line.style, { display: "block", left: `${rect.left}px`, width: `${rect.width}px`, top: `${(after ? rect.bottom : rect.top) - 2}px` });
    };
    const begin = () => {
      began = true;
      setDragging(true);
      ghost = document.createElement("div");
      ghost.className = "tbl-ghost";
      ghost.textContent = "▦ Tabela";
      line = document.createElement("div");
      line.className = "img-dropline";
      document.body.append(ghost, line);
      document.body.style.userSelect = "none";
      scroller = window.setInterval(() => {
        if (py < 80) window.scrollBy(0, -14);
        else if (py > window.innerHeight - 80) window.scrollBy(0, 14);
      }, 30);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("keydown", key);
      window.clearInterval(scroller);
      ghost?.remove();
      line?.remove();
      document.body.style.userSelect = "";
      setDragging(false);
    };
    const move = (ev: PointerEvent) => {
      px = ev.clientX; py = ev.clientY;
      if (!began) {
        if (Math.hypot(px - start.x, py - start.y) < 6) return;
        begin();
      }
      if (ghost) { ghost.style.left = `${px + 10}px`; ghost.style.top = `${py + 10}px`; }
      locate();
    };
    const up = (ev: PointerEvent) => {
      px = ev.clientX; py = ev.clientY;
      const was = began;
      if (was) locate();
      const target = slot;
      cleanup();
      const from = here();
      if (was && target && from !== null) settle(moveNodeTo(view.state, from, target.at));
    };
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && cleanup();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("keydown", key);
  }

  if (!table || !box || !editor.isEditable) return null;
  return (
    <div ref={gripRef} className={dragging ? "tbl-grip dragging" : "tbl-grip"} style={{ left: box.left, top: box.top }} role="toolbar" aria-label="Mover tabela" onMouseDown={(e) => e.preventDefault()}>
      <span className="tbl-drag" onPointerDown={startDrag} title="Arraste para mover a tabela" aria-label="Arrastar tabela" role="button" tabIndex={-1}>⠿</span>
      <button type="button" aria-label="Mover tabela para cima" onClick={() => step(-1)}>↑</button>
      <button type="button" aria-label="Mover tabela para baixo" onClick={() => step(1)}>↓</button>
    </div>
  );
}
