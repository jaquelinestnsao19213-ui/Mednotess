"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import PdfNotebook from "../pdf/PdfNotebook";

// O PDF anexado aparece aberto dentro da própria página do caderno.
export default function PdfCardView({ node, deleteNode, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="pdf-block" contentEditable={false}>
      <PdfNotebook
        url={String(node.attrs.url ?? "")}
        name={String(node.attrs.name ?? "arquivo")}
        onRemove={editor.isEditable ? deleteNode : undefined}
      />
    </NodeViewWrapper>
  );
}
