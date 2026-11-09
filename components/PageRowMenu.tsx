"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Ellipsis } from "lucide-react";

export type RowMenuItem = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean };

/** Subir/descer e menu "⋯" de uma linha (mover, subir um nível, excluir). O menu é fixo na tela para não ser cortado pela rolagem da tabela. */
export default function PageRowMenu({ name, canUp, canDown, onUp, onDown, items }: { name: string; canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 8 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter((item) => !item.hidden);

  function toggle() {
    if (open) return setOpen(false);
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setPos({ right: Math.max(8, window.innerWidth - rect.right), ...(below < 200 ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (event: MouseEvent | TouchEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="row-tools">
      <button type="button" className="row-btn" disabled={!canUp} onClick={onUp} aria-label={`Subir ${name}`} title="Subir"><ChevronUp size={17} aria-hidden="true" /></button>
      <button type="button" className="row-btn" disabled={!canDown} onClick={onDown} aria-label={`Descer ${name}`} title="Descer"><ChevronDown size={17} aria-hidden="true" /></button>
      <button type="button" ref={button} className="row-btn" aria-haspopup="menu" aria-expanded={open} onClick={toggle} aria-label={`Mais ações para ${name}`} title="Mais ações"><Ellipsis size={18} aria-hidden="true" /></button>
      {open && (
        <div className="row-menu" role="menu" ref={menu} style={pos}>
          {visible.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : ""} onClick={() => { setOpen(false); item.onClick(); }}>{item.icon}<span>{item.label}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
