"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { Topic } from "@/lib/types";

/** Escolher dentro de qual assunto principal o assunto vai virar subassunto. */
export default function TopicParentPicker({ name, options, onPick, onClose }: { name: string; options: Topic[]; onPick: (parentId: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="tpp-title">
        <header className="pm-head">
          <div><h2 id="tpp-title">Colocar “{name}” dentro de…</h2><p>Escolha o assunto principal que vai receber este como subassunto.</p></div>
          <button type="button" className="pm-close" onClick={onClose} aria-label="Fechar"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="pm-list" role="listbox" aria-label="Assuntos">
          {options.length === 0 && <p className="pm-empty">Não há outro assunto principal disponível.</p>}
          {options.map((t) => (
            <button key={t.id} type="button" role="option" aria-selected="false" className="pm-item" onClick={() => onPick(t.id)}>
              <span className="pm-icon" aria-hidden="true">📁</span>
              <span className="pm-text"><strong>{t.name}</strong></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
