// Comentários do PDF com formatação (título em negrito, negrito, itálico, marca-texto, lista).
// O texto continua guardado em `note.text`: comentários antigos (texto puro) seguem funcionando e
// os novos guardam um HTML mínimo e seguro, reconstruído etiqueta por etiqueta (nada de atributos nem scripts).

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "br", "p", "div", "ul", "ol", "li", "h4", "mark", "span"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template"]);
const BG = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})/i;
const BOLD = /font-weight\s*:\s*(bold|[5-9]00)/i;
const MAX_LEN = 20_000;

const RICH = /<\/?(?:b|strong|i|em|u|br|p|div|ul|ol|li|h4|mark|span)\b[^>]*>/i;

export const isRichNote = (text: string) => RICH.test(text);

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Reconstrói o HTML deixando só as etiquetas permitidas e, no <span>, apenas cor de fundo e negrito. */
export function cleanNoteHtml(html: string): string {
  const src = html.slice(0, MAX_LEN * 2);
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
  let out = "";
  let skipping: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[2]) {
      const closing = m[1] === "/";
      const name = m[2].toLowerCase();
      if (skipping) {
        if (closing && name === skipping) skipping = null;
        continue;
      }
      if (DROP_WITH_CONTENT.has(name)) {
        if (!closing) skipping = name;
        continue;
      }
      if (!ALLOWED.has(name)) continue;
      if (closing) {
        if (name !== "br") out += `</${name}>`;
        continue;
      }
      if (name === "span") {
        const style = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
        const css = style ? (style[1] ?? style[2] ?? "") : "";
        const parts: string[] = [];
        const bg = BG.exec(css);
        if (bg && !/^(transparent|inherit|initial|unset|none)$/i.test(bg[1])) parts.push(`background-color:${bg[1]}`);
        if (BOLD.test(css)) parts.push("font-weight:700");
        out += parts.length ? `<span style="${parts.join(";")}">` : "<span>";
      } else out += `<${name}>`;
    } else if (m[4] !== undefined) {
      if (!skipping) out += m[4];
    } else if (!skipping) out += "&lt;";
  }
  return out.slice(0, MAX_LEN);
}

/** HTML que o editor do comentário deve mostrar (texto puro antigo vira parágrafos com quebras). */
export function noteToHtml(text: string): string {
  if (!text) return "";
  return isRichNote(text) ? cleanNoteHtml(text) : escapeText(text).replace(/\r\n?|\n/g, "<br>");
}

/** Vazio = sem texto visível (ignora etiquetas e espaços). */
export function noteIsEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}
