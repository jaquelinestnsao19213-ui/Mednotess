import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { fileExtension, uploadFile } from "@/lib/upload";
import { looksLikeMarkdown, markdownToHtml } from "@/lib/markdown-paste";

// Imagens que já são do nosso Storage não precisam ser copiadas de novo.
const isRemote = (src: string) => /^https?:\/\//i.test(src) && !/\/storage\/v1\/object\//.test(src);

const busy = new Set<string>();
const failed = new Set<string>();

// Depois de colar, baixa as imagens que vieram como link externo (que podem expirar)
// e salva no Storage, trocando o endereço na página. Se o site bloquear o download, mantém o link original.
async function rehostRemoteImages(view: EditorView) {
  const targets: string[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name !== "image") return;
    const src = String(node.attrs.src ?? "");
    if (isRemote(src) && !busy.has(src) && !failed.has(src) && !targets.includes(src)) targets.push(src);
  });

  for (const src of targets) {
    if (view.isDestroyed) return;
    busy.add(src);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("download");
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("tipo");
      const file = new File([blob], `imagem.${fileExtension({ type: blob.type })}`, { type: blob.type });
      const url = await uploadFile(file);
      if (view.isDestroyed) return;
      const tr = view.state.tr;
      let changed = false;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.src === src) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url });
          changed = true;
        }
      });
      if (changed) view.dispatch(tr.setMeta("addToHistory", false));
    } catch {
      failed.add(src);
    } finally {
      busy.delete(src);
    }
  }
}

export const PasteEnhancer = Extension.create({
  name: "pasteEnhancer",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pasteEnhancer"),
        props: {
          handleDOMEvents: {
            paste: (view) => {
              window.setTimeout(() => {
                void rehostRemoteImages(view);
              }, 600);
              return false;
            },
          },
          // Só entra quando a área de transferência tem texto puro (sem HTML): converte o Markdown em formatação.
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data || data.getData("text/html")) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = data.getData("text/plain");
            if (!looksLikeMarkdown(text)) return false;

            const doc = new window.DOMParser().parseFromString(markdownToHtml(text), "text/html");
            const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(doc.body);
            if (slice.content.size === 0) return false;

            event.preventDefault();
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
