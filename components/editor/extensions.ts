import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageView from "./ImageView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

// Tamanho da fonte (guardado dentro da marca "textStyle").
export const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }) => chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// Imagem com largura salva (para lembrar o tamanho que você escolheu).
export const ImageWithWidth = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const w = parseInt(el.getAttribute("width") ?? "", 10);
          return Number.isFinite(w) ? w : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.width ? { width: attrs.width, style: `width:${attrs.width}px;max-width:100%` } : {},
      },
    };
  },
});

export const ResizableImage = ImageWithWidth.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

// Bloco de destaque (callout) com ícone.
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      icon: {
        default: "💡",
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-icon") ?? "💡",
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]", contentElement: ".callout-body" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": "", "data-icon": node.attrs.icon, class: "callout" }),
      ["div", { class: "callout-body" }, 0],
    ];
  },
});

// Lista recolhível (toggle): a primeira linha é o título; o resto some ao recolher.
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { open: { default: true, rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-toggle]", contentElement: ".toggle-content" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), ["div", { class: "toggle-content" }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "toggle";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toggle-btn";
      btn.contentEditable = "false";
      btn.setAttribute("aria-label", "Abrir ou recolher");
      const contentDOM = document.createElement("div");
      contentDOM.className = "toggle-content";
      dom.append(btn, contentDOM);

      let current = node;
      const paint = () => {
        dom.dataset.open = String(current.attrs.open);
        btn.textContent = current.attrs.open ? "▾" : "▸";
      };
      paint();
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open })
        );
      });
      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          paint();
          return true;
        },
      };
    };
  },
});

// Cartão de PDF anexado: abre em outra aba ao tocar.
export const FileCard = Node.create({
  name: "fileCard",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      url: { default: "", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("href") ?? "" },
      name: { default: "arquivo", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "arquivo" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-file-card]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: node.attrs.url,
        target: "_blank",
        rel: "noopener",
        class: "file-card",
        "data-file-card": "",
        "data-name": node.attrs.name,
      }),
      `📄 ${node.attrs.name}`,
    ];
  },
});

// Garante sempre uma linha livre no fim da página, para continuar escrevendo depois de tabelas, imagens etc.
export const TrailingNode = Extension.create({
  name: "trailingNode",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("trailingNode"),
        appendTransaction: (_transactions, _old, state) => {
          const { doc, tr, schema } = state;
          const last = doc.lastChild;
          if (last && last.type.name !== "paragraph") {
            return tr.insert(doc.content.size, schema.nodes.paragraph.create());
          }
          return null;
        },
      }),
    ];
  },
});
