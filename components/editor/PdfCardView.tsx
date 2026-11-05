"use client";

import { Component, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import PdfNotebook from "../pdf/PdfNotebook";

// Se o leitor de PDF falhar, só ele sai do ar: o resto do caderno continua funcionando.
class PdfBoundary extends Component<{ url: string; name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pdfnb-msg" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
        <p style={{ margin: "0 0 8px" }}>
          Não foi possível mostrar o PDF aqui. <a href={this.props.url} target="_blank" rel="noopener noreferrer">Abrir {this.props.name} em outra aba</a>
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0 }}>
          {this.state.error.name}: {this.state.error.message}
        </pre>
      </div>
    );
  }
}

// O PDF anexado aparece aberto dentro da própria página do caderno.
export default function PdfCardView({ node, deleteNode, editor }: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  const name = String(node.attrs.name ?? "arquivo");
  return (
    <NodeViewWrapper className="pdf-block" contentEditable={false}>
      <PdfBoundary url={url} name={name}>
        <PdfNotebook url={url} name={name} onRemove={editor.isEditable ? deleteNode : undefined} />
      </PdfBoundary>
    </NodeViewWrapper>
  );
}
