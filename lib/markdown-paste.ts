// Converte Markdown (o que os botões "copiar" do Claude e do ChatGPT colocam na área de transferência)
// em HTML simples e seguro, para o editor transformar em formatação de verdade ao colar.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(raw: string): string {
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\s][^_\n]*)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const indentOf = (s: string) => s.replace(/\t/g, "    ").match(/^ */)![0].length;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function blocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;

  const isTableStart = (idx: number) =>
    idx + 1 < lines.length && lines[idx].includes("|") && lines[idx + 1].includes("|") && TABLE_SEP.test(lines[idx + 1]);

  const startsBlock = (idx: number) => {
    const l = lines[idx];
    return /^\s*```/.test(l) || /^#{1,6}\s/.test(l) || HR.test(l) || /^\s*>/.test(l) || LIST_RE.test(l) || isTableStart(idx);
  };

  const nextNonBlank = () => {
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    return j;
  };

  function parseList(): string {
    const first = lines[i].match(LIST_RE)!;
    const base = indentOf(lines[i]);
    const ordered = /^\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items: string[] = [];
    let isTask = false;

    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m || indentOf(lines[i]) !== base || /^\d/.test(m[2]) !== ordered) break;
      let text = m[3];
      const t = text.match(/^\[([ xX])\]\s+(.*)$/);
      let checked: boolean | null = null;
      if (t) {
        checked = t[1] !== " ";
        text = t[2];
        if (items.length === 0) isTask = true;
      }
      i++;

      let nested = "";
      for (;;) {
        // texto que continua o item (recuado)
        if (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && indentOf(lines[i]) > base && !/^\s*```/.test(lines[i])) {
          text += " " + lines[i].trim();
          i++;
          continue;
        }
        const j = nextNonBlank();
        if (j >= lines.length) break;
        const nm = lines[j].match(LIST_RE);
        if (nm && indentOf(lines[j]) > base) {
          i = j;
          nested += parseList();
          continue;
        }
        break;
      }

      // próximo item do mesmo nível, mesmo com linha em branco no meio
      const j = nextNonBlank();
      if (j > i && j < lines.length) {
        const sm = lines[j].match(LIST_RE);
        if (sm && indentOf(lines[j]) === base && /^\d/.test(sm[2]) === ordered) i = j;
      }

      items.push(
        checked === null
          ? `<li><p>${inline(text)}</p>${nested}</li>`
          : `<li data-type="taskItem" data-checked="${checked}"><p>${inline(text)}</p>${nested}</li>`
      );
    }

    if (isTask) return `<ul data-type="taskList">${items.join("")}</ul>`;
    if (ordered) return `<ol${start !== 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>`;
    return `<ul>${items.join("")}</ul>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^\s*```+\s*([\w+-]*)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = fence[1] ? ` class="language-${esc(fence[1])}"` : "";
      out.push(`<pre><code${lang}>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${blocks(inner)}</blockquote>`);
      continue;
    }

    if (isTableStart(i)) {
      const head = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const body = rows
        .map((r) => `<tr>${head.map((_c, k) => `<td>${inline(r[k] ?? "")}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><tbody><tr>${th}</tr>${body}</tbody></table>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      out.push(parseList());
      continue;
    }

    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(i)) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("");
}

export function markdownToHtml(md: string): string {
  return blocks(md.replace(/\r\n?/g, "\n").split("\n"));
}

// Só trata como Markdown quando há sinais claros (título, negrito, lista, tabela, código, citação, link).
export function looksLikeMarkdown(text: string): boolean {
  if (!text || !text.trim()) return false;
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  if (/^#{1,6}\s+\S/m.test(text)) return true;
  if (/^\s*```/m.test(text)) return true;
  if (/\*\*[^*\n]+\*\*/.test(text)) return true;
  if (/^\s*\|?\s*:?-{3,}:?\s*\|[\s|:-]*$/m.test(text)) return true;
  if (count(/^\s*[-*+]\s+\S/gm) >= 2) return true;
  if (count(/^\s*\d{1,3}[.)]\s+\S/gm) >= 2) return true;
  if (/^>\s+\S/m.test(text)) return true;
  if (/\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/.test(text)) return true;
  return false;
}
