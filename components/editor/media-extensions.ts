import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { extFromFile, uploadMedia } from "@/lib/media";
import AudioView from "./AudioView";
import VideoView from "./VideoView";

type CopiedAudio = { url: string; title: string; description: string; duration: number; recorded: boolean };

// Cola áudios copiados com o botão "Copiar áudio". Cada página fica com o seu próprio arquivo,
// assim excluir o áudio numa página não apaga o da outra.
async function pasteAudios(view: EditorView, items: CopiedAudio[]) {
  const type = view.state.schema.nodes.audioNote;
  if (!type) return;
  const nodes = [];
  for (const item of items) {
    let url = item.url;
    try {
      if (url.includes("/storage/v1/object/public/")) {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          url = await uploadMedia(blob, extFromFile({ name: url.split("?")[0], type: blob.type }));
        }
      }
    } catch {
      // sem conseguir duplicar, o player aponta para o mesmo arquivo
    }
    nodes.push(type.create({ ...item, url }));
  }
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView());
}

// Áudio da página (gravado no app ou enviado). Aparece com player completo dentro do texto.
// O HTML de reserva (copiar/exportar) é um link que abre o arquivo.
export const AudioNote = Node.create({
  name: "audioNote",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      url: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("href") ?? "" },
      title: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-title") ?? "" },
      description: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-description") ?? "" },
      duration: { default: 0, rendered: false, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-duration")) || 0 },
      recorded: { default: false, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-recorded") === "true" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-audio-note]", priority: 1000 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: node.attrs.url,
        target: "_blank",
        rel: "noopener",
        class: "file-card",
        "data-audio-note": "",
        "data-title": node.attrs.title,
        "data-description": node.attrs.description,
        "data-duration": String(node.attrs.duration ?? 0),
        "data-recorded": String(Boolean(node.attrs.recorded)),
      }),
      `🎧 ${node.attrs.title || "Áudio"}`,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AudioView, { stopEvent: () => true });
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("audioPaste"),
        props: {
          handleDOMEvents: {
            paste: (view, event) => {
              const html = (event as ClipboardEvent).clipboardData?.getData("text/html") ?? "";
              if (!html.includes("data-audio-note")) return false;
              const d = new window.DOMParser().parseFromString(html, "text/html");
              const anchors = Array.from(d.querySelectorAll<HTMLAnchorElement>("a[data-audio-note]"));
              const rest = d.body.cloneNode(true) as HTMLElement;
              rest.querySelectorAll("a[data-audio-note]").forEach((a) => a.remove());
              if (!anchors.length || rest.textContent?.trim()) return false;
              event.preventDefault();
              void pasteAudios(
                view,
                anchors.map((a) => ({
                  url: a.getAttribute("href") ?? "",
                  title: a.getAttribute("data-title") ?? "",
                  description: a.getAttribute("data-description") ?? "",
                  duration: Number(a.getAttribute("data-duration")) || 0,
                  recorded: a.getAttribute("data-recorded") === "true",
                }))
              );
              return true;
            },
          },
        },
      }),
    ];
  },
});

// Vídeo da página: arquivo enviado, link do YouTube/Vimeo ou link direto de .mp4.
export const VideoNote = Node.create({
  name: "videoNote",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: { default: "file", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") ?? "file" },
      url: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("href") ?? "" },
      title: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-title") ?? "" },
      subject: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-subject") ?? "" },
      description: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-description") ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-video-note]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: node.attrs.url,
        target: "_blank",
        rel: "noopener",
        class: "file-card",
        "data-video-note": "",
        "data-kind": node.attrs.kind,
        "data-title": node.attrs.title,
        "data-subject": node.attrs.subject,
        "data-description": node.attrs.description,
      }),
      `🎬 ${node.attrs.title || node.attrs.url}`,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView, { stopEvent: () => true });
  },
});
