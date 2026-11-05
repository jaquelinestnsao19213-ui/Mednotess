"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EMPTY, normalizeAnn, type Op, type PageAnn } from "./types";

export type SaveStatus = "loading" | "saved" | "saving" | "error";

const pendingKey = (url: string) => `mednotes:pdf-pending:${url}`;

function readPending(url: string): Record<string, PageAnn> {
  try {
    const raw = localStorage.getItem(pendingKey(url));
    return raw ? (JSON.parse(raw) as Record<string, PageAnn>) : {};
  } catch {
    return {};
  }
}

function writePending(url: string, obj: Record<string, PageAnn>) {
  try {
    if (Object.keys(obj).length === 0) localStorage.removeItem(pendingKey(url));
    else localStorage.setItem(pendingKey(url), JSON.stringify(obj));
  } catch {
    /* sem espaço no armazenamento local: o salvamento online continua valendo */
  }
}

// Carrega, salva sozinho (a cada pausa de ~0,7 s) e controla desfazer/refazer.
// O PDF original não é tocado: tudo vai para a tabela pdf_annotations, uma linha por página.
export function usePdfAnnotations(url: string) {
  const [pages, setPages] = useState<Record<number, PageAnn>>({});
  const pagesRef = useRef<Record<number, PageAnn>>({});
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [, bump] = useState(0);

  const dirty = useRef<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const userId = useRef<string | null>(null);
  const undoStack = useRef<Op[]>([]);
  const redoStack = useRef<Op[]>([]);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushRef.current();
    }, ms);
  }, []);

  flushRef.current = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) return;
    const list = Array.from(dirty.current);
    if (list.length === 0) return;
    dirty.current = new Set();
    inflight.current = true;
    setStatus("saving");
    let failed = false;
    try {
      if (!userId.current) {
        const { data } = await supabase.auth.getUser();
        if (!data.user) throw new Error("Sem login");
        userId.current = data.user.id;
      }
      const rows = list.map((p) => ({
        user_id: userId.current,
        doc_url: url,
        page_number: p,
        data: pagesRef.current[p] ?? EMPTY,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("pdf_annotations")
        .upsert(rows, { onConflict: "user_id,doc_url,page_number" });
      if (error) throw error;
      const pend = readPending(url);
      for (const p of list) if (!dirty.current.has(p)) delete pend[String(p)];
      writePending(url, pend);
    } catch {
      failed = true;
      list.forEach((p) => dirty.current.add(p));
    }
    inflight.current = false;
    if (failed) {
      setStatus("error");
      schedule(10000);
    } else if (dirty.current.size > 0) {
      setStatus("saving");
      schedule(300);
    } else {
      setStatus("saved");
    }
  };

  // Muda uma página (sem mexer no histórico) e agenda o salvamento.
  const apply = useCallback(
    (page: number, next: PageAnn) => {
      pagesRef.current = { ...pagesRef.current, [page]: next };
      setPages(pagesRef.current);
      dirty.current.add(page);
      const pend = readPending(url);
      pend[String(page)] = next;
      writePending(url, pend);
      setStatus("saving");
      schedule(700);
    },
    [url, schedule]
  );

  const record = useCallback((op: Op) => {
    undoStack.current.push(op);
    if (undoStack.current.length > 150) undoStack.current.shift();
    redoStack.current = [];
    bump((v) => v + 1);
  }, []);

  const undo = useCallback((): number | null => {
    const op = undoStack.current.pop();
    if (!op) return null;
    redoStack.current.push(op);
    apply(op.page, op.undo(pagesRef.current[op.page] ?? EMPTY));
    bump((v) => v + 1);
    return op.page;
  }, [apply]);

  const redo = useCallback((): number | null => {
    const op = redoStack.current.pop();
    if (!op) return null;
    undoStack.current.push(op);
    apply(op.page, op.redo(pagesRef.current[op.page] ?? EMPTY));
    bump((v) => v + 1);
    return op.page;
  }, [apply]);

  // Carrega as anotações do documento.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setLoaded(false);
      setLoadError(false);
      const { data, error } = await supabase
        .from("pdf_annotations")
        .select("page_number,data")
        .eq("doc_url", url);
      if (cancelled) return;
      if (error) {
        setLoadError(true);
        setStatus("error");
        return;
      }
      const map: Record<number, PageAnn> = {};
      for (const row of data ?? []) map[row.page_number as number] = normalizeAnn(row.data);
      // Alterações que não chegaram ao servidor (sem internet, por exemplo) voltam a ser enviadas.
      const pend = readPending(url);
      for (const [k, v] of Object.entries(pend)) {
        const n = Number(k);
        map[n] = normalizeAnn(v);
        dirty.current.add(n);
      }
      pagesRef.current = map;
      setPages(map);
      setLoaded(true);
      if (dirty.current.size > 0) {
        setStatus("saving");
        schedule(500);
      } else {
        setStatus("saved");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey, schedule]);

  // Garante o envio ao esconder a aba, voltar a internet ou fechar o caderno.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    const flushNow = () => void flushRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("online", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("online", flushNow);
      void flushRef.current();
    };
  }, []);

  const get = useCallback((n: number): PageAnn => pagesRef.current[n] ?? EMPTY, []);

  return {
    get,
    pages,
    loaded,
    loadError,
    status,
    apply,
    record,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    retrySave: () => void flushRef.current(),
    reload: () => setReloadKey((k) => k + 1),
  };
}
