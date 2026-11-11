// Carrega todas as anotações (id, título, tipo, pai) para escolher fontes e vincular conceitos.
import { supabase } from "@/lib/supabase";
import type { TreePage } from "@/lib/page-tree";

export async function loadTreePages(): Promise<TreePage[]> {
  const out: TreePage[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabase.from("pages").select("id,title,icon,type,parent_id,position").order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error("Não foi possível carregar suas anotações.");
    out.push(...((data ?? []) as TreePage[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
