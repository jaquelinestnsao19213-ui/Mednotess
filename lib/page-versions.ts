import type { JSONContent } from "@tiptap/core";
import { supabase } from "@/lib/supabase";

export type VersionOrigin = "auto" | "manual" | "restore";

export type VersionSummary = {
  id: string;
  title: string | null;
  origin: VersionOrigin;
  created_at: string;
};

export type PageVersion = VersionSummary & {
  page_id: string;
  content: JSONContent | null;
};

// Intervalo mínimo entre versões automáticas durante a edição.
export const AUTO_INTERVAL_MS = 5 * 60 * 1000;
// Quantas versões automáticas ficam guardadas por página (as manuais nunca são apagadas).
const MAX_AUTO = 40;

// Serialização estável (chaves ordenadas): o jsonb do Postgres reordena as chaves,
// então comparar JSON.stringify direto geraria versões duplicadas.
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stable(obj[key]))
      .join(",") +
    "}"
  );
}

export function contentHash(content: unknown, title?: string | null): string {
  const text = stable(content ?? null) + "|" + (title ?? "");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

export async function saveVersion(
  page: { id: string; title: string; content: unknown },
  origin: VersionOrigin
): Promise<boolean> {
  const { error } = await supabase.from("page_versions").insert({
    page_id: page.id,
    title: page.title,
    content: page.content ?? null,
    origin,
  });
  if (error) return false;
  if (origin === "auto") void pruneAuto(page.id);
  return true;
}

async function pruneAuto(pageId: string) {
  const { data } = await supabase
    .from("page_versions")
    .select("id")
    .eq("page_id", pageId)
    .eq("origin", "auto")
    .order("created_at", { ascending: false })
    .range(MAX_AUTO, MAX_AUTO + 199);
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length) await supabase.from("page_versions").delete().in("id", ids);
}

export async function latestSnapshot(pageId: string): Promise<{ hash: string; at: number } | null> {
  const { data } = await supabase
    .from("page_versions")
    .select("title,content,created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { hash: contentHash(data.content, data.title), at: new Date(data.created_at as string).getTime() };
}

// Lista leve (sem o conteúdo). Retorna null se a consulta falhar.
export async function listVersions(pageId: string): Promise<VersionSummary[] | null> {
  const { data, error } = await supabase
    .from("page_versions")
    .select("id,title,origin,created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return null;
  return (data ?? []) as VersionSummary[];
}

export async function getVersion(id: string): Promise<PageVersion | null> {
  const { data, error } = await supabase.from("page_versions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as PageVersion;
}

const BLOCKS = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow"]);

// Texto simples do conteúdo do Tiptap, para a pré-visualização.
export function plainText(doc: JSONContent | null | undefined): string {
  const out: string[] = [];
  const walk = (node: JSONContent | null | undefined) => {
    if (!node) return;
    if (node.type === "text" && node.text) out.push(node.text);
    node.content?.forEach(walk);
    if (node.type === "tableCell" || node.type === "tableHeader") out.push(" | ");
    if (node.type && BLOCKS.has(node.type)) out.push("\n");
  };
  walk(doc);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}
