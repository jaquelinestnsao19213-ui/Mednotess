import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import AudioView from "./AudioView";
import VideoView from "./VideoView";

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
    return [{ tag: "a[data-audio-note]" }];
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
