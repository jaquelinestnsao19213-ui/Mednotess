// Deixa o HTML copiado da página com a formatação "embutida" (estilos dentro de cada tag), para o
// Google Docs, o Word e outros sites manterem títulos, cores, listas, tabelas e avisos como no app.
// Eles ignoram classes e variáveis de CSS, por isso os estilos vão escritos tag por tag.

const INK = "#17212b";
const MUTED = "#475569";
const LINE = "#cbd5e1";
const ACCENT = "#0f766e";

const RULES: [string, string][] = [
  ["h1", "font-size:24pt;font-weight:600;line-height:1.25;margin:18pt 0 4pt"],
  ["h2", "font-size:18pt;font-weight:600;line-height:1.25;margin:16pt 0 4pt"],
  ["h3", "font-size:14pt;font-weight:600;line-height:1.25;margin:14pt 0 4pt"],
  ["p", "margin:0 0 6pt"],
  ["ul,ol", "margin:0 0 6pt;padding-left:24pt"],
  ["li", "margin:0 0 2pt"],
  ["blockquote", `margin:6pt 0;padding:2pt 0 2pt 12pt;border-left:3px solid ${ACCENT};color:${MUTED}`],
  ["pre", "margin:8pt 0;padding:10pt;background:#f1f5f9;border:1px solid #e2e8f0;font-family:Consolas,Menlo,monospace;font-size:10pt;white-space:pre-wrap"],
  ["code", "font-family:Consolas,Menlo,monospace;font-size:.9em;background:#f1f5f9"],
  ["pre code", "background:transparent"],
  ["table", `border-collapse:collapse;width:100%;margin:8pt 0`],
  ["th,td", `border:1px solid ${LINE};padding:5pt 7pt;vertical-align:top`],
  ["th", "background:#f1f5f9;font-weight:600;text-align:left"],
  ["mark", "background-color:#fde68a"],
  ["hr", `border:0;border-top:1px solid ${LINE};margin:12pt 0`],
  ["a", `color:#0f5f59;text-decoration:underline`],
  ["img", "max-width:100%;height:auto"],
  ["s,del", "text-decoration:line-through"],
  ["u", "text-decoration:underline"],
];

const add = (el: Element, css: string) => {
  const own = el.getAttribute("style")?.trim();
  // o que já veio da formatação do texto (cor, tamanho, alinhamento) tem prioridade
  el.setAttribute("style", `${css};${own ? own.replace(/;?$/, "") : ""}`.replace(/;+$/, ""));
};

const wrapAlign = (img: Element, align: string) => {
  const p = img.ownerDocument.createElement("p");
  p.setAttribute("style", `text-align:${align};margin:6pt 0`);
  img.replaceWith(p);
  p.append(img);
};

/** Aplica os estilos embutidos e troca blocos do app (tarefas, avisos, recolhíveis, arquivos) por equivalentes simples. */
export function inlineStyles(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;

  // lista de tarefas: caixa vira ☐ / ☑ (o Docs não entende <input>)
  root.querySelectorAll("li[data-type='taskItem']").forEach((li) => {
    const done = li.getAttribute("data-checked") === "true";
    li.querySelector("label")?.remove();
    const body = li.querySelector(":scope > div");
    const first = body?.firstElementChild ?? body;
    first?.insertBefore(doc.createTextNode(done ? "☑ " : "☐ "), first.firstChild);
    if (body) li.replaceChildren(...Array.from(body.childNodes));
    (li as HTMLElement).style.listStyle = "none";
  });
  root.querySelectorAll("ul[data-type='taskList']").forEach((ul) => ((ul as HTMLElement).style.paddingLeft = "6pt"));

  // aviso: caixa colorida com o ícone no começo
  root.querySelectorAll("div[data-callout]").forEach((box) => {
    const body = box.querySelector(":scope > .callout-body");
    const icon = box.getAttribute("data-icon");
    const first = body?.firstElementChild;
    if (icon && first) first.insertBefore(doc.createTextNode(`${icon} `), first.firstChild);
    if (body) box.replaceChildren(...Array.from(body.childNodes));
    add(box, `padding:10pt 12pt;margin:8pt 0;border:1px solid #dbe3e8;border-left:3px solid ${ACCENT};background-color:#f8fafc`);
  });

  // recolhível: o conteúdo aparece inteiro
  root.querySelectorAll("div[data-toggle]").forEach((box) => {
    const body = box.querySelector(":scope > .toggle-content");
    if (body) box.replaceChildren(...Array.from(body.childNodes));
  });

  // cartões de arquivo e de site viram link
  root.querySelectorAll("a[data-file-card], a[data-web-embed]").forEach((a) => {
    const p = doc.createElement("p");
    a.removeAttribute("class");
    p.append(a.cloneNode(true));
    a.replaceWith(p);
  });

  // imagem alinhada vai dentro de um parágrafo alinhado
  root.querySelectorAll("img[data-align]").forEach((img) => {
    const align = img.getAttribute("data-align");
    if (align && align !== "left") wrapAlign(img, align);
  });

  for (const [selector, css] of RULES) root.querySelectorAll(selector).forEach((el) => add(el, css));
  root.querySelectorAll("img").forEach((img) => {
    const w = img.getAttribute("width");
    if (w) img.setAttribute("style", `${img.getAttribute("style") ?? ""};width:${w}px`.replace(/^;/, ""));
  });
  root.querySelectorAll("table").forEach((t) => t.setAttribute("border", "1"));
  root.querySelectorAll("p,h1,h2,h3,li,td,th").forEach((el) => {
    if (!el.getAttribute("style")?.includes("color:")) add(el, `color:${INK}`);
  });
  root.setAttribute("style", `font-family:Georgia,'Times New Roman',serif;font-size:11pt;line-height:1.55;color:${INK}`);
  return root;
}

import type { EditorView } from "@tiptap/pm/view";
import type { Slice } from "@tiptap/pm/model";

/** HTML (com estilos embutidos) e texto puro do trecho, prontos para a área de transferência. */
export function richClipboard(view: EditorView, slice: Slice): { html: string; text: string } {
  const { dom, text } = view.serializeForClipboard(slice);
  inlineStyles(dom as HTMLElement);
  return { html: (dom as HTMLElement).innerHTML, text };
}
