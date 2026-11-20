// A versão "legacy" do pdf.js tem os mesmos tipos da versão normal.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

// Worker do pdf.js carregado no próprio servidor (leitura do texto dos PDFs na rota da assistente).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
