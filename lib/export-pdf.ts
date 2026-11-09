import type { Editor as TiptapEditor } from "@tiptap/core";
import { normalizeStrokes, strokesToSvg } from "./image-strokes";

const PRINT_STYLES = `
  @page { size: A4; margin: 18mm 19mm 20mm; }
  * { box-sizing: border-box; }
  html { color: #17212b; background: #fff; }
  body {
    margin: 0;
    color: #17212b;
    background: #fff;
    font: 11pt/1.65 Georgia, "Times New Roman", serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pdf-shell { max-width: 100%; }
  .pdf-heading { margin: 0 0 22pt; padding-bottom: 12pt; border-bottom: 1px solid #dbe3e8; }
  .pdf-title {
    margin: 0;
    font: 600 24pt/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: -0.035em;
    overflow-wrap: anywhere;
  }
  .pdf-meta { margin: 7pt 0 0; color: #64748b; font: 9pt/1.4 system-ui, sans-serif; }
  .annotation { overflow-wrap: anywhere; }
  .annotation > * + * { margin-top: .65em; }
  .annotation h1, .annotation h2, .annotation h3 {
    margin: 1em 0 .35em;
    line-height: 1.25;
    letter-spacing: -.02em;
    break-after: avoid-page;
  }
  .annotation h1 { font-size: 19pt; }
  .annotation h2 { font-size: 16pt; }
  .annotation h3 { font-size: 13pt; }
  .annotation p { margin: 0; }
  .annotation ul, .annotation ol { margin: .35em 0; padding-left: 1.5em; }
  .annotation li { break-inside: avoid; }
  .annotation blockquote {
    margin: .8em 0;
    padding: 2pt 0 2pt 12pt;
    border-left: 3px solid #0f766e;
    color: #475569;
  }
  .annotation code {
    font: .9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #f1f5f9;
    border-radius: 3px;
    padding: 1px 4px;
  }
  .annotation pre {
    margin: .8em 0;
    padding: 10pt;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    break-inside: avoid;
  }
  .annotation pre code { padding: 0; background: transparent; }
  .annotation table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: .8em 0;
    font-size: 10pt;
    break-inside: auto;
  }
  .annotation tr { break-inside: avoid; }
  .annotation th, .annotation td {
    border: 1px solid #cbd5e1;
    padding: 5pt 7pt;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .annotation th { background: #f1f5f9; text-align: left; }
  .annotation img, .annotation video {
    display: block;
    max-width: 100%;
    height: auto;
    margin: .8em auto;
    break-inside: avoid;
  }
  .annotation mark { background: #fde68a; }
  .annotation hr { border: 0; border-top: 1px solid #cbd5e1; margin: 1.1em 0; }
  .annotation a { color: #0f5f59; text-decoration: underline; text-underline-offset: 2px; }
  .annotation .callout {
    padding: 10pt 12pt;
    border: 1px solid #dbe3e8;
    border-left: 3px solid #0f766e;
    border-radius: 5px;
    background: #f8fafc;
    break-inside: avoid;
  }
  .annotation .toggle-content { display: block !important; }
  .annotation .toggle-btn, .annotation .img-handle, .annotation .img-toolbar { display: none !important; }
  .annotation .img-wrap, .annotation .img-box { max-width: 100%; }
  .annotation .file-card { color: #0f5f59; text-decoration: underline; }
  @media screen {
    body { max-width: 760px; margin: 32px auto; padding: 0 32px; }
  }
`;

function makeFilename(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${slug || "anotacao"}.pdf`;
}

/** Opens a print-ready, A4 version of the current Tiptap document. */
export function exportEditorAsPdf(editor: TiptapEditor, fallbackTitle = "Anotação"): boolean {
  // Open synchronously from the click handler so popup blockers allow the print window.
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return false;
  printWindow.opener = null;

  const titleInput = document.querySelector<HTMLInputElement>(".title-input");
  const title = titleInput?.value.trim() || fallbackTitle.trim() || "Anotação";
  const printDocument = printWindow.document;
  printDocument.documentElement.lang = "pt-BR";
  printDocument.title = makeFilename(title);

  const style = printDocument.createElement("style");
  style.textContent = PRINT_STYLES;
  printDocument.head.appendChild(style);

  const main = printDocument.createElement("main");
  main.className = "pdf-shell";
  const header = printDocument.createElement("header");
  header.className = "pdf-heading";
  const heading = printDocument.createElement("h1");
  heading.className = "pdf-title";
  heading.textContent = title;
  const metadata = printDocument.createElement("p");
  metadata.className = "pdf-meta";
  metadata.textContent = `Anotação exportada em ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date())}`;
  header.append(heading, metadata);

  const article = printDocument.createElement("article");
  article.className = "annotation";
  const parsedContent = new DOMParser().parseFromString(editor.getHTML(), "text/html");
  parsedContent.body.querySelectorAll(".toggle-btn, .img-handle, [data-placeholder]").forEach((element) => element.remove());
  parsedContent.body.querySelectorAll<HTMLElement>('[data-open="false"]').forEach((element) => {
    element.dataset.open = "true";
  });
  article.append(...Array.from(parsedContent.body.childNodes, (node) => printDocument.importNode(node, true)));

  main.append(header, article);
  printDocument.body.replaceChildren(main);

  const images = Array.from(printDocument.images);
  const imagesReady = Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  // Desenhos feitos sobre as imagens entram no PDF como camada em SVG por cima da foto.
  const strokesReady = imagesReady.then(() => {
    for (const image of images) {
      const raw = image.getAttribute("data-strokes");
      if (!raw || !image.naturalWidth || !image.naturalHeight) continue;
      const list = normalizeStrokes(raw);
      if (!list.length) continue;
      const holder = printDocument.createElement("span");
      holder.className = "img-with-strokes";
      holder.style.cssText = `position:relative;display:inline-block;max-width:100%;${image.getAttribute("style") ?? ""}`;
      const overlay = printDocument.createElement("img");
      overlay.alt = "";
      overlay.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(strokesToSvg(list, image.naturalWidth, image.naturalHeight))}`;
      overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      image.replaceWith(holder);
      image.style.width = "100%";
      holder.append(image, overlay);
    }
  });
  const fontsReady = printDocument.fonts?.ready ?? Promise.resolve();
  let printed = false;
  const print = () => {
    if (printed || printWindow.closed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.onafterprint = () => printWindow.close();
  Promise.all([strokesReady, fontsReady]).then(print);
  // Do not leave a popup open indefinitely if a remote image never finishes loading.
  printWindow.setTimeout(print, 2500);

  return true;
}
