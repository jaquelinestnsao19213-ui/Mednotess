"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Topic } from "@/lib/types";
import type { TreePage } from "@/lib/page-tree";
import { transferCheck, type ImportMode } from "@/lib/topic-links";

export const NEW_TOPIC = "__novo__";

/** Última etapa de "Importar de outro caderno": em qual assunto entra e se é vínculo ou transferência. */
export default function ImportToTopic({
  page,
  pages,
  topics,
  presetTopicId,
  notebookId,
  busy,
  onConfirm,
  onClose,
}: {
  page: TreePage;
  pages: TreePage[];
  topics: Topic[];
  presetTopicId: string | null;
  notebookId: string | null;
  busy: boolean;
  onConfirm: (topicId: string, mode: ImportMode) => void;
  onClose: () => void;
}) {
  const [topicId, setTopicId] = useState(presetTopicId ?? (topics[0]?.id ?? NEW_TOPIC));
  const [mode, setMode] = useState<ImportMode>("link");
  const transfer = transferCheck(pages, page.id, notebookId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pm-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <header className="pm-head">
          <div>
            <h2 id="imp-title">Importar “{page.title || "Sem título"}”</h2>
            <p>Escolha o assunto e como a página entra na disciplina.</p>
          </div>
          <button type="button" className="pm-close" onClick={onClose} aria-label="Fechar"><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="import-body">
          <label>
            Assunto
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value={NEW_TOPIC}>＋ Novo assunto com o nome desta página</option>
            </select>
          </label>

          <fieldset className="import-modes">
            <legend>Como importar</legend>
            <label className={mode === "link" ? "import-opt on" : "import-opt"}>
              <input type="radio" name="import-mode" checked={mode === "link"} onChange={() => setMode("link")} />
              <span><strong>Vincular</strong><small>A página continua no caderno original e também aparece aqui. Os dois acessos abrem a mesma página, sem duplicar.</small></span>
            </label>
            <label className={mode === "move" ? "import-opt on" : "import-opt"} aria-disabled={!transfer.ok}>
              <input type="radio" name="import-mode" checked={mode === "move"} disabled={!transfer.ok} onChange={() => setMode("move")} />
              <span><strong>Transferir</strong><small>{transfer.ok ? "A página sai do caderno de origem e passa a ficar no caderno desta disciplina." : transfer.reason}</small></span>
            </label>
          </fieldset>
        </div>

        <footer className="import-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="primary" disabled={busy} onClick={() => onConfirm(topicId, mode)}>{busy ? "Importando…" : "Importar"}</button>
        </footer>
      </div>
    </div>
  );
}
