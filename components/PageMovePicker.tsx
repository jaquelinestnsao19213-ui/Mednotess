"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { loadTreePages } from "@/lib/page-ops";
import { TYPE_LABEL, bringCandidates, linkCandidates, moveCandidates, searchCandidates, type Candidate, type TreePage } from "@/lib/page-tree";

type Props =
  | { mode: "move"; moving: TreePage; onPick: (destinationId: string | null) => void; onClose: () => void }
  | { mode: "bring"; targetId: string | null; targetTitle: string; onPick: (pageId: string) => void; onClose: () => void }
  | { mode: "pick"; title: string; hint: string; excludeIds?: string[]; onPick: (pageId: string) => void; onClose: () => void };

/** Janela para escolher para onde mover uma página, ou qual página trazer para a tabela atual. */
export default function PageMovePicker(props: Props) {
  const [pages, setPages] = useState<TreePage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const { onClose } = props;

  useEffect(() => {
    void loadTreePages().then((list) => { if (list) setPages(list); else setFailed(true); });
    search.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const candidates = useMemo(() => {
    if (!pages) return [];
    const all = props.mode === "move" ? moveCandidates(pages, props.moving) : props.mode === "bring" ? bringCandidates(pages, props.targetId) : linkCandidates(pages, props.excludeIds);
    return searchCandidates(all, query).slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, query, props.mode]);

  const title = props.mode === "move" ? `Mover "${props.moving.title || "Sem título"}" para…` : props.mode === "bring" ? `Trazer para "${props.targetTitle}"` : props.title;
  const hint = props.mode === "move" ? "Escolha o caderno, a aula ou a página de destino." : props.mode === "bring" ? "Escolha a página que deve passar a ficar aqui, de qualquer nível." : props.hint;

  function pick(candidate: Candidate) {
    if (candidate.disabled) return;
    if (props.mode === "move") props.onPick(candidate.id);
    else if (candidate.id) props.onPick(candidate.id);
  }

  return (
    <div className="pm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <header className="pm-head">
          <div><h2 id="pm-title">{title}</h2><p>{hint}</p></div>
          <button type="button" className="pm-close" onClick={onClose} aria-label="Fechar"><X size={18} aria-hidden="true" /></button>
        </header>
        <label className="pm-search"><Search size={16} aria-hidden="true" /><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pelo nome…" aria-label="Buscar" /></label>
        <div className="pm-list" role="listbox" aria-label="Opções">
          {failed && <p className="pm-empty">Não foi possível carregar a lista. Tente de novo.</p>}
          {!failed && pages === null && <p className="pm-empty">Carregando…</p>}
          {pages && candidates.length === 0 && <p className="pm-empty">{query ? "Nada encontrado com esse nome." : props.mode === "move" ? "Não há outro lugar disponível." : "Não há outras páginas para trazer."}</p>}
          {candidates.map((candidate) => (
            <button key={candidate.id ?? "root"} type="button" role="option" aria-selected="false" aria-disabled={!!candidate.disabled} disabled={!!candidate.disabled} className="pm-item" onClick={() => pick(candidate)}>
              <span className="pm-icon" aria-hidden="true">{candidate.icon || (candidate.type === "notebook" || candidate.type === "root" ? "📓" : candidate.type === "lesson" ? "📚" : "📄")}</span>
              <span className="pm-text"><strong>{candidate.title}</strong>{candidate.path && <small>{candidate.path}</small>}</span>
              <span className="pm-tag">{candidate.disabled ?? TYPE_LABEL[candidate.type] ?? ""}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
