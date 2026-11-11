"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type FinalConnectionState, type NodeChange } from "@xyflow/react";
import { errorMessage } from "@/lib/api";
import { uploadFile } from "@/lib/upload";
import type { TreePage } from "@/lib/page-tree";
import {
  type Generated, type MapDoc, type MapEdge, type MapOp, type NodeData,
  addChild, addChildAt, addNode, addSibling, applyOps, canReparent, connectNodes, deleteEdges, deleteNodes, descendantsOf, emptyDoc, layoutTree, mergeGenerated,
  moveNode, nodeById, paletteStyle, refreshTreeHandles, reparent, resizeNode, reverseEdge, setAllCollapsed, sidesBetween, sizeOf, summarizeDoc, toggleCollapse, uid, updateEdge, updateNodeData,
} from "@/lib/mindmap";
import { type MapSave, type SaveStatus, callMapAi, createAutosaver, loadMap, saveMap, MAPS_SETUP_HINT } from "@/lib/mindmap-db";
import { loadTreePages } from "@/lib/mindmap-pages";
import Assistant, { type AssistantMessage } from "./Assistant";
import Inspector, { type InspectorActions } from "./Inspector";
import { type MMNode, nodeTypes, toFlowEdges, toFlowNodes } from "./nodes";

const STATUS_TEXT: Record<SaveStatus, string> = { idle: "", dirty: "Alterações pendentes…", saving: "Salvando…", saved: "Salvo ✓", error: "Erro ao salvar. Tentando de novo…" };

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 300, h: img.naturalHeight || 200 });
    img.onerror = () => reject(new Error("Não consegui ler essa imagem."));
    img.src = url;
  });
}

export default function MindMapEditor({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <Editor id={id} />
    </ReactFlowProvider>
  );
}

function Editor({ id }: { id: string }) {
  const rf = useReactFlow<MMNode>();
  const [phase, setPhase] = useState<"loading" | "setup" | "missing" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [doc, setDocState] = useState<MapDoc>(emptyDoc());
  const [title, setTitle] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [pages, setPages] = useState<TreePage[]>([]);
  const [selNodes, setSelNodes] = useState<string[]>([]);
  const [selEdges, setSelEdges] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "props" | "ai">("none");
  const [moveBranch, setMoveBranch] = useState(true);
  const [boxSelect, setBoxSelect] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: boolean } | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());

  const docRef = useRef(doc);
  const titleRef = useRef(title);
  const sourcesRef = useRef(sources);
  const viewportRef = useRef<MapDoc["viewport"]>(undefined);
  const pastRef = useRef<MapDoc[]>([]);
  const futureRef = useRef<MapDoc[]>([]);
  const coalesceRef = useRef<string | null>(null);
  const skipSave = useRef(true);
  const dragRef = useRef<{ id: string; origin: { x: number; y: number }; start: Map<string, { x: number; y: number }>; moved: Set<string> } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const addImageInput = useRef<HTMLInputElement>(null);
  const replaceImageInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  sourcesRef.current = sources;
  titleRef.current = title;

  const selNodeSet = useMemo(() => new Set(selNodes), [selNodes]);
  const selEdgeSet = useMemo(() => new Set(selEdges), [selEdges]);

  /* ---------- estado do documento com histórico ---------- */
  const setDoc = useCallback((next: MapDoc) => {
    docRef.current = next;
    setDocState(next);
  }, []);

  const commit = useCallback((next: MapDoc, opts: { coalesce?: string } = {}) => {
    const prev = docRef.current;
    if (next === prev) return;
    if (!(opts.coalesce && coalesceRef.current === opts.coalesce)) {
      pastRef.current.push(prev);
      if (pastRef.current.length > 80) pastRef.current.shift();
    }
    coalesceRef.current = opts.coalesce ?? null;
    futureRef.current = [];
    setDoc(next);
    setHistVersion((v) => v + 1);
  }, [setDoc]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(docRef.current);
    coalesceRef.current = null;
    setDoc(prev);
    setHistVersion((v) => v + 1);
  }, [setDoc]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(docRef.current);
    coalesceRef.current = null;
    setDoc(next);
    setHistVersion((v) => v + 1);
  }, [setDoc]);

  const notify = useCallback((text: string, undoable = false) => {
    setToast({ text, undo: undoable });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undoable ? 7000 : 4500);
  }, []);

  /* ---------- carregar ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [record, tree] = await Promise.all([loadMap(id), loadTreePages().catch(() => [] as TreePage[])]);
        if (!alive) return;
        if (record === "setup") return setPhase("setup");
        if (!record) return setPhase("missing");
        skipSave.current = true;
        pastRef.current = [];
        futureRef.current = [];
        viewportRef.current = record.doc.viewport;
        setDoc(record.doc);
        setTitle(record.title);
        setSources(record.sourcePageIds);
        setPages(tree);
        setPhase("ready");
        try {
          const notice = sessionStorage.getItem("mm-notice");
          if (notice) { sessionStorage.removeItem("mm-notice"); setMessages([{ id: uid("m"), role: "ai", text: notice }]); setToast({ text: "Mapa criado. Há um aviso no Assistente IA (✦)." }); setTimeout(() => setToast(null), 8000); }
        } catch { /* sem aviso */ }
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "Não foi possível abrir o mapa.");
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [id, setDoc]);

  /* ---------- salvamento automático ---------- */
  const snapshot = useCallback((): MapSave => ({
    title: titleRef.current,
    doc: { ...docRef.current, viewport: viewportRef.current ?? docRef.current.viewport },
    sourcePageIds: sourcesRef.current,
  }), []);

  const saver = useMemo(() => createAutosaver<MapSave>((value) => saveMap(id, value), (s) => setStatus(s), 1000), [id]);

  useEffect(() => {
    if (phase !== "ready") return;
    if (skipSave.current) { skipSave.current = false; return; }
    saver.schedule(snapshot());
  }, [doc, title, sources, phase, saver, snapshot]);

  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") void saver.flush(); };
    const before = (e: BeforeUnloadEvent) => { if (saver.hasPending()) { void saver.flush(); e.preventDefault(); } };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", () => void saver.flush());
    window.addEventListener("beforeunload", before);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", before);
      void saver.flush();
      saver.dispose();
    };
  }, [saver]);

  // seleção que apontava para algo que já não existe
  useEffect(() => {
    const ids = new Set(doc.nodes.map((n) => n.id));
    const eids = new Set(doc.edges.map((e) => e.id));
    setSelNodes((s) => (s.every((x) => ids.has(x)) ? s : s.filter((x) => ids.has(x))));
    setSelEdges((s) => (s.every((x) => eids.has(x)) ? s : s.filter((x) => eids.has(x))));
  }, [doc]);

  /* ---------- ações sobre o mapa ---------- */
  const centerPos = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect();
    return rf.screenToFlowPosition(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 300, y: 300 });
  }, [rf]);

  const focusOn = useCallback((ids: string[]) => {
    if (!ids.length) return;
    requestAnimationFrame(() => { void rf.fitView({ nodes: ids.map((i) => ({ id: i })), padding: 0.6, duration: 350, maxZoom: 1.2 }); });
  }, [rf]);

  const select = useCallback((nodes: string[], edges: string[] = []) => { setSelNodes(nodes); setSelEdges(edges); }, []);

  const addChildTo = useCallback((parentId: string) => {
    const res = addChild(docRef.current, parentId);
    if (!res.id) return;
    commit(res.doc);
    select([res.id]);
    setEditingId(res.id);
  }, [commit, select]);

  const addSiblingOf = useCallback((nodeId: string) => {
    const res = addSibling(docRef.current, nodeId);
    if (!res.id) return;
    commit(res.doc);
    select([res.id]);
    setEditingId(res.id);
  }, [commit, select]);

  const addConcept = useCallback(() => {
    const only = selNodes.length === 1 ? nodeById(docRef.current, selNodes[0]) : undefined;
    if (only && only.kind === "concept") return addChildTo(only.id);
    const pos = centerPos();
    const res = addNode(docRef.current, "concept", { x: pos.x - 70, y: pos.y - 20 });
    commit(res.doc);
    select([res.id]);
    setEditingId(res.id);
  }, [selNodes, addChildTo, centerPos, commit, select]);

  const addNote = useCallback(() => {
    const pos = centerPos();
    const res = addNode(docRef.current, "note", { x: pos.x - 110, y: pos.y - 55 }, { label: "" });
    commit(res.doc);
    select([res.id]);
    setEditingId(res.id);
  }, [centerPos, commit, select]);

  const removeNodes = useCallback((ids: string[], withBranch: boolean) => {
    if (!ids.length) return;
    commit(deleteNodes(docRef.current, ids, withBranch));
    select([]);
    setEditingId(null);
    notify(ids.length > 1 ? `${ids.length} itens excluídos.` : withBranch ? "Ramo excluído." : "Excluído.", true);
  }, [commit, notify, select]);

  const removeEdges = useCallback((ids: string[]) => {
    if (!ids.length) return;
    commit(deleteEdges(docRef.current, ids));
    select(selNodes);
    notify("Seta excluída.", true);
  }, [commit, notify, select, selNodes]);

  const toggleNode = useCallback((nodeId: string) => commit(toggleCollapse(docRef.current, nodeId)), [commit]);

  const finishLabel = useCallback((nodeId: string, text: string | null) => {
    setEditingId(null);
    if (text === null) return;
    const node = nodeById(docRef.current, nodeId);
    if (!node) return;
    const clean = text.trim();
    if (node.kind === "concept" && !clean) return; // conceito nunca fica sem nome
    if (clean === node.data.label) return;
    commit(updateNodeData(docRef.current, nodeId, { label: clean.slice(0, 600) }));
  }, [commit]);

  const tidy = useCallback(() => {
    commit(layoutTree(docRef.current));
    requestAnimationFrame(() => { void rf.fitView({ padding: 0.2, duration: 400 }); });
    notify("Mapa organizado. Se não gostar, desfaça.", true);
  }, [commit, notify, rf]);

  /* ---------- imagens ---------- */
  const addImageFile = useCallback(async (file: File, at?: { x: number; y: number }) => {
    if (!file.type.startsWith("image/")) return notify("Escolha um arquivo de imagem.");
    notify("Enviando imagem…");
    try {
      const url = await uploadFile(file);
      const dims = await imageSize(url).catch(() => ({ w: 320, h: 220 }));
      const w = Math.min(320, dims.w);
      const h = Math.max(40, Math.round((w * dims.h) / dims.w));
      const pos = at ?? centerPos();
      const res = addNode(docRef.current, "image", { x: pos.x - w / 2, y: pos.y - h / 2 }, { imageUrl: url, label: "", color: "gray" }, { w, h });
      commit(res.doc);
      select([res.id]);
      setPanel((p) => (p === "none" ? "props" : p));
      setToast(null);
    } catch {
      notify("Não foi possível enviar a imagem agora. Tente de novo.");
    }
  }, [centerPos, commit, notify, select]);

  const replaceImageFile = useCallback(async (file: File) => {
    const target = replaceTarget.current;
    if (!target || !file.type.startsWith("image/")) return;
    notify("Enviando imagem…");
    try {
      const url = await uploadFile(file);
      const dims = await imageSize(url).catch(() => null);
      let next = updateNodeData(docRef.current, target, { imageUrl: url, crop: { l: 0, t: 0, r: 0, b: 0 } });
      const node = nodeById(next, target);
      if (dims && node?.w) next = resizeNode(next, target, node.w, Math.round((node.w * dims.h) / dims.w));
      commit(next);
      setToast(null);
    } catch {
      notify("Não foi possível enviar a imagem agora. Tente de novo.");
    }
  }, [commit, notify]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); void addImageFile(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageFile]);

  /* ---------- IA ---------- */
  const say = useCallback((role: AssistantMessage["role"], text: string, undoable = false) => setMessages((m) => [...m, { id: uid("m"), role, text, undoable }]), []);

  const runAi = useCallback(async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setPanel("ai");
    say("user", label);
    try {
      await work();
    } catch (e) {
      say("error", errorMessage(e, "Não foi possível falar com a IA agora. Tente de novo."));
    } finally {
      setBusy(false);
    }
  }, [busy, say]);

  const sendEdit = useCallback(async (command: string, shownAs?: string) => {
    await runAi(shownAs ?? command, async () => {
      const before = docRef.current;
      const only = selNodes.length === 1 ? selNodes[0] : undefined;
      const res = await callMapAi({ action: "edit", command, pageIds: sourcesRef.current, selectedId: only, map: summarizeDoc(before) });
      const ops = Array.isArray(res.ops) ? (res.ops as MapOp[]) : [];
      const message = typeof res.message === "string" ? res.message : "";
      if (!ops.length) return say("ai", message || "Não consegui fazer esse pedido no mapa.");
      // aplica no mapa ATUAL: o que você editou enquanto a IA pensava continua valendo
      const out = applyOps(docRef.current, ops);
      commit(out.doc);
      const known = new Set(before.nodes.map((n) => n.id));
      const created = out.doc.nodes.filter((n) => !known.has(n.id)).map((n) => n.id);
      focusOn(created);
      const inferred = out.doc.nodes.filter((n) => created.includes(n.id) && n.data.inferred).length;
      const parts = [out.report.addedNodes && `${out.report.addedNodes} conceito(s)`, out.report.addedEdges && `${out.report.addedEdges} ligação(ões)`, out.report.updatedNodes && `${out.report.updatedNodes} ajuste(s)`].filter(Boolean).join(", ");
      say("ai", `${message} ${parts ? `Acrescentei: ${parts}.` : ""}${inferred ? ` ${inferred} item(ns) marcados "IA" não estão nas suas anotações: confira.` : ""}`.trim(), true);
    });
  }, [runAi, selNodes, commit, focusOn, say]);

  const updateFromNotes = useCallback(async () => {
    await runAi("Atualizar o mapa com as anotações-fonte", async () => {
      const res = await callMapAi({ action: "update", pageIds: sourcesRef.current, map: summarizeDoc(docRef.current) });
      const gen = res.generated as Generated | undefined;
      if (!gen || !Array.isArray(gen.nodes) || !Array.isArray(gen.links)) throw new Error("A resposta da IA veio incompleta. Tente de novo.");
      const before = docRef.current;
      const out = mergeGenerated(before, gen);
      if (!out.report.addedNodes && !out.report.addedEdges) return say("ai", (typeof res.message === "string" && res.message) || "Seu mapa já cobre o que as anotações trazem. Nada novo a acrescentar.");
      commit(out.doc);
      const known = new Set(before.nodes.map((n) => n.id));
      focusOn(out.doc.nodes.filter((n) => !known.has(n.id)).map((n) => n.id));
      say("ai", `Acrescentei ${out.report.addedNodes} conceito(s) e ${out.report.addedEdges} ligação(ões). Nada do que você editou foi alterado${out.report.keptEdited ? ` (${out.report.keptEdited} conceito(s) seus preservados)` : ""}.`, true);
    });
  }, [runAi, commit, focusOn, say]);

  const findConnections = useCallback(() => sendEdit(
    "Identifique relações entre os conceitos deste mapa e o conteúdo das anotações de diferentes cadernos e disciplinas (por exemplo Farmacologia, Fisiologia, Bioquímica e Patologia). Crie conexões (add_edge) com um verbo curto entre nós que já existem. Só crie um nó novo se faltar um conceito essencial para a ligação.",
    "Buscar conexões entre cadernos e disciplinas"
  ), [sendEdit]);

  /* ---------- eventos do canvas ---------- */
  const onNodesChange = useCallback((changes: NodeChange<MMNode>[]) => {
    let next = docRef.current;
    let touched = false;
    const picked: { id: string; selected: boolean }[] = [];
    const sizes: { id: string; width: number; height: number }[] = [];
    for (const ch of changes) {
      if (ch.type === "select") picked.push({ id: ch.id, selected: ch.selected });
      else if (ch.type === "dimensions" && ch.dimensions && !ch.setAttributes) sizes.push({ id: ch.id, ...ch.dimensions });
      else if (ch.type === "position" && ch.position) {
        next = moveNode(next, ch.id, ch.position.x, ch.position.y);
        touched = true;
        const drag = dragRef.current;
        if (drag) {
          drag.moved.add(ch.id);
          if (drag.id === ch.id && moveBranch) {
            const dx = ch.position.x - drag.origin.x, dy = ch.position.y - drag.origin.y;
            for (const [nid, start] of drag.start) if (nid !== ch.id) { next = moveNode(next, nid, start.x + dx, start.y + dy); drag.moved.add(nid); }
          }
        }
      } else if (ch.type === "dimensions" && ch.setAttributes && ch.dimensions) {
        const n = nodeById(next, ch.id);
        if (n && (n.w !== ch.dimensions.width || n.h !== ch.dimensions.height)) {
          next = resizeNode(next, ch.id, ch.dimensions.width, ch.dimensions.height);
          touched = true;
        }
      }
    }
    if (touched) {
      if (changes.some((c) => c.type === "dimensions")) commit(next, { coalesce: `resize-${changes.find((c) => c.type === "dimensions")?.id}` });
      else setDoc(next);
    }
    if (sizes.length) {
      // o React Flow pede que o app guarde o tamanho medido de cada nó (o mini-mapa depende disso)
      setMeasured((cur) => {
        let copy: Map<string, { width: number; height: number }> | null = null;
        for (const sz of sizes) {
          const old = cur.get(sz.id);
          if (!old || old.width !== sz.width || old.height !== sz.height) { copy = copy ?? new Map(cur); copy.set(sz.id, { width: sz.width, height: sz.height }); }
        }
        return copy ?? cur;
      });
    }
    if (picked.length) {
      setSelNodes((cur) => {
        const set = new Set(cur);
        for (const p of picked) (p.selected ? set.add(p.id) : set.delete(p.id));
        return [...set];
      });
    }
  }, [commit, moveBranch, setDoc]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const picked = changes.filter((c): c is Extract<EdgeChange, { type: "select" }> => c.type === "select");
    if (!picked.length) return;
    setSelEdges((cur) => {
      const set = new Set(cur);
      for (const p of picked) (p.selected ? set.add(p.id) : set.delete(p.id));
      return [...set];
    });
  }, []);

  const onNodeDragStart = useCallback((_: unknown, node: MMNode) => {
    pastRef.current.push(docRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    coalesceRef.current = null;
    const start = new Map<string, { x: number; y: number }>();
    const n = nodeById(docRef.current, node.id);
    if (n && n.kind === "concept" && moveBranch && selNodes.length <= 1) {
      for (const d of descendantsOf(docRef.current, node.id)) {
        const dn = nodeById(docRef.current, d);
        if (dn) start.set(d, { x: dn.x, y: dn.y });
      }
    }
    dragRef.current = { id: node.id, origin: { x: n?.x ?? node.position.x, y: n?.y ?? node.position.y }, start, moved: new Set([node.id]) };
    setHistVersion((v) => v + 1);
  }, [moveBranch, selNodes.length]);

  const onNodeDragStop = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setDoc(refreshTreeHandles(docRef.current, drag.moved));
  }, [setDoc]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    // soltou no corpo do nó (handle "c"): escolhe o lado mais próximo para a linha ficar limpa
    const a = nodeById(docRef.current, c.source), b = nodeById(docRef.current, c.target);
    const auto = a && b ? sidesBetween(a, b) : { sh: undefined, th: undefined };
    const res = connectNodes(docRef.current, c.source, c.target, {
      sh: !c.sourceHandle || c.sourceHandle === "c" ? auto.sh : c.sourceHandle,
      th: !c.targetHandle || c.targetHandle === "c" ? auto.th : c.targetHandle,
    });
    if (!res.id) return notify("Esses dois itens já estão ligados.");
    commit(res.doc);
    select([], [res.id]);
    setPanel("props");
  }, [commit, notify, select]);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return; // soltou no vazio: cria um conceito novo ligado
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const pos = rf.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const res = addChildAt(docRef.current, state.fromNode.id, { x: pos.x - 60, y: pos.y - 20 });
    if (!res.id) return;
    commit(res.doc);
    select([res.id]);
    setEditingId(res.id);
  }, [commit, rf, select]);

  // mapa salvo noutro aparelho (ex.: computador) pode abrir numa região vazia: reenquadra se nada estiver à vista
  const onInit = useCallback(() => {
    const vp = docRef.current.viewport;
    const r = stageRef.current?.getBoundingClientRect();
    if (!vp || !r || !docRef.current.nodes.length) return;
    const otherScreen = !vp.w || !vp.h || Math.abs(vp.w - r.width) / vp.w > 0.15 || Math.abs(vp.h - r.height) / vp.h > 0.15;
    const seen = !otherScreen && docRef.current.nodes.some((n) => {
      const s = sizeOf(n);
      const x = n.x * vp.zoom + vp.x, y = n.y * vp.zoom + vp.y;
      return x + s.w * vp.zoom > 0 && x < r.width && y + s.h * vp.zoom > 0 && y < r.height;
    });
    if (!seen) requestAnimationFrame(() => { void rf.fitView({ padding: 0.2, maxZoom: 1.1 }); });
  }, [rf]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void addImageFile(file, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [addImageFile, rf]);

  /* ---------- atalhos de teclado ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editingId) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selNodes.length) { e.preventDefault(); removeNodes(selNodes, e.shiftKey); }
        else if (selEdges.length) { e.preventDefault(); removeEdges(selEdges); }
        return;
      }
      const only = selNodes.length === 1 ? nodeById(docRef.current, selNodes[0]) : undefined;
      if (e.key === "Tab" && only?.kind === "concept") { e.preventDefault(); addChildTo(only.id); }
      else if (e.key === "Enter" && only?.kind === "concept") { e.preventDefault(); addSiblingOf(only.id); }
      else if (e.key === "F2" && only && only.kind !== "image") { e.preventDefault(); setEditingId(only.id); }
      else if (e.key === "Escape") select([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, selNodes, selEdges, undo, redo, removeNodes, removeEdges, addChildTo, addSiblingOf, select]);

  /* ---------- ações do painel de propriedades ---------- */
  const actions: InspectorActions = useMemo(() => ({
    patchNodes: (ids: string[], patch: Partial<NodeData>, coalesce?: string) => {
      let next = docRef.current;
      for (const nid of ids) next = updateNodeData(next, nid, patch);
      commit(next, { coalesce });
    },
    endCoalesce: () => { coalesceRef.current = null; },
    patchEdge: (eid: string, patch: Partial<MapEdge>, coalesce?: string) => commit(updateEdge(docRef.current, eid, patch), { coalesce }),
    setEdgeKind: (eid: string, kind: "tree" | "link") => {
      const e = docRef.current.edges.find((x) => x.id === eid);
      if (!e || e.kind === kind) return;
      if (kind === "link") return commit(updateEdge(docRef.current, eid, { kind: "link" }));
      const check = canReparent(docRef.current, e.target, e.source);
      if (!check.ok) return notify(check.reason ?? "Não dá para transformar em hierarquia.");
      const next = reparent(docRef.current, e.target, e.source);
      commit(next);
      select([], []);
    },
    reverseEdge: (eid: string) => commit(reverseEdge(docRef.current, eid)),
    removeEdges,
    addChild: addChildTo,
    addSibling: addSiblingOf,
    toggle: toggleNode,
    reparent: (nid: string, parentId: string | null) => {
      const check = canReparent(docRef.current, nid, parentId);
      if (!check.ok) return notify(check.reason ?? "Não dá para mover para lá.");
      commit(reparent(docRef.current, nid, parentId));
    },
    removeNodes,
    replaceImage: (nid: string) => { replaceTarget.current = nid; replaceImageInput.current?.click(); },
    startEdit: (nid: string) => setEditingId(nid),
  }), [commit, notify, removeEdges, addChildTo, addSiblingOf, toggleNode, removeNodes, select]);

  /* ---------- derivados para a tela ---------- */
  const flowNodes = useMemo(() => toFlowNodes(doc, selNodeSet, editingId, { onToggle: toggleNode, onLabel: finishLabel }, measured), [doc, selNodeSet, editingId, toggleNode, finishLabel, measured]);
  const flowEdges = useMemo(() => toFlowEdges(doc, selEdgeSet), [doc, selEdgeSet]);
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void histVersion;
  const only = selNodes.length === 1 ? nodeById(doc, selNodes[0]) : undefined;
  const anyCollapsed = doc.nodes.some((n) => n.data.collapsed);

  if (phase === "loading") return <main className="shell"><p className="muted">Abrindo o mapa…</p></main>;
  if (phase === "setup") return <main className="shell mm-state"><h1 className="display">Mapas mentais</h1><p className="notice">{MAPS_SETUP_HINT}</p></main>;
  if (phase === "missing") return <main className="shell mm-state"><h1 className="display">Mapa não encontrado</h1><p>Ele pode ter sido excluído.</p><Link className="mm-btn" href="/mapas">Voltar aos mapas</Link></main>;
  if (phase === "error") return <main className="shell mm-state"><h1 className="display">Mapas mentais</h1><p className="notice">{loadError}</p><Link className="mm-btn" href="/mapas">Voltar aos mapas</Link></main>;

  return (
    <div className="mm-editor">
      <header className="mm-toolbar">
        <Link href="/mapas" className="mm-btn mm-btn-ghost" aria-label="Voltar para a lista de mapas">←</Link>
        <input className="mm-title" value={title} maxLength={120} aria-label="Título do mapa" placeholder="Título do mapa" onChange={(e) => setTitle(e.target.value)} />
        <span className={`mm-status mm-status-${status}`} role="status">{STATUS_TEXT[status]}</span>
        <div className="mm-tools" role="toolbar" aria-label="Ferramentas do mapa">
          <button type="button" className="mm-btn" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
          <button type="button" className="mm-btn" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Y)">↷ Refazer</button>
          <button type="button" className="mm-btn mm-btn-primary" onClick={addConcept}>＋ {only?.kind === "concept" ? "Filho" : "Conceito"}</button>
          <button type="button" className="mm-btn" onClick={addNote}>＋ Caixa de texto</button>
          <button type="button" className="mm-btn" onClick={() => addImageInput.current?.click()}>＋ Imagem</button>
          <button type="button" className="mm-btn" onClick={tidy} title="Reorganiza os conceitos em árvore">Organizar</button>
          <button type="button" className="mm-btn" onClick={() => commit(setAllCollapsed(docRef.current, !anyCollapsed))}>{anyCollapsed ? "Expandir tudo" : "Recolher tudo"}</button>
          <button type="button" className={`mm-btn${moveBranch ? " on" : ""}`} aria-pressed={moveBranch} onClick={() => setMoveBranch((v) => !v)} title="Ao arrastar um conceito, levar os filhos junto">Mover ramo junto</button>
          <button type="button" className={`mm-btn${boxSelect ? " on" : ""}`} aria-pressed={boxSelect} onClick={() => setBoxSelect((v) => !v)} title="Arrastar na tela para selecionar vários">Seleção em caixa</button>
          <button type="button" className="mm-btn" onClick={() => void rf.fitView({ padding: 0.2, duration: 350 })}>Ver tudo</button>
          <button type="button" className={`mm-btn${panel === "props" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "props" ? "none" : "props"))}>Propriedades</button>
          <button type="button" className={`mm-btn mm-btn-ai${panel === "ai" ? " on" : ""}`} onClick={() => setPanel((p) => (p === "ai" ? "none" : "ai"))}>✦ Assistente IA</button>
        </div>
      </header>

      <div className="mm-stage" ref={stageRef} onDrop={onDrop} onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}>
        <ReactFlow<MMNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onInit={onInit}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_, n) => { if (n.type !== "image") setEditingId(n.id); }}
          onEdgeDoubleClick={(_, e) => { select([], [e.id]); setPanel("props"); }}
          onMoveEnd={(_, vp) => { const box = stageRef.current?.getBoundingClientRect(); viewportRef.current = { ...vp, ...(box ? { w: Math.round(box.width), h: Math.round(box.height) } : {}) }; if (phase === "ready" && !skipSave.current) saver.schedule(snapshot()); }}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={null}
          disableKeyboardA11y
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Meta", "Control", "Shift"]}
          panOnDrag={!boxSelect}
          selectionOnDrag={boxSelect}
          zoomOnDoubleClick={false}
          minZoom={0.08}
          maxZoom={3}
          defaultViewport={doc.viewport}
          fitView={!doc.viewport}
          fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
          onlyRenderVisibleElements={doc.nodes.length > 250}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#cfd6de" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="mm-minimap" nodeColor={(n) => paletteStyle((n as MMNode).data?.n?.data.color).border} />
        </ReactFlow>

        {doc.nodes.length === 0 && (
          <div className="mm-blank">
            <strong>Mapa em branco</strong>
            <p>Toque em “＋ Conceito” para começar, ou peça ao Assistente IA para montar a partir das suas anotações.</p>
          </div>
        )}

        {only && !editingId && panel === "none" && (
          <div className="mm-quick" role="toolbar" aria-label="Ações do item selecionado">
            {only.kind === "concept" && <button type="button" onClick={() => addChildTo(only.id)}>＋ Filho</button>}
            {only.kind === "concept" && <button type="button" onClick={() => addSiblingOf(only.id)}>＋ Irmão</button>}
            {only.kind !== "image" && <button type="button" onClick={() => setEditingId(only.id)}>Editar texto</button>}
            <button type="button" onClick={() => setPanel("props")}>Propriedades</button>
            <button type="button" className="danger" onClick={() => removeNodes([only.id], false)}>Excluir</button>
          </div>
        )}

        {panel !== "none" && (
          <aside className="mm-panel" aria-label={panel === "ai" ? "Assistente de IA" : "Propriedades"}>
            <div className="mm-panel-head">
              <div className="mm-seg">
                <button type="button" className={panel === "props" ? "on" : ""} onClick={() => setPanel("props")}>Propriedades</button>
                <button type="button" className={panel === "ai" ? "on" : ""} onClick={() => setPanel("ai")}>✦ Assistente</button>
              </div>
              <button type="button" className="mm-btn mm-btn-ghost" aria-label="Fechar painel" onClick={() => setPanel("none")}>×</button>
            </div>
            {panel === "props" ? (
              <Inspector doc={doc} selectedNodes={selNodes} selectedEdges={selEdges} pages={pages} actions={actions} />
            ) : (
              <Assistant
                busy={busy}
                messages={messages}
                sources={sources}
                pages={pages}
                selectedLabel={only?.kind === "concept" ? only.data.label : null}
                onSources={setSources}
                onCommand={(t) => void sendEdit(t)}
                onUpdate={() => void updateFromNotes()}
                onConnections={() => void findConnections()}
                onUndo={undo}
              />
            )}
          </aside>
        )}

        {toast && (
          <div className="mm-toast" role="status">
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={() => { undo(); setToast(null); }}>Desfazer</button>}
          </div>
        )}
      </div>

      <input ref={addImageInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addImageFile(f); }} />
      <input ref={replaceImageInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void replaceImageFile(f); }} />
    </div>
  );
}

