// Gera uma CÓPIA do PDF com as anotações gravadas dentro: traços à mão livre, marca-texto, círculos,
// textos convertidos da escrita à mão e comentários. O PDF original e o que está salvo no banco não são alterados.
//
// - Traços, marca-texto e círculos viram desenho vetorial por cima da página (o texto do PDF continua selecionável).
// - Textos convertidos são gravados em Helvetica (as fontes manuscritas da tela não vão dentro do PDF).
// - Cada comentário vira um emblema numerado na posição dele; o texto completo (com título, negrito, listas e imagens)
//   vai em páginas "Comentários" no final, com o mesmo número.
import type { PageAnn, Note } from "@/components/pdf/types";
import { ellipsePath, hexToRgb01, inkPath, normRot, toUser, viewSize, type Box } from "./pdf-export-geom";

export type ExportProgress = (done: number, total: number, label: string) => void;

export type ExportOptions = {
  title?: string; // título das páginas de comentários
  onProgress?: ExportProgress;
};

type Run = { t: string; bold: boolean; italic: boolean };
type Block =
  | { kind: "text"; runs: Run[]; head: boolean; bullet: string | null; indent: number }
  | { kind: "image"; src: string; alt: string };

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR", "UL", "OL", "TABLE", "HR"]);

// Converte o HTML do comentário em blocos simples (parágrafos, títulos, listas, imagens).
export function htmlToBlocks(html: string | undefined, plain: string): Block[] {
  const blocks: Block[] = [];
  if (!html || typeof DOMParser === "undefined") {
    for (const line of (plain || "").split("\n")) {
      blocks.push({ kind: "text", runs: [{ t: line, bold: false, italic: false }], head: false, bullet: null, indent: 0 });
    }
    return blocks;
  }
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  let cur: Run[] = [];
  let curHead = false;
  let curBullet: string | null = null;
  let curIndent = 0;

  const flush = () => {
    const has = cur.some((r) => r.t.trim() !== "");
    if (has) blocks.push({ kind: "text", runs: cur, head: curHead, bullet: curBullet, indent: curIndent });
    cur = [];
    curHead = false;
    curBullet = null;
  };

  const walk = (node: Node, bold: boolean, italic: boolean, indent: number, listState: { ordered: boolean; n: number } | null) => {
    if (node.nodeType === 3) {
      const t = (node.textContent ?? "").replace(/\s+/g, " ");
      if (t) cur.push({ t, bold, italic });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") {
      flush();
      return;
    }
    if (tag === "IMG") {
      flush();
      const src = el.getAttribute("src") ?? "";
      if (src) blocks.push({ kind: "image", src, alt: el.getAttribute("alt") ?? "" });
      return;
    }
    const fw = el.style?.fontWeight ?? "";
    const isBold = bold || tag === "B" || tag === "STRONG" || /^H[1-6]$/.test(tag) || tag === "TH" || fw === "bold" || fw === "bolder" || Number(fw) >= 600;
    const isItalic = italic || tag === "I" || tag === "EM" || el.style?.fontStyle === "italic";
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    let nextIndent = indent;
    let nextList = listState;
    if (tag === "UL" || tag === "OL") {
      nextIndent = indent + 1;
      nextList = { ordered: tag === "OL", n: 0 };
    }
    if (tag === "LI") {
      const ls = listState ?? { ordered: false, n: 0 };
      ls.n += 1;
      curBullet = ls.ordered ? `${ls.n}.` : "•";
      curIndent = indent;
    }
    if (/^H[1-6]$/.test(tag)) curHead = true;
    if (tag === "TD" || tag === "TH") {
      if (cur.length) cur.push({ t: "  |  ", bold: false, italic: false });
    }
    el.childNodes.forEach((c) => walk(c, isBold, isItalic, nextIndent, nextList));
    if (block) flush();
  };
  doc.body.childNodes.forEach((c) => walk(c, false, false, 0, null));
  flush();
  if (blocks.length === 0 && (plain ?? "").trim()) {
    for (const line of plain.trim().split("\n")) {
      blocks.push({ kind: "text", runs: [{ t: line, bold: false, italic: false }], head: false, bullet: null, indent: 0 });
    }
  }
  return blocks;
}

function sniffImage(b: Uint8Array): "png" | "jpg" | null {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

export async function buildAnnotatedPdf(
  source: string | Uint8Array,
  pages: Record<number, PageAnn>,
  opts: ExportOptions = {}
): Promise<Uint8Array> {
  const progress = opts.onProgress ?? (() => {});
  const { PDFDocument, StandardFonts, rgb, BlendMode, LineCapStyle, degrees } = await import("pdf-lib");

  progress(0, 1, "Baixando o PDF…");
  let bytes: Uint8Array;
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Não foi possível baixar o PDF (${res.status}).`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    bytes = source;
  }

  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvI = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const helvBI = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const charset = new Set(helv.getCharacterSet());
  const pick = (bold: boolean, italic: boolean) => (bold ? (italic ? helvBI : helvB) : italic ? helvI : helv);
  // Fonte padrão do PDF só tem letras latinas: o que não existe nela (emoji, símbolos raros) é omitido.
  const clean = (s: string) => {
    let out = "";
    for (const ch of s.normalize("NFC").replace(/[\u00a0\u2009\u202f\t]/g, " ")) {
      const cp = ch.codePointAt(0)!;
      if (charset.has(cp)) out += ch;
      else if (ch === "\u2192") out += "->";
      else if (ch === "\u2264") out += "<=";
      else if (ch === "\u2265") out += ">=";
    }
    return out;
  };

  const all = pdf.getPages();
  const total = all.length;
  const numbered: { n: number; page: number; note: Note }[] = [];
  let counter = 0;

  for (let i = 0; i < total; i++) {
    const pageNo = i + 1;
    progress(i, total, `Gravando anotações (${pageNo}/${total})…`);
    const ann = pages[pageNo];
    if (!ann || (ann.items.length === 0 && ann.notes.length === 0 && (ann.texts ?? []).length === 0)) continue;
    const page = all[i];
    const cb = page.getCropBox();
    const box: Box = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    const rot = normRot(page.getRotation().angle);
    const { W, H } = viewSize(box, rot);

    // Marca-texto primeiro (atrás), com mistura "multiply" como na tela; depois o resto.
    const ordered = [...ann.items].sort((a, b) => Number(b.kind === "ink" && b.tool === "highlighter") - Number(a.kind === "ink" && a.tool === "highlighter"));
    for (const it of ordered) {
      const [r, g, b] = hexToRgb01(it.color);
      const color = rgb(r, g, b);
      const width = Math.max(0.5, it.width * W);
      const isMark = it.kind === "ink" && it.tool === "highlighter";
      if (it.kind === "ink") {
        if (it.pts.length < 4) {
          if (it.pts.length >= 2) {
            const [x, y] = toUser(it.pts[0], it.pts[1], box, rot);
            page.drawCircle({ x, y, size: width / 2, color, opacity: isMark ? 0.4 : 1, blendMode: isMark ? BlendMode.Multiply : undefined });
          }
          continue;
        }
        page.drawSvgPath(inkPath(it.pts, box, rot), {
          x: 0,
          y: 0,
          borderColor: color,
          borderWidth: width,
          borderOpacity: isMark ? 0.4 : 1,
          borderLineCap: LineCapStyle.Round,
          blendMode: isMark ? BlendMode.Multiply : undefined,
        });
      } else {
        page.drawSvgPath(ellipsePath(it.cx, it.cy, it.rx, it.ry, box, rot), {
          x: 0,
          y: 0,
          borderColor: color,
          borderWidth: width,
          borderLineCap: LineCapStyle.Round,
        });
      }
    }

    // Textos convertidos da escrita à mão (x, y e tamanho divididos pela largura da página; y é o centro da linha).
    for (const t of ann.texts ?? []) {
      const txt = clean(t.text);
      if (!txt.trim()) continue;
      const [tr, tg, tb] = hexToRgb01(t.color);
      const size = Math.max(4, t.size * W);
      const [x, y] = toUser(t.x, (t.y * W) / H, box, rot);
      const off = size * 0.3; // do centro da linha até a linha de base, para baixo na vista
      const o: [number, number] = rot === 0 ? [0, -off] : rot === 90 ? [off, 0] : rot === 180 ? [0, off] : [-off, 0];
      page.drawText(txt, { x: x + o[0], y: y + o[1], size, font: helv, color: rgb(tr, tg, tb), rotate: degrees(rot) });
    }

    // Emblemas numerados dos comentários
    for (const note of ann.notes) {
      counter += 1;
      numbered.push({ n: counter, page: pageNo, note });
      const [nr, ng, nb] = hexToRgb01(note.color || "#facc15");
      const [x, y] = toUser(note.x, note.y, box, rot);
      const radius = Math.max(8, W * 0.014);
      page.drawCircle({ x, y, size: radius, color: rgb(nr, ng, nb), borderColor: rgb(0.1, 0.14, 0.19), borderWidth: 0.8 });
      const label = String(counter);
      const fsz = radius * (label.length > 2 ? 0.8 : 1.05);
      const tw = helvB.widthOfTextAtSize(label, fsz);
      page.drawText(label, { x: x - tw / 2, y: y - fsz * 0.35, size: fsz, font: helvB, color: rgb(0.1, 0.14, 0.19) });
    }
  }

  // Páginas com o texto dos comentários
  if (numbered.length > 0) {
    progress(total, total, "Escrevendo os comentários…");
    const PW = 595.28;
    const PH = 841.89;
    const M = 48;
    const maxW = PW - M * 2;
    let pg = pdf.addPage([PW, PH]);
    let y = PH - M;
    const newPage = () => {
      pg = pdf.addPage([PW, PH]);
      y = PH - M;
    };
    const need = (h: number) => {
      if (y - h < M) newPage();
    };

    const title = clean(opts.title ? `Comentários – ${opts.title}` : "Comentários");
    pg.drawText(title.slice(0, 90), { x: M, y: y - 16, size: 16, font: helvB, color: rgb(0.1, 0.14, 0.19) });
    y -= 34;

    for (const { n, page: pageNo, note } of numbered) {
      const base = Math.min(16, Math.max(9, ((note.fs ?? 14) / 14) * 11));
      need(base * 3);
      const [nr, ng, nb] = hexToRgb01(note.color || "#facc15");
      const head = `${n}`;
      pg.drawCircle({ x: M + 9, y: y - 8, size: 9, color: rgb(nr, ng, nb), borderColor: rgb(0.1, 0.14, 0.19), borderWidth: 0.8 });
      const hw = helvB.widthOfTextAtSize(head, 9);
      pg.drawText(head, { x: M + 9 - hw / 2, y: y - 11, size: 9, font: helvB, color: rgb(0.1, 0.14, 0.19) });
      pg.drawText(`Página ${pageNo}`, { x: M + 26, y: y - 11, size: 9, font: helv, color: rgb(0.4, 0.45, 0.5) });
      y -= 24;

      const blocks = htmlToBlocks(note.html, note.text);
      for (const bl of blocks) {
        if (bl.kind === "image") {
          try {
            const res = await fetch(bl.src);
            const ib = new Uint8Array(await res.arrayBuffer());
            const kind = sniffImage(ib);
            if (!kind) throw new Error("formato");
            const img = kind === "png" ? await pdf.embedPng(ib) : await pdf.embedJpg(ib);
            const scale = Math.min(1, maxW / img.width, 320 / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            need(h + 6);
            pg.drawImage(img, { x: M, y: y - h, width: w, height: h });
            y -= h + 8;
          } catch {
            need(base * 1.4);
            pg.drawText("[imagem não incluída]", { x: M, y: y - base, size: base, font: helvI, color: rgb(0.45, 0.5, 0.55) });
            y -= base * 1.5;
          }
          continue;
        }
        const size = bl.head ? base * 1.2 : base;
        const lead = size * 1.35;
        const ind = M + bl.indent * 14 + (bl.bullet ? 14 : 0);
        const avail = PW - M - ind;
        // quebra em linhas
        const words: { t: string; bold: boolean; italic: boolean }[] = [];
        for (const r of bl.runs) {
          const txt = clean(r.t);
          for (const part of txt.split(/(\s+)/)) if (part) words.push({ t: part, bold: r.bold || bl.head, italic: r.italic });
        }
        const lines: { t: string; bold: boolean; italic: boolean }[][] = [[]];
        let lw = 0;
        for (const w of words) {
          const f = pick(w.bold, w.italic);
          const isSpace = /^\s+$/.test(w.t);
          const wd = f.widthOfTextAtSize(w.t, size);
          if (isSpace && lines[lines.length - 1].length === 0) continue;
          if (lw + wd > avail && !isSpace && lines[lines.length - 1].length > 0) {
            lines.push([]);
            lw = 0;
          }
          // palavra maior que a linha: quebra por letras
          if (wd > avail && !isSpace) {
            let chunk = "";
            for (const ch of w.t) {
              if (f.widthOfTextAtSize(chunk + ch, size) > avail) {
                lines[lines.length - 1].push({ ...w, t: chunk });
                lines.push([]);
                chunk = ch;
              } else chunk += ch;
            }
            lines[lines.length - 1].push({ ...w, t: chunk });
            lw = f.widthOfTextAtSize(chunk, size);
            continue;
          }
          lines[lines.length - 1].push(w);
          lw += wd;
        }
        let first = true;
        for (const ln of lines) {
          if (ln.length === 0) continue;
          need(lead);
          let x = ind;
          if (first && bl.bullet) pg.drawText(bl.bullet, { x: ind - 14, y: y - size, size, font: helv, color: rgb(0.1, 0.14, 0.19) });
          first = false;
          for (const w of ln) {
            const f = pick(w.bold, w.italic);
            pg.drawText(w.t, { x, y: y - size, size, font: f, color: rgb(0.1, 0.14, 0.19) });
            x += f.widthOfTextAtSize(w.t, size);
          }
          y -= lead;
        }
        y -= bl.head ? 3 : 2;
      }
      y -= 12;
    }
  }

  progress(1, 1, "Finalizando…");
  return await pdf.save();
}

export function exportFileName(name: string): string {
  const base = (name || "documento").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento";
  return `${base} (com anotações).pdf`;
}
