"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";
import type { TreePage } from "@/lib/page-tree";
import { type Generated, type GenLink, emptyDoc, layoutTree, mergeGenerated, newRootDoc } from "@/lib/mindmap";
import { expandToPages } from "@/lib/mindmap-expand";
import { MAPS_SETUP_HINT, type MapListItem, callMapAi, createMap, deleteMap, duplicateMap, listMaps, renameMap } from "@/lib/mindmap-db";
import { loadTreePages } from "@/lib/mindmap-pages";
import PagePicker from "@/components/mindmap/PagePicker";
import "../mapas.css";

const NOTICE_KEY = "mm-notice";
const fmt = (iso: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const gen0Label = (g: Generated) => g.nodes.find((n) => !n.parentKey)?.label ?? "";

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
  const [size, setSize] = useState<"resumido" | "medio" | "detalhado">("detalhado");
  const [progress, setProgress] = useState<{ done: number; total: number; current: string[]; failed: string[] } | null>(null);
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

  const plan = expandToPages(pages, chosen);

  /** Lê UMA anotação por vez (resposta completa e aprofundada para cada), junta tudo e liga as disciplinas no final. */
  const createWithAi = async () => {
    if (!plan.ids.length) return;
    setBusy(true);
    setError(null);
    const titleOf = (id: string) => pages.find((p) => p.id === id)?.title || "Sem título";
    const state = { done: 0, current: new Set<string>(), failed: [] as string[], skipped: 0 };
    const publish = () => setProgress({ done: state.done, total: plan.ids.length, current: [...state.current], failed: [...state.failed] });
    const results: (Generated | null)[] = plan.ids.map(() => null);
    publish();
    try {
      let next = 0;
      const worker = async () => {
        while (next < plan.ids.length) {
          const i = next++;
          const id = plan.ids[i];
          state.current.add(titleOf(id));
          publish();
          try {
            const res = await callMapAi({ action: "generate", pageIds: [id], size, title: title.trim() });
            const gen = res.generated as Generated | undefined;
            if (gen && Array.isArray(gen.nodes) && gen.nodes.length) {
              const px = `p${i}-`;
              results[i] = {
                nodes: gen.nodes.map((n) => ({ ...n, key: px + n.key, parentKey: n.parentKey ? px + n.parentKey : null })),
                links: (gen.links ?? []).map((l) => ({ ...l, from: px + l.from, to: px + l.to })),
              };
            } else state.skipped++;
          } catch (e) {
            const status = (e as { status?: number }).status;
            if (status === 422) state.skipped++; // anotação sem texto: só pula
            else state.failed.push(titleOf(id));
          } finally {
            state.current.delete(titleOf(id));
            state.done++;
            publish();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, plan.ids.length) }, worker));

      const ok = results.filter((r): r is Generated => !!r);
      if (!ok.length) throw new Error(state.failed.length ? "A IA não conseguiu ler as anotações agora. Tente de novo em instantes ou com menos anotações." : "As anotações escolhidas não têm texto para gerar o mapa.");

      const base = emptyDoc();
      base.meta.sourcePageIds = plan.ids.slice(0, 12);
      let doc = base;
      for (const gen of ok) doc = mergeGenerated(doc, gen).doc;
      doc = layoutTree(doc);

      // etapa final: ligações entre anotações e disciplinas diferentes (sugestões, marcadas para conferir)
      let linkNote = "";
      if (ok.length >= 2) {
        setProgress({ done: plan.ids.length, total: plan.ids.length, current: ["Ligando as disciplinas…"], failed: state.failed });
        try {
          const nodes = doc.nodes.filter((n) => n.data.aiKey).slice(0, 260).map((n) => ({ key: n.data.aiKey, label: n.data.label, detail: n.data.detail ?? "", discipline: n.data.discipline ?? "", note: titleOf(n.data.pageId ?? "") }));
          const res = await callMapAi({ action: "link", map: { nodes } });
          const links = (Array.isArray(res.links) ? res.links : []) as GenLink[];
          if (links.length) doc = mergeGenerated(doc, { nodes: [], links }).doc;
        } catch {
          linkNote = " Não consegui sugerir ligações entre as disciplinas agora; use “Conectar disciplinas” dentro do mapa.";
        }
      }
      const name = title.trim() || gen0Label(ok[0]) || "Mapa mental";
      const notes = [
        state.failed.length ? `Não consegui ler: ${state.failed.slice(0, 4).join(", ")}${state.failed.length > 4 ? "…" : ""}. Use “Atualizar com as anotações” para tentar de novo.` : "",
        linkNote.trim(),
        plan.truncated ? "Você escolheu mais anotações do que o limite (24); as demais ficaram de fora." : "",
      ].filter(Boolean).join(" ");
      if (notes) { try { sessionStorage.setItem(NOTICE_KEY, notes); } catch { /* sem aviso: tudo bem */ } }
      router.push(`/mapas/${await createMap(name, doc, plan.ids.slice(0, 12))}`);
    } catch (e) {
      setError(errorMessage(e, "Não foi possível gerar o mapa agora."));
      setBusy(false);
      setProgress(null);
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
                <span className="mm-field-label">Quais anotações usar? (pode escolher cadernos inteiros, aulas ou páginas, e misturar disciplinas para achar conexões)</span>
                <PagePicker pages={pages} selected={chosen} onChange={setChosen} max={30} />
              </div>
              <div className="mm-field">
                <span className="mm-field-label">Tamanho</span>
                <div className="mm-seg">
                  {([["resumido", "Resumido"], ["medio", "Médio"], ["detalhado", "Aprofundado"]] as const).map(([v, label]) => <button key={v} type="button" className={size === v ? "on" : ""} onClick={() => setSize(v)}>{label}</button>)}
                </div>
              </div>
            </>
          )}
          <div className="mm-row">
            {creating === "ai"
              ? <button type="button" className="mm-btn mm-btn-primary" disabled={busy || !plan.ids.length} onClick={() => void createWithAi()}>{busy ? "Montando o mapa…" : "Gerar mapa"}</button>
              : <button type="button" className="mm-btn mm-btn-primary" disabled={busy} onClick={() => void createBlank()}>{busy ? "Criando…" : "Criar e abrir"}</button>}
            <button type="button" className="mm-btn" disabled={busy} onClick={() => setCreating("none")}>Cancelar</button>
          </div>
          {creating === "ai" && chosen.length > 0 && !busy && (
            <small className="mm-hint">
              {plan.ids.length ? `${plan.ids.length} anotação(ões) serão lidas${plan.fromContainers ? `, incluindo ${plan.fromContainers} de dentro dos cadernos escolhidos` : ""}. A IA lê uma por vez, com profundidade (cerca de 30 a 60 segundos cada, 3 ao mesmo tempo).` : "Os itens escolhidos não têm aulas ou páginas com texto."}
              {plan.truncated ? " Limite de 24 anotações por mapa; escolha menos para incluir as demais." : ""}
            </small>
          )}
          {progress && (
            <div className="mm-progress" role="status" aria-live="polite">
              <div className="mm-progress-bar"><i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
              <strong>{progress.done} de {progress.total} anotações lidas</strong>
              {progress.current.length > 0 && <small>Lendo agora: {progress.current.join(" · ")}</small>}
              {progress.failed.length > 0 && <small className="mm-warn-text">Não consegui ler: {progress.failed.join(", ")}</small>}
            </div>
          )}
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
