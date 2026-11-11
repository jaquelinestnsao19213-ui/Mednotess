// Mapas mentais: leitura/gravação no Supabase, chamada da IA e salvamento automático.
import { supabase } from "@/lib/supabase";
import { ApiError, postJson } from "@/lib/api";
import { type MapDoc, normalizeDoc } from "@/lib/mindmap";

export const MAPS_SETUP_HINT = "Para ativar os mapas mentais, rode o arquivo schema19.sql no Supabase (SQL Editor → New query → Run) e atualize esta página.";

export const isMissingMapsTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /mind_maps/i.test(e.message ?? ""));

export type MapListItem = { id: string; title: string; updated_at: string; source_page_ids: string[] };
export type MapRecord = { id: string; title: string; doc: MapDoc; sourcePageIds: string[]; updatedAt: string };

export async function listMaps(): Promise<{ items: MapListItem[]; setup: boolean }> {
  const { data, error } = await supabase.from("mind_maps").select("id,title,updated_at,source_page_ids").order("updated_at", { ascending: false }).limit(200);
  if (error) {
    if (isMissingMapsTable(error)) return { items: [], setup: true };
    throw new Error("Não foi possível carregar seus mapas agora.");
  }
  return { items: (data ?? []) as MapListItem[], setup: false };
}

export async function createMap(title: string, doc: MapDoc, sourcePageIds: string[] = []): Promise<string> {
  const { data, error } = await supabase.from("mind_maps").insert({ title: title.trim() || "Novo mapa mental", doc, source_page_ids: sourcePageIds }).select("id").single();
  if (error || !data) throw new Error(isMissingMapsTable(error) ? MAPS_SETUP_HINT : "Não foi possível criar o mapa agora.");
  return data.id as string;
}

export async function loadMap(id: string): Promise<MapRecord | null | "setup"> {
  const { data, error } = await supabase.from("mind_maps").select("id,title,doc,source_page_ids,updated_at").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingMapsTable(error)) return "setup";
    throw new Error("Não foi possível abrir o mapa agora.");
  }
  if (!data) return null;
  const doc = normalizeDoc(data.doc);
  const sourcePageIds = ((data.source_page_ids as string[] | null) ?? []).length ? (data.source_page_ids as string[]) : doc.meta.sourcePageIds;
  return { id: data.id as string, title: data.title as string, doc, sourcePageIds, updatedAt: data.updated_at as string };
}

export type MapSave = { title: string; doc: MapDoc; sourcePageIds: string[] };

export async function saveMap(id: string, value: MapSave): Promise<void> {
  const { data, error } = await supabase
    .from("mind_maps")
    .update({ title: value.title.trim() || "Novo mapa mental", doc: { ...value.doc, meta: { ...value.doc.meta, sourcePageIds: value.sourcePageIds } }, source_page_ids: value.sourcePageIds, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Não foi possível salvar agora.");
  if (!data?.length) throw new Error("Este mapa não existe mais (foi excluído em outro lugar).");
}

export async function renameMap(id: string, title: string) {
  const { error } = await supabase.from("mind_maps").update({ title: title.trim() || "Novo mapa mental" }).eq("id", id);
  if (error) throw new Error("Não foi possível renomear agora.");
}

export async function deleteMap(id: string) {
  const { error } = await supabase.from("mind_maps").delete().eq("id", id);
  if (error) throw new Error("Não foi possível excluir agora.");
}

export async function duplicateMap(id: string): Promise<string> {
  const rec = await loadMap(id);
  if (!rec || rec === "setup") throw new Error("Não foi possível duplicar o mapa.");
  return createMap(`${rec.title} (cópia)`, rec.doc, rec.sourcePageIds);
}

/** Chamada da IA dos mapas, sempre com resposta validada (nunca estoura "not valid JSON"). */
export async function callMapAi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError("Sua sessão expirou. Entre novamente para continuar.", 401);
  return postJson("/api/mapas", body, { token: session.access_token, timeoutMs: 125_000, validate: (d) => d });
}

export { createAutosaver, type SaveStatus } from "@/lib/autosave";
