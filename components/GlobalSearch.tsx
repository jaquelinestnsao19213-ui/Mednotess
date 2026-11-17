"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { indexPdf, indexedUrls, isMissingTable, listAttachedPdfs } from "@/lib/pdf-index";

type Hit = { kind: "caderno" | "flashcard" | "question"; id: string; page_id: string | null; title: string; snippet: string | null };
type Smart = {
  id: string;
  title: string;
  icon: string | null;
  typeLabel: string;
  path: string;
  snippet: string;
  matched: string[];
  pdfs: string[];
};
type PdfHit = { pageId: string | null; fileName: string; pageNumber: number; snippet: string; matched: string[] };
type SmartResult = { expanded: boolean; terms: string[]; scanned: number; hits: Smart[]; pdfIndexed: number | null; pdfHits: PdfHit[] };
type Tab = "todos" | Hit["kind"] | "inteligente";

const GROUPS: { kind: Hit["kind"]; label: string }[] = [
  { kind: "caderno", label: "Cadernos" },
  { kind: "flashcard", label: "Flashcards" },
  { kind: "question", label: "Questões" },
];

const hrefOf = (h: Hit) => (h.kind === "caderno" ? `/p/${h.id}` : h.page_id ? `/p/${h.page_id}` : "/revisoes");

// sem acento e minúsculas, com o mesmo tamanho do texto (para marcar o trecho certo)
function fold(text: string) {
  let out = "";
  for (const c of Array.from(text)) {
    const d = c.normalize("NFD");
    const base = d.length > 1 && c.length === 1 ? d[0] : c;
    const lower = base.toLowerCase();
    out += lower.length === c.length ? lower : c;
  }
  return out;
}

function mark(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

// marca no trecho todos os termos encontrados (ignora acentos)
function markTerms(text: string, terms: string[]): ReactNode {
  const plain = fold(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const t = fold(term);
    if (t.length < 2) continue;
    for (let at = plain.indexOf(t); at >= 0; at = plain.indexOf(t, at + t.length)) ranges.push([at, at + t.length]);
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const parts: ReactNode[] = [];
  let pos = 0;
  merged.forEach(([a, b], i) => {
    if (a > pos) parts.push(text.slice(pos, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("todos");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [smart, setSmart] = useState<SmartResult | null>(null);
  const [smartFor, setSmartFor] = useState("");
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexMsg, setIndexMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc("search_study", { term, max_per_group: 8 });
      if (stale) return;
      setError(!!err);
      setHits(err ? [] : ((data ?? []) as Hit[]));
      setLoading(false);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [term]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, []);

  async function runSmart() {
    if (term.length < 2 || smartLoading) return;
    setTab("inteligente");
    setSmartLoading(true);
    setSmartError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Entre novamente para buscar.");
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: term }),
      });
      const payload = (await response.json().catch(() => null)) as (SmartResult & { error?: string }) | null;
      if (!response.ok || !payload || payload.error) throw new Error(payload?.error ?? "A busca inteligente não respondeu. Tente de novo.");
      setSmart(payload);
      setSmartFor(term);
    } catch (cause) {
      setSmartError(cause instanceof Error ? cause.message : "A busca inteligente não respondeu. Tente de novo.");
    } finally {
      setSmartLoading(false);
    }
  }

  // Lê o texto dos PDFs anexados (um por vez, no próprio aparelho) e guarda página por página para a busca.
  async function runIndex() {
    if (indexing) return;
    setIndexing(true);
    try {
      setIndexMsg("Procurando PDFs nas suas páginas…");
      const all = await listAttachedPdfs();
      if (!all.length) { setIndexMsg("Nenhum PDF anexado nas suas páginas."); return; }
      const done = await indexedUrls();
      const todo = all.filter((p) => !done.has(p.url));
      if (!todo.length) { setIndexMsg(`Os ${all.length} PDFs já estão indexados.`); return; }

      let ok = 0;
      const failed: string[] = [];
      const noText: string[] = [];
      for (let i = 0; i < todo.length; i++) {
        const pdf = todo[i];
        try {
          const result = await indexPdf(pdf, (page, total) => setIndexMsg(`Indexando ${i + 1}/${todo.length}: ${pdf.name} (p. ${page}/${total})`));
          if (result.withText === 0) noText.push(pdf.name);
          else ok++;
        } catch (cause) {
          if (isMissingTable(cause as { code?: string; message?: string })) throw cause;
          failed.push(pdf.name);
        }
      }
      const parts = [`${ok} PDF${ok === 1 ? "" : "s"} indexado${ok === 1 ? "" : "s"}.`];
      if (noText.length) parts.push(`Sem texto (escaneado, só imagem): ${noText.join(", ")}.`);
      if (failed.length) parts.push(`Não consegui ler: ${failed.join(", ")}.`);
      setIndexMsg(parts.join(" "));
      if (term.length >= 2) void runSmart();
    } catch (cause) {
      setIndexMsg(
        isMissingTable(cause as { code?: string; message?: string })
          ? "Falta criar a tabela: rode o schema20.sql no Supabase e tente de novo."
          : cause instanceof Error && cause.message
            ? cause.message
            : "Não foi possível indexar agora. Tente de novo."
      );
    } finally {
      setIndexing(false);
    }
  }

  const count = (k: Hit["kind"]) => hits.filter((h) => h.kind === k).length;
  const smartStale = !!smart && smartFor !== term;

  return (
    <div className="gs" ref={box}>
      <div className="gs-field">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && term.length >= 2) { e.preventDefault(); void runSmart(); } }}
          placeholder="Buscar assunto… (Enter = busca inteligente)"
          aria-label="Buscar em cadernos, flashcards e questões"
        />
        {q && <button type="button" onClick={() => { setQ(""); setHits([]); setSmart(null); }} aria-label="Limpar busca">×</button>}
      </div>

      {open && term.length >= 2 && (
        <div className="gs-panel">
          <div className="gs-tabs">
            <button type="button" className={tab === "todos" ? "on" : ""} onClick={() => setTab("todos")}>Tudo {hits.length}</button>
            {GROUPS.map((g) => (
              <button key={g.kind} type="button" className={tab === g.kind ? "on" : ""} onClick={() => setTab(g.kind)}>{g.label} {count(g.kind)}</button>
            ))}
            <button type="button" className={tab === "inteligente" ? "on smart" : "smart"} onClick={() => (smart && !smartStale ? setTab("inteligente") : void runSmart())}>✨ Inteligente</button>
          </div>

          {tab === "inteligente" ? (
            <>
              {smartLoading && <p className="gs-empty">Procurando assuntos relacionados em suas páginas e PDFs…</p>}
              {!smartLoading && smartError && <p className="gs-empty">{smartError}</p>}
              {!smartLoading && !smartError && smart && (
                <>
                  {smartStale && (
                    <p className="gs-note">
                      Resultado de “{smartFor}”. <button type="button" className="gs-link" onClick={() => void runSmart()}>Buscar por “{term}”</button>
                    </p>
                  )}
                  <p className="gs-note">
                    {smart.expanded ? "Procurei também por assuntos relacionados: " : "A IA não respondeu; busquei só pelas suas palavras: "}
                    {smart.terms.slice(0, 12).join(", ")}
                    {smart.terms.length > 12 ? "…" : ""}
                  </p>

                  <section>
                    <h4>Anotações e páginas</h4>
                    {smart.hits.length === 0 && <p className="gs-empty">Nada encontrado nas suas páginas ({smart.scanned} verificadas).</p>}
                    {smart.hits.map((h) => (
                      <Link key={h.id} href={`/p/${h.id}`} className="gs-item" onClick={() => setOpen(false)}>
                        <span>{h.icon ? `${h.icon} ` : ""}{h.title}</span>
                        <small className="gs-path">{h.typeLabel}{h.path ? ` · ${h.path}` : ""}</small>
                        {h.snippet && <small className="gs-snip">{markTerms(h.snippet, h.matched)}</small>}
                        {h.pdfs.length > 0 && <small className="gs-path">PDF: {h.pdfs.join(", ")}</small>}
                        <small className="gs-why">Encontrado: {h.matched.join(", ")}</small>
                      </Link>
                    ))}
                  </section>

                  <section>
                    <h4>Dentro dos PDFs</h4>
                    {smart.pdfIndexed === null && <p className="gs-empty">Para buscar dentro dos PDFs, rode o schema20.sql no Supabase e toque em “Indexar PDFs” abaixo.</p>}
                    {smart.pdfIndexed === 0 && <p className="gs-empty">Nenhum PDF indexado ainda. Toque em “Indexar PDFs” abaixo.</p>}
                    {!!smart.pdfIndexed && smart.pdfHits.length === 0 && <p className="gs-empty">Nada encontrado nos PDFs indexados ({smart.pdfIndexed} páginas).</p>}
                    {smart.pdfHits.map((h, i) => (
                      <Link key={`${h.fileName}-${h.pageNumber}-${i}`} href={h.pageId ? `/p/${h.pageId}` : "/"} className="gs-item" onClick={() => setOpen(false)}>
                        <span>{h.fileName} · p. {h.pageNumber}</span>
                        <small className="gs-snip">{markTerms(h.snippet, h.matched)}</small>
                        <small className="gs-why">Encontrado: {h.matched.join(", ")}</small>
                      </Link>
                    ))}
                  </section>
                </>
              )}
              {!smartLoading && !smartError && !smart && <p className="gs-empty">Toque em ✨ Inteligente ou aperte Enter para buscar assuntos relacionados, mesmo sem as palavras exatas.</p>}

              <div className="gs-index">
                <button type="button" className="gs-link" disabled={indexing} onClick={() => void runIndex()}>{indexing ? "Indexando…" : "📄 Indexar PDFs"}</button>
                {indexMsg && <small>{indexMsg}</small>}
              </div>
            </>
          ) : (
            <>
              {loading && <p className="gs-empty">Buscando…</p>}
              {!loading && error && <p className="gs-empty">A busca ainda não foi ativada. Rode o schema17.sql no Supabase.</p>}
              {!loading && !error && hits.length === 0 && (
                <p className="gs-empty">
                  Nada encontrado para “{term}”. <button type="button" className="gs-link" onClick={() => void runSmart()}>Tentar busca inteligente</button>
                </p>
              )}

              {!loading && !error && GROUPS.filter((g) => tab === "todos" || tab === g.kind).map((g) => {
                const rows = hits.filter((h) => h.kind === g.kind);
                if (!rows.length) return null;
                return (
                  <section key={g.kind}>
                    <h4>{g.label}</h4>
                    {rows.map((h) => (
                      <Link key={`${h.kind}-${h.id}`} href={hrefOf(h)} className="gs-item" onClick={() => setOpen(false)}>
                        <span>{mark(h.title || "Sem título", term)}</span>
                        {h.snippet && <small>{mark(h.snippet, term)}</small>}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </>
          )}
        </div>
      )}

      <style>{`
        .gs{position:relative;max-width:720px;margin:0 auto;padding:4px 20px 8px}
        .gs-field{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);transition:border-color .15s}
        .gs-field:focus-within{border-color:var(--ink);color:var(--ink)}
        .gs-field input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;color:var(--ink)}
        .gs-field button{border:0;background:none;color:var(--muted);font-size:1.25rem;line-height:1;cursor:pointer}
        .gs-panel{position:absolute;left:20px;right:20px;top:calc(100% - 2px);z-index:60;max-height:70vh;overflow:auto;padding:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(27,36,48,.1)}
        .gs-tabs{display:flex;gap:4px;padding-bottom:8px;border-bottom:1px solid var(--line);overflow-x:auto}
        .gs-tabs button{border:0;background:none;padding:6px 10px;border-radius:8px;color:var(--muted);font:inherit;font-size:.9rem;white-space:nowrap;cursor:pointer}
        .gs-tabs button.on{background:var(--bg);color:var(--ink);font-weight:600}
        .gs-tabs button.smart{color:var(--accent);font-weight:600}
        .gs-panel section{padding-top:8px}
        .gs-panel h4{margin:0;padding:4px 10px;font-size:.8rem;font-weight:600;color:var(--muted)}
        .gs-item{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:8px;text-decoration:none;color:var(--ink)}
        .gs-item:hover,.gs-item:focus-visible{background:var(--bg);outline:0}
        .gs-item small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .gs-item small.gs-snip{white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
        .gs-item small.gs-path{font-size:.78rem}
        .gs-item small.gs-why{font-size:.76rem;color:var(--accent)}
        .gs-item mark{background:color-mix(in srgb,var(--accent) 16%,transparent);color:inherit;border-radius:3px;padding:0 1px}
        .gs-empty{margin:0;padding:14px 10px;color:var(--muted)}
        .gs-note{margin:0;padding:8px 10px 2px;color:var(--muted);font-size:.82rem}
        .gs-link{border:0;background:none;padding:0;color:var(--accent);font:inherit;text-decoration:underline;cursor:pointer}
        .gs-link:disabled{opacity:.6;cursor:default;text-decoration:none}
        .gs-index{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:10px 10px 4px;border-top:1px solid var(--line)}
        .gs-index small{color:var(--muted);font-size:.8rem}
      `}</style>
    </div>
  );
}
