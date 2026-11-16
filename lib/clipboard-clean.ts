// Limpa o HTML colado de outros apps/sites: remove o que é perigoso, mas MANTÉM a formatação útil
// (fonte, tamanho, cor, alinhamento, fundo de célula, negrito, itálico, listas e tabelas).

const ALLOWED_STYLES = new Set([
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-align",
  "text-decoration",
  "text-decoration-line",
]);

// Estilos que o editor guarda dentro da marca de texto (textStyle).
const CARRY = ["font-family", "font-size", "color"] as const;

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
  "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE",
  "HEADER", "FOOTER", "FIGURE", "FIGCAPTION",
]);

const INLINE_WITH_STYLE = "strong, b, em, i, u, s, strike, del, a, code, mark, sub, sup, small, big";

// Texto quase branco (cópia feita de um app em modo escuro) some na página clara: ignora essa cor.
function isNearWhite(value: string): boolean {
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return Number(m[1]) >= 225 && Number(m[2]) >= 225 && Number(m[3]) >= 225;
  return /^(#fff(fff)?|white)$/i.test(value.trim());
}

function textProps(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of CARRY) {
    const v = el.style.getPropertyValue(p).trim();
    if (v) out[p] = v;
  }
  return out;
}

function wrapChildren(el: HTMLElement, props: Record<string, string>) {
  if (!el.firstChild || !Object.keys(props).length) return;
  const span = el.ownerDocument.createElement("span");
  span.setAttribute("style", Object.entries(props).map(([k, v]) => `${k}: ${v}`).join("; "));
  while (el.firstChild) span.appendChild(el.firstChild);
  el.appendChild(span);
}

const isBlock = (n: Node) => n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName);

// O editor só lê fonte/tamanho/cor de elementos <span>. Navegadores costumam colocar esses estilos
// no parágrafo, título, item de lista ou célula; aqui eles são levados para dentro de um <span>.
function carryTextStyles(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>(INLINE_WITH_STYLE).forEach((el) => wrapChildren(el, textProps(el)));

  const walk = (el: HTMLElement, inherited: Record<string, string>) => {
    const own = { ...inherited, ...textProps(el) };
    const kids = Array.from(el.childNodes);
    if (kids.some(isBlock)) {
      kids.forEach((k) => {
        if (k.nodeType === 1) walk(k as HTMLElement, own);
      });
    } else if (el.tagName !== "SPAN") {
      wrapChildren(el, own);
    }
  };
  walk(body, {});
}

export function cleanClipboardHTML(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, textarea, select, svg, math").forEach((el) => el.remove());

  const safeUrl = (value: string, image: boolean) => {
    try {
      const url = new URL(value, doc.baseURI);
      return (url.protocol === "http:" || url.protocol === "https:" || (!image && url.protocol === "mailto:"))
        ? url.href
        : "";
    } catch {
      return "";
    }
  };

  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "contenteditable") {
        el.removeAttribute(attr.name);
      } else if (name === "style") {
        const style = (el as HTMLElement).style;
        const kept: string[] = [];
        for (const property of Array.from(style)) {
          const value = style.getPropertyValue(property).trim();
          if (!ALLOWED_STYLES.has(property) || !value) continue;
          if (/url\s*\(|expression\s*\(/i.test(value)) continue;
          if (property === "color" && isNearWhite(value)) continue;
          kept.push(`${property}: ${value}`);
        }
        if (kept.length) el.setAttribute("style", kept.join("; "));
        else el.removeAttribute("style");
      } else if (name === "href" || name === "src") {
        const url = safeUrl(attr.value, el.tagName.toLowerCase() === "img");
        if (url) el.setAttribute(name, url);
        else el.removeAttribute(name);
      }
    }
  });

  carryTextStyles(doc.body);
  return doc;
}
