import { Fragment, type ReactNode } from "react";

/**
 * Renderizador de Markdown pequeno e seguro (não usa HTML cru).
 * Suporta: títulos (#), **negrito**, *itálico*, `código`, blocos ```código```,
 * listas (- ou 1.), citações (>), linha (---), tabelas e links http(s).
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      nodes.push(link ? <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : token);
    } else nodes.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isTableRow = (line: string) => line.includes("|") && line.trim().startsWith("|");
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // bloco de código
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={nextKey()}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    // título
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5); // # vira h2 (o título da página já é h1)
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
      const id = nextKey();
      blocks.push(<Tag key={id}>{inline(heading[2], id)}</Tag>);
      i++;
      continue;
    }

    // linha horizontal
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={nextKey()} />); i++; continue; }

    // tabela
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      const id = nextKey();
      blocks.push(
        <div className="md-table-wrap" key={id}>
          <table>
            <thead><tr>{header.map((cell, c) => <th key={c}>{inline(cell, `${id}h${c}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell, `${id}r${r}c${c}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    // citação
    if (line.trim().startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      const id = nextKey();
      blocks.push(<blockquote key={id}>{inline(quote.join(" "), id)}</blockquote>);
      continue;
    }

    // listas
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const matcher = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && matcher.test(lines[i])) {
        items.push(lines[i].match(matcher)![1]);
        i++;
        // linha de continuação recuada pertence ao item anterior
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
          items[items.length - 1] += " " + lines[i++].trim();
        }
      }
      const id = nextKey();
      const content = items.map((item, n) => <li key={n}>{inline(item, `${id}i${n}`)}</li>);
      blocks.push(ordered ? <ol key={id}>{content}</ol> : <ul key={id}>{content}</ul>);
      continue;
    }

    // parágrafo (junta linhas seguidas)
    const paragraph: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].trim().startsWith("```") && !/^#{1,4}\s/.test(lines[i]) &&
      !bullet.test(lines[i]) && !numbered.test(lines[i]) && !lines[i].trim().startsWith(">") &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) paragraph.push(lines[i++]);
    const id = nextKey();
    blocks.push(
      <p key={id}>
        {paragraph.map((part, n) => <Fragment key={n}>{n > 0 && <br />}{inline(part, `${id}l${n}`)}</Fragment>)}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
