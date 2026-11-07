import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export const maxDuration = 30;

const MAX_HTML_BYTES = 3_000_000;
const MAX_READER_CHARS = 400_000;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 12_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/* ---------- segurança: nunca buscar endereços internos (SSRF) ---------- */

function isPrivateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIP(ip: string) {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Endereço inválido.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Só aceito endereços http ou https.");
  if (url.username || url.password) throw new Error("Endereço com usuário e senha não é aceito.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Porta não permitida.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Endereço não permitido.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateIP(a.address))) throw new Error("Endereço não permitido.");
  return url;
}

/* ---------- busca da página, seguindo redirecionamentos com validação ---------- */

async function fetchPage(start: string) {
  let current = await assertPublicUrl(start);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MednotesReader/1.0)",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
      },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = await assertPublicUrl(new URL(response.headers.get("location")!, current).toString());
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error("O site redirecionou vezes demais.");
}

async function readCapped(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const type = response.headers.get("content-type") ?? "";
  const charset = type.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(Buffer.concat(chunks));
}

/* ---------- o site deixa ser mostrado dentro de outro app? ---------- */

function allowsFraming(headers: Headers, appOrigin: string | null) {
  const xfo = headers.get("x-frame-options");
  if (xfo) return false; // DENY, SAMEORIGIN ou ALLOW-FROM: em todos os casos não serve para um app externo
  const csp = headers.get("content-security-policy");
  const match = csp?.match(/frame-ancestors([^;]*)/i);
  if (match) {
    const sources = match[1].trim().split(/\s+/).filter(Boolean);
    if (sources.includes("*")) return true;
    return !!appOrigin && sources.includes(appOrigin);
  }
  return true;
}

/* ---------- modo leitura: HTML limpo, só com marcações seguras ---------- */

const ALLOWED = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "strong", "b", "em", "i", "u", "sub", "sup", "br", "hr", "table", "thead", "tbody", "tr", "th", "td", "a", "img", "figure", "figcaption", "pre", "code"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "svg", "math", "noscript", "link", "meta", "video", "audio", "canvas"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeHttp(value: string | null, base: string) {
  if (!value) return null;
  try {
    const u = new URL(value, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitize(node: any, base: string): string {
  if (node.nodeType === 3) return esc(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const tag = String(node.tagName).toLowerCase();
  if (DROP.has(tag)) return "";
  const inner = Array.from(node.childNodes as ArrayLike<unknown>).map((child) => sanitize(child, base)).join("");
  if (!ALLOWED.has(tag)) return inner;
  if (tag === "br" || tag === "hr") return `<${tag}>`;
  if (tag === "a") {
    const href = safeHttp(node.getAttribute("href"), base);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
  }
  if (tag === "img") {
    const src = safeHttp(node.getAttribute("src") || node.getAttribute("data-src"), base);
    return src ? `<img src="${esc(src)}" alt="${esc(node.getAttribute("alt") ?? "")}" loading="lazy" referrerpolicy="no-referrer">` : "";
  }
  return `<${tag}>${inner}</${tag}>`;
}

function metaContent(document: Document, selector: string) {
  return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
}

// Dados para o cartão de prévia (título, resumo e miniatura), vindos das marcações do próprio site.
function previewOf(document: Document, base: string) {
  const description =
    metaContent(document, 'meta[property="og:description"]') ||
    metaContent(document, 'meta[name="description"]') ||
    metaContent(document, 'meta[name="twitter:description"]');
  const image = safeHttp(
    metaContent(document, 'meta[property="og:image"]') || metaContent(document, 'meta[name="twitter:image"]') || null,
    base
  );
  const siteName = metaContent(document, 'meta[property="og:site_name"]');
  return { description: description.slice(0, 500), image, siteName: siteName.slice(0, 120) };
}

/* ---------- rota ---------- */

export async function POST(request: Request) {
  const tokenMatch = (request.headers.get("authorization") ?? "").match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) return jsonError("Faça login para incorporar sites.", 401);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return jsonError("A autenticação do servidor não está configurada.", 500);
  const db = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data: { user }, error: authError } = await db.auth.getUser(tokenMatch[1]);
  if (authError || !user) return jsonError("Sessão inválida ou expirada. Entre novamente.", 401);

  let target = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    target = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : "";
  } catch {
    return jsonError("Formato de solicitação inválido.", 400);
  }
  if (!target) return jsonError("Informe o endereço do site.", 400);

  try {
    const { response, finalUrl } = await fetchPage(target);
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    const embeddable = allowsFraming(response.headers, request.headers.get("origin"));
    const common = { finalUrl: finalUrl.toString(), host: finalUrl.hostname.replace(/^www\./, ""), embeddable };

    if (!response.ok) return jsonError(`O site respondeu com erro (${response.status}).`, 502);
    if (type.includes("application/pdf")) {
      await response.body?.cancel();
      return NextResponse.json({ ...common, title: decodeURIComponent(finalUrl.pathname.split("/").pop() || common.host), readerHtml: null, description: "", image: null, siteName: "" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!type.includes("html")) {
      await response.body?.cancel();
      return NextResponse.json({ ...common, title: common.host, readerHtml: null, description: "", image: null, siteName: "" }, { headers: { "Cache-Control": "no-store" } });
    }

    const html = await readCapped(response, MAX_HTML_BYTES);
    const { document } = parseHTML(html);
    const pageTitle = metaContent(document as unknown as Document, 'meta[property="og:title"]') || document.title?.trim() || common.host;

    let readerHtml: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const article = new Readability(document as any).parse();
      if (article?.content) {
        const { document: articleDoc } = parseHTML(`<body>${article.content}</body>`);
        readerHtml = sanitize(articleDoc.body, finalUrl.toString()).slice(0, MAX_READER_CHARS);
      }
    } catch {
      readerHtml = null;
    }
    const preview = previewOf(document as unknown as Document, finalUrl.toString());
    return NextResponse.json(
      { ...common, ...preview, title: (pageTitle || common.host).slice(0, 300), readerHtml: readerHtml && readerHtml.replace(/<[^>]+>/g, "").trim().length > 120 ? readerHtml : null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError" ? error.message : "Não foi possível abrir esse site agora.";
    return jsonError(message, 502);
  }
}
