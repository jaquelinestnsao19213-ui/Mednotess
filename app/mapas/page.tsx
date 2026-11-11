"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";
import type { TreePage } from "@/lib/page-tree";
import { type Generated, emptyDoc, mergeGenerated, newRootDoc } from "@/lib/mindmap";
import { MAPS_SETUP_HINT, type MapListItem, callMapAi, createMap, deleteMap, duplicateMap, listMaps, renameMap } from "@/lib/mindmap-db";
import { loadTreePages } from "@/lib/mindmap-pages";
import PagePicker from "@/components/mindmap/PagePicker";
import "../mapas.css";

const fmt = (iso: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function MapasPage() {
  const router = useRouter();
  const [items, setItems] = useState<MapListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<TreePage[]>([]);
  const [creating, setCreating] = useState<"none" | "blank" | "ai">("none");
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [size, setSize] = useState<"resumido" | "medio" | "detalhado">("medio");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const refresh = async () => {
    try {
      const res = await listMaps();
      setItems(res.items);
      setSetup(res.setup);
    } catch (e) {
      setError(errorMessage(e, "Não foi possível carregar seus mapas."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (creating === "ai" && !pages.length) loadTreePages().then(setPages).catch(() => setError("Não foi possível carregar suas anotações.")); }, [creating, pages.length]);

  const createBlank = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = title.trim() || "Novo mapa mental";
      router.push(`/mapas/${await createMap(name, newRootDoc(name))}`);
    } catch (e) {
      setError(errorMessage(e, "Não foi possível criar o mapa."));
      setBusy(false);
    }
  };

  const createWithAi = async () => {
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callMapAi({ action: "generate", pageIds: chosen, size, title: title.trim() });
      const gen = res.generated as Generated | undefined;
      if (!gen || !Array.isArray(gen.nodes) || !gen.nodes.length) throw new Error("A IA não devolveu um mapa. Tente de novo.");
      const base = emptyDoc();
      base.meta.sourcePageIds = chosen;
      const { doc } = mergeGenerated(base, gen);
      const name = title.trim() || gen.nodes.find((n) => !n.parentKey)?.label || "Mapa mental";
      router.push(`/mapas/${await createMap(name, doc, chosen)}`);
    } catch (e) {
      setError(errorMessage(e, "Não foi possível gerar o mapa agora."));
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, fail: string) => {
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(errorMessage(e, fail)); }
  };

  return (
    <main className="shell mm-list">
      <header className="mm-list-head">
        <div>
          <span className="eyebrow">MAPAS MENTAIS</span>
          <h1 className="display">Mapas</h1>
          <p className="muted">A IA monta o mapa a partir das suas anotações. Depois você edita tudo livremente.</p>
        </div>
        {!setup && (
          <div className="mm-row">
            <button type="button" className="mm-btn mm-btn-primary" onClick={() => setCreating(creating === "ai" ? "none" : "ai")}>✦ Gerar com IA</button>
            <button type="button" className="mm-btn" onClick={() => setCreating(creating === "blank" ? "none" : "blank")}>Mapa em branco</button>
          </div>
        )}
      </header>

      {setup && <p className="notice">{MAPS_SETUP_HINT}</p>}
      {error && <p className="notice" role="alert">{error}</p>}

      {creating !== "none" && !setup && (
        <section className="mm-card mm-create">
          <label className="mm-field">
            <span className="mm-field-label">{creating === "ai" ? "Tema do mapa (opcional)" : "Título do mapa"}</span>
            <input className="mm-input" value={title} maxLength={120} placeholder={creating === "ai" ? "Ex.: AINEs e via do ácido araquidônico" : "Ex.: Sistema nervoso autônomo"} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {creating === "ai" && (
            <>
              <div className="mm-field">
                <span className="mm-field-label">Quais anotações usar? (aulas, páginas ou cadernos inteiros; pode misturar disciplinas para achar conexões)</span>
                <PagePicker pages={pages} selected={chosen} onChange={setChosen} />
              </div>
              <div className="mm-field">
                <span className="mm-field-label">Tamanho</span>
                <div className="mm-seg">
                  {([["resumido", "Resumido"], ["medio", "Médio"], ["detalhado", "Detalhado"]] as const).map(([v, label]) => <button key={v} type="button" className={size === v ? "on" : ""} onClick={() => setSize(v)}>{label}</button>)}
                </div>
              </div>
            </>
          )}
          <div className="mm-row">
            {creating === "ai"
              ? <button type="button" className="mm-btn mm-btn-primary" disabled={busy || !chosen.length} onClick={() => void createWithAi()}>{busy ? "Montando o mapa… (pode levar 1 minuto)" : "Gerar mapa"}</button>
              : <button type="button" className="mm-btn mm-btn-primary" disabled={busy} onClick={() => void createBlank()}>{busy ? "Criando…" : "Criar e abrir"}</button>}
            <button type="button" className="mm-btn" disabled={busy} onClick={() => setCreating("none")}>Cancelar</button>
          </div>
          {creating === "ai" && <small className="mm-hint">A IA usa só o texto das suas anotações (PDFs e imagens não são lidos). Cada conceito guarda de qual anotação veio.</small>}
        </section>
      )}

      {loading ? <p className="muted">Carregando seus mapas…</p> : !items.length && !setup ? (
        <section className="mm-card mm-empty-card">
          <strong>Você ainda não tem mapas.</strong>
          <p>Escolha algumas anotações e toque em “Gerar com IA”, ou comece um mapa em branco.</p>
        </section>
      ) : (
        <ul className="mm-grid">
          {items.map((m) => (
            <li key={m.id} className="mm-card mm-map-card">
              {renaming === m.id ? (
                <form onSubmit={(e) => { e.preventDefault(); void act(() => renameMap(m.id, renameText), "Não foi possível renomear."); setRenaming(null); }}>
                  <input className="mm-input" autoFocus value={renameText} maxLength={120} onChange={(e) => setRenameText(e.target.value)} onBlur={() => setRenaming(null)} />
                </form>
              ) : (
                <Link href={`/mapas/${m.id}`} className="mm-map-link"><strong>{m.title}</strong><small>Editado em {fmt(m.updated_at)}{m.source_page_ids?.length ? ` · ${m.source_page_ids.length} anotação(ões)-fonte` : ""}</small></Link>
              )}
              <div className="mm-row">
                <button type="button" className="mm-btn" onClick={() => { setRenaming(m.id); setRenameText(m.title); }}>Renomear</button>
                <button type="button" className="mm-btn" onClick={() => void act(() => duplicateMap(m.id), "Não foi possível duplicar.")}>Duplicar</button>
                <button type="button" className="mm-btn mm-btn-danger" onClick={() => { if (window.confirm(`Excluir o mapa “${m.title}”? Isso não pode ser desfeito. Suas anotações não são afetadas.`)) void act(() => deleteMap(m.id), "Não foi possível excluir."); }}>Excluir</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
