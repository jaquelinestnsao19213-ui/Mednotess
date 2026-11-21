"use client";

import { useEffect, useState } from "react";
import { getVersion, listVersions, plainText, type PageVersion, type VersionSummary } from "@/lib/page-versions";
import "../app/version-history.css";

const ORIGIN_LABEL = { auto: "Automática", manual: "Manual", restore: "Antes de restaurar" } as const;
const PREVIEW_LIMIT = 8000;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

type Props = {
  pageId: string;
  onClose: () => void;
  onRestore: (version: PageVersion) => Promise<void>;
  onSaveManual: () => Promise<boolean>;
};

export default function VersionHistory({ pageId, onClose, onRestore, onSaveManual }: Props) {
  const [items, setItems] = useState<VersionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PageVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    const rows = await listVersions(pageId);
    setFailed(rows === null);
    setItems(rows ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function open(id: string) {
    setBusy(true);
    setInfo(null);
    const version = await getVersion(id);
    setBusy(false);
    if (!version) return setInfo("Não foi possível abrir esta versão.");
    setSelected(version);
  }

  async function saveNow() {
    setBusy(true);
    const ok = await onSaveManual();
    setInfo(ok ? "Versão salva." : "Não foi possível salvar a versão. Confira se rodou o schema22.sql no Supabase.");
    if (ok) await load();
    setBusy(false);
  }

  async function restore() {
    if (!selected) return;
    const ok = window.confirm(
      `Restaurar a versão de ${fmt(selected.created_at)}? O conteúdo atual será guardado no histórico antes.`
    );
    if (!ok) return;
    setBusy(true);
    await onRestore(selected);
    setBusy(false);
  }

  const text = selected ? plainText(selected.content) : "";

  return (
    <div className="vh-overlay" onClick={onClose}>
      <aside className="vh-panel" role="dialog" aria-label="Histórico de versões" onClick={(e) => e.stopPropagation()}>
        <header className="vh-head">
          {selected ? (
            <button className="secondary small-btn" onClick={() => { setSelected(null); setInfo(null); }}>← Voltar</button>
          ) : (
            <strong>Histórico de versões</strong>
          )}
          <button className="secondary small-btn" onClick={onClose}>Fechar</button>
        </header>

        {info && <p className="vh-info">{info}</p>}

        {selected ? (
          <>
            <p className="vh-meta">
              <strong>{selected.title || "Sem título"}</strong>
              <br />
              {fmt(selected.created_at)} · {ORIGIN_LABEL[selected.origin]}
            </p>
            <pre className="vh-preview">
              {text ? text.slice(0, PREVIEW_LIMIT) + (text.length > PREVIEW_LIMIT ? "\n…" : "") : "(página sem texto)"}
            </pre>
            <p className="vh-hint">A prévia mostra só o texto.</p>
            <button className="vh-primary" disabled={busy} onClick={restore}>Restaurar esta versão</button>
          </>
        ) : (
          <>
            <button className="vh-primary" disabled={busy} onClick={saveNow}>Salvar versão agora</button>
            {items === null && <p className="vh-hint">Carregando…</p>}
            {failed && (
              <p className="vh-info">Não foi possível carregar o histórico. Confira se rodou o schema22.sql no Supabase.</p>
            )}
            {items && !failed && items.length === 0 && (
              <p className="vh-hint">Ainda não há versões. Elas são criadas automaticamente enquanto você escreve.</p>
            )}
            <ul className="vh-list">
              {(items ?? []).map((item) => (
                <li key={item.id}>
                  <button className="vh-item" disabled={busy} onClick={() => void open(item.id)}>
                    <span className="vh-item-date">{fmt(item.created_at)}</span>
                    <span className="vh-item-title">{item.title || "Sem título"}</span>
                    <span className={`vh-tag vh-tag-${item.origin}`}>{ORIGIN_LABEL[item.origin]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
