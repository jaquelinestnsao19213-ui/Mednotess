"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SharedPage } from "@/components/SharedPageView";
import "../../shared-tree.css";

const SharedPageView = dynamic(() => import("@/components/SharedPageView"), { ssr: false });

type TreeRow = { id: string; parent_id: string | null; type: string; title: string; icon: string | null; position: number };
type Tree = { root: string; pages: TreeRow[] };

const TOP = "__top__";

function defaultIcon(type: string): string {
  if (type === "notebook") return "📓";
  if (type === "lesson") return "📝";
  return "📄";
}

type NavProps = {
  parentKey: string;
  kids: Map<string, TreeRow[]>;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
};

// Lista de cadernos, aulas e páginas (a mesma organização do seu caderno).
function NavTree({ parentKey, kids, selected, expanded, onToggle, onPick }: NavProps) {
  const list = kids.get(parentKey) ?? [];
  if (list.length === 0) return null;
  return (
    <ul>
      {list.map((row) => {
        const hasKids = (kids.get(row.id)?.length ?? 0) > 0;
        const open = expanded.has(row.id);
        return (
          <li key={row.id}>
            <div className="shared-nav-row">
              {hasKids ? (
                <button type="button" className="shared-nav-chev" aria-label={open ? "Recolher" : "Expandir"} aria-expanded={open} onClick={() => onToggle(row.id)}>
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span className="shared-nav-chev" aria-hidden="true" />
              )}
              <button type="button" className="shared-nav-item" aria-current={selected === row.id ? "page" : undefined} onClick={() => onPick(row.id)}>
                <span aria-hidden="true">{row.icon || defaultIcon(row.type)}</span>
                <span className="t">{row.title || "Sem título"}</span>
              </button>
            </div>
            {hasKids && open && <NavTree parentKey={row.id} kids={kids} selected={selected} expanded={expanded} onToggle={onToggle} onPick={onPick} />}
          </li>
        );
      })}
    </ul>
  );
}

// Link publicado (somente leitura): abre pelo código do link, sem precisar de conta.
// Mostra a página publicada e tudo que está dentro dela, com a lista de cadernos para navegar.
export default function SharedRoute() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [tree, setTree] = useState<Tree | null>(null);
  const [legacy, setLegacy] = useState<SharedPage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<SharedPage | null>(null);
  const [pageState, setPageState] = useState<"loading" | "ok" | "error">("loading");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [navOpen, setNavOpen] = useState(false);
  const cache = useRef<Map<string, SharedPage>>(new Map());

  // 1) Índice de tudo que foi publicado.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await supabase.rpc("get_shared_tree", { p_token: token });
      if (cancelled) return;
      if (!res.error) {
        const data = res.data as Tree | null;
        if (!data || !Array.isArray(data.pages) || data.pages.length === 0) return setState("missing");
        setTree(data);
        const wanted = window.location.hash.slice(1);
        setSelected(data.pages.some((r) => r.id === wanted) ? wanted : data.root);
        setExpanded(new Set([data.root]));
        setState("ok");
        return;
      }
      // Banco ainda sem o schema22.sql: mostra só a página publicada, como antes.
      const old = await supabase.rpc("get_shared_page", { token });
      if (cancelled) return;
      if (old.error) return setState("error");
      if (!old.data) return setState("missing");
      setLegacy(old.data as SharedPage);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const kids = useMemo(() => {
    const map = new Map<string, TreeRow[]>();
    if (!tree) return map;
    for (const row of tree.pages) {
      const key = row.id === tree.root ? TOP : row.parent_id ?? TOP;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    map.forEach((list) => list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)));
    return map;
  }, [tree]);

  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>();
    if (tree) for (const row of tree.pages) map.set(row.id, row.id === tree.root ? null : row.parent_id);
    return map;
  }, [tree]);

  // Voltar/avançar do navegador e links com #código da página.
  useEffect(() => {
    if (!tree) return;
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (id && parentOf.has(id)) setSelected(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tree, parentOf]);

  const go = useCallback(
    (id: string) => {
      setNavOpen(false);
      if (window.location.hash.slice(1) === id) setSelected(id);
      else window.location.hash = id;
      setSelected(id);
    },
    []
  );

  // Abre os cadernos que levam até a página escolhida.
  useEffect(() => {
    if (!selected) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = parentOf.get(selected) ?? null;
      let guard = 0;
      while (cur && guard++ < 40) {
        next.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
      return next;
    });
  }, [selected, parentOf]);

  // 2) Conteúdo da página escolhida.
  useEffect(() => {
    if (!selected) return;
    window.scrollTo({ top: 0 });
    const cached = cache.current.get(selected);
    if (cached) {
      setPage(cached);
      setPageState("ok");
      return;
    }
    let cancelled = false;
    setPageState("loading");
    (async () => {
      const { data, error } = await supabase.rpc("get_shared_page_in_tree", { p_token: token, p_page_id: selected });
      if (cancelled) return;
      if (error || !data) return setPageState("error");
      cache.current.set(selected, data as SharedPage);
      setPage(data as SharedPage);
      setPageState("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, token]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (state === "loading") return <p className="muted">Carregando…</p>;
  if (state === "error") return <p className="empty">Não foi possível abrir esta página agora. Tente de novo em instantes.</p>;
  if (state === "missing") return <p className="empty">Esta página não está mais compartilhada ou o link está incorreto.</p>;
  if (legacy) return <SharedPageView page={legacy} token={token} />;
  if (!tree) return null;

  const multi = tree.pages.length > 1;
  const inside = selected ? kids.get(selected) ?? [] : [];

  return (
    <div className={multi ? "shared-shell" : "shared-shell single"}>
      {multi && (
        <aside className={navOpen ? "shared-nav open" : "shared-nav"} aria-label="Cadernos e páginas">
          <NavTree parentKey={TOP} kids={kids} selected={selected} expanded={expanded} onToggle={toggle} onPick={go} />
        </aside>
      )}
      <main className="shared-main">
        {multi && (
          <button type="button" className="chip shared-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
            ☰ Cadernos e páginas
          </button>
        )}
        {pageState === "loading" && <p className="muted">Carregando…</p>}
        {pageState === "error" && <p className="empty">Não foi possível abrir esta página agora. Tente de novo em instantes.</p>}
        {pageState === "ok" && page && page.id === selected && (
          <>
            <SharedPageView key={page.id} page={page} token={token} />
            {inside.length > 0 && (
              <section className="shared-inside" aria-label="Dentro desta página">
                <h2>Dentro desta página</h2>
                <div className="shared-inside-list">
                  {inside.map((row) => (
                    <button type="button" key={row.id} className="shared-inside-item" onClick={() => go(row.id)}>
                      <span aria-hidden="true">{row.icon || defaultIcon(row.type)}</span>
                      <span>{row.title || "Sem título"}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
