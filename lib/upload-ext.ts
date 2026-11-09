const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** Extensão do arquivo; imagens coladas não têm nome, então usa o tipo. */
export function fileExtension(file: { name?: string; type?: string }): string {
  const fromName = file.name && file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return fromName || EXT_BY_TYPE[file.type ?? ""] || "bin";
}

