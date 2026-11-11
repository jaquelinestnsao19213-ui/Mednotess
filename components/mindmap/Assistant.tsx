"use client";

import { useState } from "react";
import { TYPE_LABEL, type TreePage } from "@/lib/page-tree";
import PagePicker from "./PagePicker";

export type AssistantMessage = { id: string; role: "user" | "ai" | "error"; text: string; undoable?: boolean };

const SUGGESTIONS = [
  "Crie uma ramificação sobre os efeitos adversos",
  "Adicione exemplos clínicos neste conceito",
  "Conecte esse mecanismo com a fisiologia renal",
  "Crie um ramo comparando mecanismo de ação e indicações",
];

export default function Assistant({ busy, messages, sources, pages, selectedLabel, onSources, onCommand, onUpdate, onConnections, onUndo }: {
  busy: boolean;
  messages: AssistantMessage[];
  sources: string[];
  pages: TreePage[];
  selectedLabel: string | null;
  onSources: (ids: string[]) => void;
  onCommand: (text: string) => void;
  onUpdate: () => void;
  onConnections: () => void;
  onUndo: () => void;
}) {
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    onCommand(value);
    setText("");
  };
  return (
    <div className="mm-panel-body">
      <h3 className="mm-panel-title">Assistente de construção</h3>
      <p className="mm-hint">A IA só acrescenta e conecta. Ela nunca exclui, e o que você editou ou excluiu é preservado. Tudo pode ser desfeito.</p>

      <div className="mm-field">
        <span className="mm-field-label">Anotações-fonte do mapa ({sources.length})</span>
        <ul className="mm-chips">
          {sources.map((id) => {
            const p = pages.find((x) => x.id === id);
            return (
              <li key={id}>
                <span title={p ? TYPE_LABEL[p.type] : ""}>{p?.title || "Anotação removida"}</span>
                <button type="button" aria-label="Remover fonte" onClick={() => onSources(sources.filter((s) => s !== id))}>×</button>
              </li>
            );
          })}
          {!sources.length && <li className="mm-hint">Nenhuma. Adicione para a IA basear o conteúdo nas suas anotações.</li>}
        </ul>
        <button type="button" className="mm-btn" onClick={() => setPicking((v) => !v)}>{picking ? "Fechar lista" : "Escolher anotações"}</button>
        {picking && <PagePicker pages={pages} selected={sources} onChange={onSources} height={200} />}
      </div>

      <div className="mm-row mm-row-wrap">
        <button type="button" className="mm-btn mm-btn-primary" disabled={busy || !sources.length} onClick={onUpdate}>Atualizar com as anotações</button>
        <button type="button" className="mm-btn" disabled={busy || !sources.length} onClick={onConnections}>Conectar disciplinas</button>
      </div>
      {!sources.length && <small className="mm-hint">Escolha ao menos uma anotação para atualizar o mapa ou buscar conexões.</small>}

      <div className="mm-field">
        <span className="mm-field-label">Peça uma alteração{selectedLabel ? ` (conceito selecionado: ${selectedLabel.slice(0, 40)})` : ""}</span>
        <textarea className="mm-input" rows={3} value={text} placeholder="Ex.: Crie uma ramificação sobre os efeitos adversos" disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
        <button type="button" className="mm-btn mm-btn-primary" disabled={busy || !text.trim()} onClick={send}>{busy ? "A IA está trabalhando…" : "Enviar pedido"}</button>
        <div className="mm-suggest">
          {SUGGESTIONS.map((s) => <button key={s} type="button" disabled={busy} onClick={() => setText(s)}>{s}</button>)}
        </div>
      </div>

      {messages.length > 0 && (
        <ul className="mm-chat" aria-live="polite">
          {messages.slice(-8).map((m) => (
            <li key={m.id} className={`mm-msg mm-msg-${m.role}`}>
              <span>{m.text}</span>
              {m.undoable && <button type="button" className="mm-btn" onClick={onUndo}>Desfazer</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
