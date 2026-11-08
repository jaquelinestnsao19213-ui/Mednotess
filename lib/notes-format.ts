// Edições de texto (Markdown simples) usadas pelo editor de notas das tarefas.
// Funções puras: recebem o texto e a seleção e devolvem o novo texto e a nova seleção.

export type TextEdit = { value: string; start: number; end: number };

export function wrapSelection(value: string, start: number, end: number, marker: string): TextEdit {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  const m = marker.length;
  const single = marker === "*";

  const wrappedOutside = before.endsWith(marker) && after.startsWith(marker) && (!single || (!before.endsWith("**") && !after.startsWith("**")));
  if (wrappedOutside) {
    return { value: before.slice(0, -m) + sel + after.slice(m), start: start - m, end: end - m };
  }
  const wrappedInside = sel.length > 2 * m && sel.startsWith(marker) && sel.endsWith(marker) && (!single || !sel.startsWith("**"));
  if (wrappedInside) {
    const inner = sel.slice(m, -m);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  return { value: before + marker + sel + marker + after, start: start + m, end: end + m };
}

export type LineKind = "h1" | "h2" | "ul" | "ol";
const ANY_PREFIX = /^(#{1,4}\s+|[-*•]\s+|\d+[.)]\s+)/;

export function toggleLinePrefix(value: string, start: number, end: number, kind: LineKind): TextEdit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const prefixOf = (index: number) => (kind === "h1" ? "# " : kind === "h2" ? "## " : kind === "ul" ? "- " : `${index + 1}. `);
  const hasPrefix = (line: string, index: number) => (kind === "ol" ? new RegExp(`^${index + 1}[.)]\\s+`).test(line) : line.startsWith(prefixOf(index)));
  const allHave = lines.every((line, index) => !line.trim() || hasPrefix(line, index));

  const next = lines.map((line, index) => {
    if (!line.trim() && lines.length > 1) return line;
    const bare = line.replace(ANY_PREFIX, "");
    return allHave ? bare : prefixOf(index) + bare;
  });
  const block = next.join("\n");
  return { value: value.slice(0, lineStart) + block + value.slice(lineEnd), start: lineStart, end: lineStart + block.length };
}

/** Enter no fim de um item de lista: continua a lista (ou encerra se o item estiver vazio). */
export function continueList(value: string, caret: number): TextEdit | null {
  if (caret < value.length && value[caret] !== "\n") return null; // só no fim da linha
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);

  const bullet = line.match(/^(\s*)([-*•])\s+(.*)$/);
  const numbered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (!bullet && !numbered) return null;

  const rest = bullet ? bullet[3] : numbered![4];
  if (!rest.trim()) {
    const next = value.slice(0, lineStart) + value.slice(caret);
    return { value: next, start: lineStart, end: lineStart };
  }
  const marker = bullet ? `${bullet[1]}${bullet[2]} ` : `${numbered![1]}${Number(numbered![2]) + 1}${numbered![3]} `;
  const insert = `\n${marker}`;
  const next = value.slice(0, caret) + insert + value.slice(caret);
  const pos = caret + insert.length;
  return { value: next, start: pos, end: pos };
}
