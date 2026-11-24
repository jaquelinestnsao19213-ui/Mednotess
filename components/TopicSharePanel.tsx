"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Código aleatório e impossível de adivinhar (48 caracteres) que identifica o assunto publicado.
function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Props = {
  topicId: string;
  name: string;
};

// Botão "Compartilhar assunto": um único link somente leitura com todas as páginas, aulas e cadernos do assunto.
export default function TopicSharePanel({ topicId, name }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Descobre se este assunto já está compartilhado (sem o schema23.sql a coluna não existe: fica como não compartilhado).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("topics").select("share_token").eq("id", topicId).maybeSingle();
      if (cancelled || error || !data) return;
      setToken((data as { share_token?: string | null }).share_token ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : "";

  async function publish() {
    setBusy(true);
    setMessage(null);
    const next = newToken();
    const { error } = await supabase.from("topics").update({ share_token: next, shared_at: new Date().toISOString() }).eq("id", topicId);
    setBusy(false);
    if (error) {
      setMessage("Não foi possível publicar. Confira se rodou o schema23.sql no Supabase.");
      return;
    }
    setToken(next);
  }

  async function stop() {
    if (!window.confirm("Parar de compartilhar? O link atual deixa de funcionar para todo mundo.")) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("topics").update({ share_token: null, shared_at: null }).eq("id", topicId);
    setBusy(false);
    if (error) {
      setMessage("Não foi possível parar de compartilhar. Tente de novo.");
      return;
    }
    setToken(null);
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
      await navigator.share({ title: name || "Assunto", url: link });
    } catch {
      /* cancelado */
    }
  }

  return (
    <div className="share-panel" style={{ marginTop: 8 }}>
      <button type="button" className={token ? "secondary small on" : "secondary small"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {token ? "🔗 Assunto compartilhado" : "🔗 Compartilhar assunto"}
      </button>
      {open && (
        <div className="sheet link-box" style={{ position: "static", marginTop: 8 }}>
          {token ? (
            <>
              <p className="muted small" style={{ margin: "0 0 6px" }}>
                Um único link com tudo que está em “{name}”: quem receber vê todas as páginas, aulas e cadernos deste assunto (e dos subassuntos), como estão agora, mas não consegue editar. Os comentários que a pessoa fizer nos PDFs ficam só no aparelho dela. Se você adicionar ou mudar algo, o mesmo link mostra a versão nova.
              </p>
              <input className="link-box-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link do assunto compartilhado" />
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
                Cria um único link com todas as páginas, aulas e cadernos que estão neste assunto (somente leitura). Qualquer pessoa com o link consegue abrir, sem precisar de conta. O resto da disciplina não fica visível.
              </p>
              <div className="sheet-row">
                <button type="button" className="chip on" disabled={busy} onClick={() => void publish()}>{busy ? "Publicando…" : "Publicar assunto"}</button>
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
