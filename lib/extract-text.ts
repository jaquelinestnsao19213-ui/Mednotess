// Extrai texto de arquivos do Office (.docx, .pptx, .xlsx), HTML, JSON e texto simples, tudo no navegador
// (sem enviar o arquivo original para lugar nenhum). O texto extraído é o que a IA recebe.

export const OFFICE_EXT = /\.(docx|pptx|xlsx)$/i;
const LEGACY_EXT = /\.(doc|ppt|xls)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?)$/i;

/** Arquivos cujo conteúdo dá para virar texto (inclui os formatos antigos do Office, para avisar com clareza). */
export function isReadableTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return OFFICE_EXT.test(name) || LEGACY_EXT.test(name) || TEXT_EXT.test(name) || file.type.startsWith("text/");
}

const decoder = new TextDecoder("utf-8");

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ---------- leitor mínimo de ZIP (docx, pptx e xlsx são arquivos ZIP) ---------- */

type ZipEntry = { name: string; method: number; compSize: number; offset: number };

function readEntries(view: DataView, bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function entryText(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<string> {
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = bytes.slice(start, start + entry.compSize);
  if (entry.method === 0) return decoder.decode(raw);
  if (entry.method !== 8) throw new Error("zip-method");
  const stream = new Blob([raw.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw") as never);
  return decoder.decode(await new Response(stream as never).arrayBuffer());
}

/* ---------- extração por formato ---------- */

function docxToText(xml: string): string {
  const text = xml
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXml(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function slideToText(xml: string): string {
  const text = xml.replace(/<a:br\s*\/>/g, "\n").replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "");
  return decodeXml(text).replace(/\n{3,}/g, "\n\n").trim();
}

const numberOf = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function textsOf(xml: string): string {
  const parts = [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
  return decodeXml(parts.join(""));
}

function sheetToText(xml: string, shared: string[]): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= 1500) break;
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textsOf(inner);
      else text = decodeXml(value);
      cells[ref ? columnIndex(ref) : cells.length] = text.replace(/\s+/g, " ").trim();
    }
    const line = Array.from(cells, (c) => c ?? "").join("\t").trimEnd();
    if (line.trim()) rows.push(line);
  }
  return rows.join("\n");
}

async function officeToText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readEntries(view, bytes);
  const read = async (name: string) => {
    const entry = entries.find((e) => e.name === name);
    return entry ? entryText(bytes, view, entry) : "";
  };
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".docx")) return docxToText(await read("word/document.xml"));

  if (lower.endsWith(".pptx")) {
    const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => numberOf(a.name) - numberOf(b.name));
    const notes = new Map(entries.filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e.name)).map((e) => [numberOf(e.name), e]));
    const out: string[] = [];
    for (const slide of slides) {
      const n = numberOf(slide.name);
      let block = `## Slide ${n}\n${slideToText(await entryText(bytes, view, slide))}`;
      const note = notes.get(n);
      if (note) {
        const spoken = slideToText(await entryText(bytes, view, note)).replace(/^\d+\s*$/gm, "").trim();
        if (spoken) block += `\nNotas do apresentador: ${spoken}`;
      }
      out.push(block);
    }
    return out.join("\n\n");
  }

  // .xlsx
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textsOf(m[1]));
  const sheetNames = [...(await read("xl/workbook.xml")).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => numberOf(a.name) - numberOf(b.name));
  const out: string[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const body = sheetToText(await entryText(bytes, view, sheets[i]), shared);
    if (body) out.push(`## Planilha: ${sheetNames[i] || `Planilha ${i + 1}`}\n${body}`);
  }
  return out.join("\n\n");
}

/** Devolve o texto do arquivo. Em caso de problema, lança um Error com mensagem pronta para mostrar à usuária. */
export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (LEGACY_EXT.test(name)) {
    throw new Error(`“${file.name}” está no formato antigo do Office. Salve como .docx, .pptx ou .xlsx (ou como PDF) e envie de novo.`);
  }
  try {
    if (OFFICE_EXT.test(name)) return (await officeToText(file)).trim();
    const raw = await file.text();
    if (/\.html?$/.test(name) || file.type === "text/html") {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    }
    return raw.trim();
  } catch {
    throw new Error(`Não consegui abrir “${file.name}”. O arquivo pode estar protegido por senha ou corrompido.`);
  }
}
