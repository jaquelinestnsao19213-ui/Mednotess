import type { Editor as TiptapEditor } from "@tiptap/core";

export function exportEditorAsPdf(editor: TiptapEditor, filename = "anotacao") {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!printWindow) return false;

  const content = editor.getHTML();
  const safeName = (filename || "anotacao").trim() || "anotacao";

  printWindow.document.write(`<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${safeName}.pdf</title>
      <style>
        @page { size: A4; margin: 18mm; }
        :root { color: #17212b; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font: 11pt/1.6 Georgia, "Times New Roman", serif;
          color: #17212b;
          background: #fff;
        }
        .pdf-shell {
          max-width: 100%;
          padding: 2mm 0;
        }
        .pdf-title {
          margin: 0 0 18pt;
          font: 600 22pt/1.2 system-ui, sans-serif;
          letter-spacing: -0.02em;
        }
        .annotation {
          overflow-wrap: anywhere;
        }
        .annotation > * + * { margin-top: 0.6em; }
        .annotation h1, .annotation h2, .annotation h3 {
          margin: 0.9em 0 0.3em;
          line-height: 1.2;
          letter-spacing: -0.02em;
          break-after: avoid;
        }
        .annotation h1 { font-size: 24pt; }
        .annotation h2 { font-size: 18pt; }
        .annotation h3 { font-size: 14pt; }
        .annotation p { margin: 0; }
        .annotation ul, .annotation ol { padding-left: 1.5em; margin: 0; }
        .annotation blockquote {
          margin: 0.8em 0;
          padding-left: 12pt;
          border-left: 3px solid #0f766e;
          color: #4b5563;
        }
        .annotation code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.93em;
          background: #f3f4f6;
          border-radius: 4px;
          padding: 1px 5px;
        }
        .annotation pre {
          margin: 0.8em 0;
          padding: 10pt;
          background: #f3f4f6;
          border-radius: 8px;
          overflow-x: auto;
          white-space: pre-wrap;
        }
        .annotation pre code { background: transparent; padding: 0; }
        .annotation table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0.8em 0;
        }
        .annotation th, .annotation td {
          border: 1px solid #cbd5e1;
          padding: 6pt 8pt;
          vertical-align: top;
        }
        .annotation th { background: #f8fafc; }
        .annotation img, .annotation video {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 0.8em 0;
        }
        .annotation mark { background: #fde68a; }
        .annotation hr { border: 0; border-top: 1px solid #cbd5e1; margin: 1em 0; }
        .annotation a { color: inherit; text-decoration: none; }
        .annotation .callout {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 12pt 14pt;
        }
        .annotation .toggle-content { display: block !important; }
        .annotation .toggle-btn, .annotation .image-handle, .annotation .img-handle {
          display: none !important;
        }
      </style>
    </head>
    <body>
      <main class="pdf-shell">
        <h1 class="pdf-title">${safeName}</h1>
        <article class="annotation">${content}</article>
      </main>
    </body>
  </html>
  `);
  printWindow.document.close();

  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    setTimeout(() => printWindow.close(), 1000);
  }, 300);

  return true;
}
