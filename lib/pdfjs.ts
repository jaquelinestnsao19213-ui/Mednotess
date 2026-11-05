// Carrega o pdf.js só no navegador, só quando um PDF é aberto.
// Usamos a versão "legacy" para funcionar também em celulares e tablets mais antigos.
type PdfJs = typeof import("pdfjs-dist");

let cached: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!cached) {
    cached = import("pdfjs-dist/legacy/build/pdf.mjs")
      .then((mod) => {
        const m = mod as unknown as PdfJs;
        m.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        return m;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
