// Anexos de estudo: como cada formato é preparado antes de a IA lê-lo.
// - PDF e imagem vão direto para o Storage (a IA enxerga as páginas, inclusive escaneadas).
// - Word, PowerPoint, Excel e texto são convertidos em texto no navegador e guardados como .txt.
// Tudo vira um endereço do Storage da própria usuária, que é o que o servidor aceita.
import { type Attachment, type AttachmentOrigin, MAX_DOC_BYTES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, classifyFile } from "./attachment-kinds";
import { extractFileText } from "./extract-text";
import { uploadFile } from "./upload";

export * from "./attachment-kinds";

/**
 * Prepara um arquivo para a IA: confere tipo e tamanho, converte documentos em texto e envia ao Storage.
 * Em qualquer problema lança um Error com mensagem pronta para a usuária.
 */
export async function prepareAttachment(file: File, origin: AttachmentOrigin): Promise<Attachment> {
  const found = classifyFile(file);
  if ("error" in found) throw new Error(found.error);
  const base = { id: crypto.randomUUID(), name: file.name, kind: found.kind, size: file.size, origin };

  // 1) conferência e conversão: os erros daqui já têm mensagem clara e seguem como estão
  let toUpload: File = file;
  let chars: number | undefined;
  if (found.kind === "pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error(`“${file.name}” passa de 20 MB. Divida o PDF em partes menores.`);
  } else if (found.kind === "image") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`A imagem “${file.name}” passa de 20 MB.`);
  } else {
    if (file.size > MAX_DOC_BYTES) throw new Error(`“${file.name}” passa de 25 MB.`);
    const text = (await extractFileText(file)).trim();
    if (!text) {
      throw new Error(`“${file.name}” não tem texto que a IA consiga ler (pode ter só imagens). Exporte como PDF para ela enxergar as imagens.`);
    }
    const stem = file.name.replace(/\.[^.]+$/, "") || "documento";
    toUpload = new File([text], `${stem}.txt`, { type: "text/plain" });
    chars = text.length;
  }

  // 2) envio ao Storage: qualquer falha vira uma mensagem simples
  try {
    const url = await uploadFile(toUpload);
    return chars === undefined ? { ...base, url } : { ...base, url, chars };
  } catch (cause) {
    if (cause instanceof Error && cause.message === "Sem login") throw new Error("Sua sessão expirou. Entre novamente para enviar arquivos.");
    throw new Error(`Não consegui enviar “${file.name}” agora. Confira sua conexão e tente de novo.`);
  }
}

/** Formato que o servidor recebe: só endereço, nome e tipo. */
export const toFileRef = (a: Attachment) => ({ url: a.url, name: a.name, kind: a.kind });
