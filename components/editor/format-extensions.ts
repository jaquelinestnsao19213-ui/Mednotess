import { Extension } from "@tiptap/core";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

export function safeFontFamily(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 200) return null;
  if (/[;{}<>\\]|url\s*\(|expression\s*\(|\/\*/i.test(v)) return null;
  return v;
}

// Família da fonte (guardada dentro da marca "textStyle"): o texto colado mantém a fonte de origem.
export const FontFamily = Extension.create({
  name: "fontFamily",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => safeFontFamily(el.style.fontFamily),
            renderHTML: (attrs: Record<string, unknown>) => {
              const family = safeFontFamily(typeof attrs.fontFamily === "string" ? attrs.fontFamily : null);
              return family ? { style: `font-family: ${family}` } : {};
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontFamily: (family: string) => ({ chain }) => chain().setMark("textStyle", { fontFamily: family }).run(),
      unsetFontFamily: () => ({ chain }) =>
        chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});

function isTransparent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return !t || t === "transparent" || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(t);
}

// Células de tabela com cor de fundo e alinhamento do texto (mantidos ao colar e editáveis depois).
const cellStyleAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.backgroundColor;
      return v && !isTransparent(v) ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.backgroundColor ? { style: `background-color: ${String(attrs.backgroundColor)}` } : {},
  },
  textAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.textAlign;
      return v === "left" || v === "center" || v === "right" || v === "justify" ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.textAlign ? { style: `text-align: ${String(attrs.textAlign)}` } : {},
  },
};

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
});

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
});
