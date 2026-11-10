"use client";

import { useEffect, useState } from "react";
import type { Editor as TipEditor } from "@tiptap/core";

type Item = { pos: number; kind: "audio" | "video"; title: string; subject: string };

function collect(editor: TipEditor): Item[] {
  const found: Item[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "audioNote") {
      found.push({ pos, kind: "audio", title: String(node.attrs.title ?? ""), subject: "" });
    } else if (node.type.name === "videoNote") {
      found.push({ pos, kind: "video", title: String(node.attrs.title ?? ""), subject: String(node.attrs.subject ?? "") });
    }
    return true;
  });
  return found;
}

// Lista das mídias da página na ordem em que aparecem (ordem de estudo). Tocar num item leva até o bloco.
export default function MediaIndex({ editor }: { editor: TipEditor }) {
  const [items, setItems] = useState<Item[]>(() => collect(editor));

  useEffect(() => {
    const refresh = () => setItems(collect(editor));
    refresh();
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor]);

  if (items.length === 0) return null;

  function go(item: Item) {
    const dom = editor.view.nodeDOM(item.pos);
    if (!(dom instanceof HTMLElement)) return;
    dom.scrollIntoView({ behavior: "smooth", block: "center" });
    dom.classList.add("mm-flash");
    window.setTimeout(() => dom.classList.remove("mm-flash"), 1400);
  }

  return (
    <details className="mm-index">
      <summary>🎧 Mídias desta página ({items.length})</summary>
      <ol>
        {items.map((item, i) => (
          <li key={`${item.pos}-${i}`}>
            <button type="button" className="mm-index-item" onClick={() => go(item)}>
              <span aria-hidden="true">{item.kind === "audio" ? "🎧" : "🎬"}</span>
              <span className="mm-index-title">{item.title || (item.kind === "audio" ? "Áudio sem título" : "Vídeo sem título")}</span>
              {item.subject && <span className="mm-index-subject">{item.subject}</span>}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
