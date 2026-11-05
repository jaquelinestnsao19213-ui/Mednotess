import { supabase } from "./supabase";

// Envia um arquivo para o Storage e devolve o endereço público dele.
export async function uploadFile(file: File): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sem login");
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${data.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("files").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("files").getPublicUrl(path).data.publicUrl;
}
