"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import InkBlockView from "./InkBlockView";

// Envolve o bloco de caneta com um botão de remover sempre visível.
// (O bloco bloqueia os toques para poder desenhar, então a barra dele nem sempre aparecia.)
export default function InkBlockShell(props: NodeViewProps) {
  const hasInk = Array.isArray(props.node.attrs.items) && props.node.attrs.items.length > 0;

  function remove() {
    if (hasInk && !window.confirm("Remover este bloco de escrita e tudo o que está nele?")) return;
    props.deleteNode();
  }

  return (
    <NodeViewWrapper contentEditable={false}>
      {props.editor.isEditable && (
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
          <button
            type="button"
            aria-label="Remover bloco de escrita"
            onClick={remove}
            style={{
              height: 38,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid var(--line, #d5dbe3)",
              background: "var(--bg, #fff)",
              color: "var(--ink, #1b2430)",
              fontSize: 14,
            }}
          >
            🗑 Remover bloco
          </button>
        </div>
      )}
      <InkBlockView {...props} />
    </NodeViewWrapper>
  );
}
