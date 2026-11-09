"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { TYPE_LABEL } from "@/lib/page-tree";
import type { DropZone } from "@/lib/topic-tree";

export type PageItem = { id: string; title: string; icon: string | null; type: string; path: string };

type Props = {
  id: string;
  name: string;
  isChild: boolean;
  subtitle: string;
  pages: PageItem[];
  expanded: boolean;
  dragging: boolean;
  drop: DropZone | null;
  canUp: boolean;
  canDown: boolean;
  canNest: boolean;
  onHead: () => void;
  onToggle: () => void;
  onImport: () => void;
  onAddSub: () => void;
  onRename: () => void;
  onUp: () => void;
  onDown: () => void;
  onNest: () => void;
  onUnnest: () => void;
  onDelete: () => void;
  onUnlink: (pageId: string) => void;
  onGrip: (e: PointerEvent<HTMLElement>) => void;
  children?: ReactNode;
};

const iconOf = (p: PageItem) => p.icon || (p.type === "notebook" ? "📓" : p.type === "lesson" ? "📚" : "📄");

/** Cartão de um assunto: abre o conteúdo, expande para ver páginas e subassuntos, tem menu e alça para arrastar. */
export default function TopicCard(p: Props) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <li className={`topic-card${p.isChild ? " is-child" : ""}${p.dragging ? " dragging" : ""}`} data-topic-card={p.id}>
      <div className="tc-head" data-topic-head={p.id} data-drop={p.drop ?? undefined}>
        <span className="tc-grip" role="button" aria-label={`Arrastar ${p.name}`} title="Arrastar para reordenar ou colocar dentro de outro assunto" onPointerDown={p.onGrip}>⠿</span>
        <button type="button" className="tc-main" onClick={p.onHead}>
          <span className="tc-icon" aria-hidden="true">{p.expanded ? "📂" : "📁"}</span>
          <span className="tc-text"><strong>{p.name}</strong><small>{p.subtitle}</small></span>
        </button>
        <button type="button" className="tc-chev" aria-expanded={p.expanded} aria-label={`${p.expanded ? "Recolher" : "Expandir"} ${p.name}`} onClick={p.onToggle}>{p.expanded ? "⌃" : "⌄"}</button>
        <div className="tc-menu-wrap" ref={wrap}>
          <button type="button" className="tc-more" aria-label={`Mais ações para ${p.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>⋯</button>
          {menu && (
            <div className="tc-menu" role="menu">
              <button type="button" role="menuitem" onClick={act(p.onRename)}>Renomear</button>
              <button type="button" role="menuitem" disabled={!p.canUp} onClick={act(p.onUp)}>Subir</button>
              <button type="button" role="menuitem" disabled={!p.canDown} onClick={act(p.onDown)}>Descer</button>
              {!p.isChild && p.canNest && <button type="button" role="menuitem" onClick={act(p.onNest)}>Tornar subassunto de…</button>}
              {p.isChild && <button type="button" role="menuitem" onClick={act(p.onUnnest)}>Tirar de dentro</button>}
              <button type="button" role="menuitem" className="danger" onClick={act(p.onDelete)}>Excluir assunto</button>
            </div>
          )}
        </div>
      </div>

      {p.expanded && (
        <div className="tc-body">
          {p.pages.length > 0 && (
            <ul className="tc-pages">
              {p.pages.map((pg) => (
                <li key={pg.id}>
                  <Link href={`/p/${pg.id}`}>
                    <span aria-hidden="true">{iconOf(pg)}</span>
                    <span className="tr-text"><strong>{pg.title || "Sem título"}</strong>{pg.path && <small>{pg.path}</small>}</span>
                    <span className="pm-tag">{TYPE_LABEL[pg.type] ?? ""}</span>
                  </Link>
                  <button type="button" className="tr-unlink" aria-label={`Tirar ${pg.title || "página"} do assunto ${p.name}`} onClick={() => p.onUnlink(pg.id)}>Desvincular</button>
                </li>
              ))}
            </ul>
          )}
          <div className="tc-actions">
            <button type="button" className="secondary small" onClick={p.onImport}>＋ Importar página</button>
            {!p.isChild && <button type="button" className="secondary small" onClick={p.onAddSub}>＋ Subassunto</button>}
          </div>
          {p.children && <ul className="tc-subs">{p.children}</ul>}
        </div>
      )}
    </li>
  );
}
