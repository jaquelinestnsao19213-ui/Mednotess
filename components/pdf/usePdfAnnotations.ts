"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { sharedAnnKey, useSharedView } from "@/lib/shared-view";
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

// Junta as anotações da dona do caderno (somente leitura, vistas num link publicado) com as do visitante.
function combine(base: PageAnn | undefined, mine: PageAnn | undefined): PageAnn {
  const m = mine ?? EMPTY;
  if (!base) return m;
  return { items: [...base.items, ...m.items], notes: [...base.notes, ...m.notes] };
}

// Tira de volta as anotações da dona, para que só o que é do visitante seja salvo.
function stripBase(base: PageAnn | undefined, a: PageAnn): PageAnn {
  if (!base) return a;
  const itemIds = new Set(base.items.map((i) => i.id));
  const noteIds = new Set(base.notes.map((n) => n.id));
  return {
    items: a.items.filter((i) => !itemIds.has(i.id)),
    notes: a.notes.filter((n) => !noteIds.has(n.id) && !n.ro),
  };
}

// Carrega, salva sozinho (a cada pausa de ~0,7 s) e controla desfazer/refazer.
// O PDF original não é tocado: tudo vai para a tabela pdf_annotations, uma linha por página.
// Em link publicado (visitante): as anotações da dona aparecem só para leitura e as do visitante ficam neste aparelho.
export function usePdfAnnotations(url: string) {
  const shared = useSharedView();
  const token = shared?.token ?? null;

  const [pages, setPages] = useState<Record<number, PageAnn>>({});
  const pagesRef = useRef<Record<number, PageAnn>>({});
  const [base, setBase] = useState<Record<number, PageAnn>>({});
  const baseRef = useRef<Record<number, PageAnn>>({});
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

    // Visitante: salva só neste aparelho (nada vai para o banco da dona).
    if (token) {
      const mine = Array.from(dirty.current);
      if (mine.length === 0) return;
      dirty.current = new Set();
      try {
        localStorage.setItem(sharedAnnKey(url), JSON.stringify(pagesRef.current));
        setStatus("saved");
      } catch {
        mine.forEach((p) => dirty.current.add(p));
        setStatus("error");
        schedule(10000);
      }
      return;
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
  // O que veio da dona do caderno (link publicado) nunca entra no que é salvo.
  const apply = useCallback(
    (page: number, next: PageAnn) => {
      const mine = stripBase(baseRef.current[page], next);
      pagesRef.current = { ...pagesRef.current, [page]: mine };
      setPages(pagesRef.current);
      dirty.current.add(page);
      if (!token) {
        const pend = readPending(url);
        pend[String(page)] = mine;
        writePending(url, pend);
      }
      setStatus("saving");
      schedule(700);
    },
    [url, schedule, token]
  );

  const get = useCallback((n: number): PageAnn => combine(baseRef.current[n], pagesRef.current[n]), []);

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
    apply(op.page, op.undo(get(op.page)));
    bump((v) => v + 1);
    return op.page;
  }, [apply, get]);

  const redo = useCallback((): number | null => {
    const op = redoStack.current.pop();
    if (!op) return null;
    undoStack.current.push(op);
    apply(op.page, op.redo(get(op.page)));
    bump((v) => v + 1);
    return op.page;
  }, [apply, get]);

  // Carrega as anotações do documento.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setLoaded(false);
      setLoadError(false);

      if (token) {
        // Visitante: as próprias anotações vêm deste aparelho; as da dona vêm do banco, só para leitura.
        const map: Record<number, PageAnn> = {};
        try {
          const raw = localStorage.getItem(sharedAnnKey(url));
          if (raw) {
            const obj = JSON.parse(raw) as Record<string, unknown>;
            for (const [k, v] of Object.entries(obj)) map[Number(k)] = normalizeAnn(v);
          }
        } catch {
          /* sem anotações salvas neste aparelho */
        }
        const { data, error } = await supabase.rpc("get_shared_pdf_annotations", { p_token: token, p_doc_url: url });
        if (cancelled) return;
        const owner: Record<number, PageAnn> = {};
        if (!error && Array.isArray(data)) {
          for (const row of data as { page_number: number; data: unknown }[]) {
            const a = normalizeAnn(row.data);
            owner[row.page_number] = { items: a.items, notes: a.notes.map((x) => ({ ...x, ro: true })) };
          }
        }
        baseRef.current = owner;
        setBase(owner);
        pagesRef.current = map;
        setPages(map);
        setLoaded(true);
        setStatus("saved");
        return;
      }

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
  }, [url, reloadKey, schedule, token]);

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

  // O que a tela mostra: anotações da dona (se for link publicado) + as suas.
  const merged = useMemo(() => {
    const out: Record<number, PageAnn> = {};
    const keys = new Set([...Object.keys(pages), ...Object.keys(base)]);
    keys.forEach((k) => {
      const n = Number(k);
      out[n] = combine(base[n], pages[n]);
    });
    return out;
  }, [pages, base]);

  return {
    get,
    pages: merged,
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
