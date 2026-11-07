"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "mednotes-transcriber-shortcut-enabled";

export default function TranscriberShortcut() {
  const [enabled, setEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggleShortcut() {
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
    setMenuOpen(false);
  }

  const buttonStyle: React.CSSProperties = {
    minHeight: 44,
    border: "1px solid var(--line)",
    borderRadius: 999,
    background: "var(--surface)",
    color: "var(--ink)",
    boxShadow: "0 4px 16px rgb(0 0 0 / 0.16)",
  };

  return (
    <div style={{ position: "fixed", right: 14, bottom: "calc(var(--kb, 0px) + 58px)", zIndex: 45, display: "flex", alignItems: "center", gap: 8 }}>
      {enabled && (
        <>
          <Link href="/reunioes" aria-label="Abrir transcritor de áudio" title="Abrir transcritor" style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 14px", textDecoration: "none", fontWeight: 600 }}>
            🎙️ Transcritor
          </Link>
          <button type="button" aria-label="Remover transcritor da barra" title="Remover atalho do transcritor" onClick={toggleShortcut} style={{ ...buttonStyle, width: 44, padding: 0, fontSize: 20 }}>
            ×
          </button>
        </>
      )}
      <div style={{ position: "relative" }}>
        {menuOpen && (
          <div role="menu" aria-label="Opções de inserção" style={{ position: "absolute", right: 0, bottom: 52, width: 220, padding: 8, display: "grid", gap: 6, background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 26px rgb(0 0 0 / 0.16)" }}>
            <button type="button" role="menuitem" onClick={toggleShortcut} style={{ ...buttonStyle, borderRadius: 8, boxShadow: "none", textAlign: "left" }}>
              {enabled ? "Remover transcritor" : "Adicionar transcritor"}
            </button>
          </div>
        )}
        <button type="button" aria-label="Inserir ferramenta" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} style={{ ...buttonStyle, width: 48, padding: 0, fontSize: 26, lineHeight: 1 }}>
          {menuOpen ? "×" : "+"}
        </button>
      </div>
    </div>
  );
}
