import { supabase } from "./supabase";
import { fileExtension } from "./upload-ext";

export { fileExtension };

const MAX_SIDE = 2400;
const MAX_BYTES = 1.5 * 1024 * 1024;

// Fotos de celular são pesadas: reduz imagens grandes antes de enviar (sem mexer em GIF e SVG).
// Se qualquer passo falhar, envia o arquivo original.
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= MAX_BYTES) {
      bmp.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close?.();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    if (!blob || blob.size >= file.size) return file;
    const base = (file.name || "imagem").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${fileExtension({ type: blob.type })}`, { type: blob.type });
  } catch {
    return file;
  }
}

// Envia um arquivo para o Storage e devolve o endereço público dele.
export async function uploadFile(original: File): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sem login");
  const file = await shrinkImage(original);
  const path = `${data.user.id}/${crypto.randomUUID()}.${fileExtension(file)}`;
  const { error } = await supabase.storage.from("files").upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return supabase.storage.from("files").getPublicUrl(path).data.publicUrl;
}
