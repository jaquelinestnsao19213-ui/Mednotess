import type { Editor } from "@tiptap/core";
import { supabase } from "./supabase";

// Áudios e vídeos ficam no mesmo bucket "files" do Supabase que já guarda imagens e PDFs.
// Nada aqui usa IA, transcrição ou serviço pago: só o armazenamento que o app já tem.

const BUCKET = "files";

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/ogg": "ogv",
};

export const AUDIO_EXTS = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"];
export const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "ogv"];

/** Extensão a partir do tipo (ex.: "audio/webm;codecs=opus" -> "webm"). */
export function extFromMime(type: string | undefined): string {
  const base = (type ?? "").split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? "";
}

/** Extensão de um arquivo escolhido: pelo nome e, se faltar, pelo tipo. */
export function extFromFile(file: { name?: string; type?: string }): string {
  const fromName = file.name && file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return fromName || extFromMime(file.type) || "bin";
}

/** Diz se o arquivo é áudio ou vídeo (ou nenhum dos dois). */
export function mediaKindOf(file: { name?: string; type?: string }): "audio" | "video" | null {
  const type = (file.type ?? "").toLowerCase();
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  const ext = extFromFile(file);
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (VIDEO_EXTS.includes(ext)) return "video";
  return null;
}

/** Envia o arquivo para a pasta da usuária no Storage e devolve o endereço público. */
export async function uploadMedia(file: Blob, ext: string): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sem login");
  const path = `${data.user.id}/${crypto.randomUUID()}.${ext || "bin"}`;
  const contentType = (file.type || "").split(";")[0] || undefined;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType, cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Apaga do Storage o arquivo de um endereço público nosso. Links externos (YouTube etc.) são ignorados. */
export async function deleteMediaFile(url: string): Promise<void> {
  try {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const at = url.indexOf(marker);
    if (at < 0) return;
    const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
    if (!path) return;
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // Se não deu para apagar o arquivo, o bloco some da página do mesmo jeito.
  }
}

export function mediaErrorMessage(cause: unknown): string {
  const message =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : "";
  if (/Sem login/i.test(message)) return "Sua sessão expirou. Entre novamente.";
  if (/exceed|too large|payload|maximum allowed/i.test(message)) {
    return "O arquivo é maior que o limite do armazenamento (50 MB no plano gratuito do Supabase). Comprima o arquivo ou, no caso de vídeo, use o link do YouTube.";
  }
  return "Não foi possível enviar o arquivo. Confira sua conexão e se rodou o schema2.sql no Supabase.";
}

// ---------- Links de vídeo ----------

function parseStart(t: string): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function youtubeInfo(url: string): { id: string; start: number } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
      else {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
        if (m) id = m[1];
      }
    }
    if (!/^[\w-]{6,20}$/.test(id)) return null;
    return { id, start: parseStart(u.searchParams.get("t") ?? u.searchParams.get("start") ?? "") };
  } catch {
    return null;
  }
}

export function vimeoInfo(url: string): { id: string; hash: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "video") parts.shift();
    const id = parts[0] ?? "";
    if (!/^\d{5,12}$/.test(id)) return null;
    const hash = parts[1] && /^[a-z0-9]{6,}$/i.test(parts[1]) ? parts[1] : u.searchParams.get("h") ?? "";
    return { id, hash };
  } catch {
    return null;
  }
}

export type ParsedVideo = { kind: "youtube" | "vimeo" | "file"; url: string };

/** Entende o link colado: YouTube, Vimeo ou arquivo de vídeo direto (.mp4 etc.). */
export function parseVideoLink(raw: string): ParsedVideo | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const yt = youtubeInfo(u.toString());
  if (yt) return { kind: "youtube", url: `https://www.youtube.com/watch?v=${yt.id}${yt.start ? `&t=${yt.start}` : ""}` };
  const vm = vimeoInfo(u.toString());
  if (vm) return { kind: "vimeo", url: `https://vimeo.com/${vm.id}${vm.hash ? `/${vm.hash}` : ""}` };
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(u.pathname)) return { kind: "file", url: u.toString() };
  return null;
}

// ---------- Reprodução ----------

const POS_KEY = "mn-media-pos:";
const RATE_KEY = "mn-media-rate";

/** Onde você parou neste áudio/vídeo (guardado neste aparelho). */
export function loadPos(url: string): number {
  try {
    const v = Number(window.localStorage.getItem(POS_KEY + url));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function savePos(url: string, seconds: number) {
  try {
    if (seconds > 1) window.localStorage.setItem(POS_KEY + url, String(Math.floor(seconds)));
    else window.localStorage.removeItem(POS_KEY + url);
  } catch {
    // sem armazenamento local: só não lembra o ponto
  }
}

export function loadRate(): number {
  try {
    const v = Number(window.localStorage.getItem(RATE_KEY));
    return Number.isFinite(v) && v >= 0.25 && v <= 3 ? v : 1;
  } catch {
    return 1;
  }
}

export function saveRate(rate: number) {
  try {
    window.localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // ignora
  }
}

/** Ao tocar um áudio/vídeo, pausa os outros da página. */
export function pauseOthers(except?: HTMLMediaElement | null) {
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((m) => {
    if (m !== except && !m.paused) m.pause();
  });
  document.querySelectorAll<HTMLIFrameElement>("iframe[data-yt]").forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
    } catch {
      // ignora
    }
  });
}

export function formatTime(total: number): string {
  const safe = Number.isFinite(total) && total > 0 ? total : 0;
  const s = Math.floor(safe);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${h ? String(m).padStart(2, "0") : String(m)}:${String(sec).padStart(2, "0")}`;
}

/** Melhor formato de gravação que este navegador sabe fazer (Chrome/Android: webm; iPhone/Safari: mp4). */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

// ---------- Organização dos blocos ----------

/** Troca o bloco de lugar com o vizinho (dir -1 = sobe, 1 = desce). */
export function moveBlock(editor: Editor, pos: number, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const target = $pos.index() + dir;
  if (target < 0 || target >= parent.childCount) return false;
  const sibling = parent.child(target);
  const tr = state.tr;
  if (dir === -1) {
    tr.delete(pos, pos + node.nodeSize).insert(pos - sibling.nodeSize, node);
  } else {
    tr.insert(pos + node.nodeSize + sibling.nodeSize, node).delete(pos, pos + node.nodeSize);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}
