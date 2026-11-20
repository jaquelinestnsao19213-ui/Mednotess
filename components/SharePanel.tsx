"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Código aleatório e impossível de adivinhar (48 caracteres) que identifica a página publicada.
function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Props = {
  pageId: string;
  pageTitle: string;
  token: string | null;
  onToken: (token: string | null) => void;
};

// Botão "Compartilhar": publica a página em um link somente leitura e permite parar de compartilhar.
export default function SharePanel({ pageId, pageTitle, token, onToken }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : "";

  async function publish() {
    setBusy(true);
    setMessage(null);
    const next = newToken();
    const { error } = await supabase.from("pages").update({ share_token: next, shared_at: new Date().toISOString() }).eq("id", pageId);
    setBusy(false);
    if (error) {
      setMessage("Não foi possível publicar. Confira se rodou o schema21.sql no Supabase.");
      return;
    }
    onToken(next);
  }

  async function stop() {
    if (!window.confirm("Parar de compartilhar? O link atual deixa de funcionar para todo mundo.")) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("pages").update({ share_token: null, shared_at: null }).eq("id", pageId);
    setBusy(false);
    if (error) {
      setMessage("Não foi possível parar de compartilhar. Tente de novo.");
      return;
    }
    onToken(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Link copiado.");
    } catch {
      window.prompt("Copie o link:", link);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: pageTitle || "Caderno", url: link });
    } catch {
      /* cancelado */
    }
  }

  return (
    <div className="share-panel">
      <button type="button" className={token ? "secondary small-btn on" : "secondary small-btn"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {token ? "🔗 Compartilhada" : "🔗 Compartilhar"}
      </button>
      {open && (
        <div className="sheet link-box" style={{ position: "static", marginTop: 8 }}>
          {token ? (
            <>
              <p className="muted small" style={{ margin: "0 0 6px" }}>
                Quem tiver este link vê a página como ela está agora (inclusive os vídeos), mas não consegue editar. Quando você muda a página, o link mostra a versão nova.
              </p>
              <input className="link-box-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link da página compartilhada" />
              <div className="sheet-row">
                <button type="button" className="chip on" onClick={() => void copy()}>Copiar link</button>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button type="button" className="chip" onClick={() => void share()}>Enviar…</button>
                )}
                <button type="button" className="chip" disabled={busy} onClick={() => void stop()}>Parar de compartilhar</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: "0 0 6px" }}>
                Cria um link para outras pessoas verem esta página (somente leitura). Qualquer pessoa com o link consegue abrir, sem precisar de conta. As suas outras páginas não ficam visíveis.
              </p>
              <div className="sheet-row">
                <button type="button" className="chip on" disabled={busy} onClick={() => void publish()}>{busy ? "Publicando…" : "Publicar página"}</button>
                <button type="button" className="chip" onClick={() => setOpen(false)}>Cancelar</button>
              </div>
            </>
          )}
          {message && <p className="link-box-error">{message}</p>}
        </div>
      )}
    </div>
  );
}
