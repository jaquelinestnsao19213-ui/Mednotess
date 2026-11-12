// Google Drive no navegador: a usuária navega pelas pastas no seletor oficial do Google (Picker), escolhe os
// arquivos e eles são baixados direto para o app, sem passar pelo aparelho.
//
// Segurança: usa só o escopo "drive.file" (o app enxerga APENAS os arquivos que ela escolher no seletor, nunca o Drive
// inteiro). O token de acesso fica só na memória da aba (some ao recarregar a página) e não é gravado em lugar nenhum.
// O ID do cliente OAuth e a chave do Picker são identificadores públicos por definição do Google (a chave é restrita
// ao domínio do app no Google Cloud); nenhum segredo (client secret) é usado nem existe no navegador.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_MAX_BYTES = 50 * 1024 * 1024;

const GOOGLE_APPS = "application/vnd.google-apps.";

/** Como cada tipo "nativo do Google" é convertido antes de o app processar. */
export type ExportPlan = { mime: string; extension: string; label: string };

export function exportPlanFor(mimeType: string): ExportPlan | null | "unsupported" {
  if (!mimeType.startsWith(GOOGLE_APPS)) return null; // arquivo comum: baixa como está
  switch (mimeType) {
    case `${GOOGLE_APPS}document`:
      return { mime: "application/pdf", extension: "pdf", label: "Google Docs" };
    case `${GOOGLE_APPS}presentation`:
      return { mime: "application/pdf", extension: "pdf", label: "Google Slides" };
    case `${GOOGLE_APPS}spreadsheet`:
      return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx", label: "Google Sheets" };
    case `${GOOGLE_APPS}drawing`:
      return { mime: "image/png", extension: "png", label: "Google Desenhos" };
    default:
      return "unsupported";
  }
}

/** Nome final do arquivo: garante a extensão certa nos documentos exportados. */
export function driveFileName(name: string, plan: ExportPlan | null): string {
  const base = (name || "arquivo").trim();
  if (!plan) return base;
  return base.toLowerCase().endsWith(`.${plan.extension}`) ? base : `${base}.${plan.extension}`;
}

export type DriveErrorKind = "auth" | "permission" | "missing" | "too-large" | "export-limit" | "network" | "unsupported" | "cancelled" | "unknown";

export class DriveError extends Error {
  kind: DriveErrorKind;
  constructor(kind: DriveErrorKind, message: string) {
    super(message);
    this.name = "DriveError";
    this.kind = kind;
  }
}

/** Traduz a resposta de erro da API do Drive em uma mensagem que a usuária entende. */
export function driveErrorFor(status: number, reason: string | undefined, fileName: string): DriveError {
  const name = `“${fileName}”`;
  if (status === 401) return new DriveError("auth", "A conexão com o Google expirou. Escolha o arquivo de novo para entrar outra vez.");
  if (status === 404) return new DriveError("missing", `${name} não está mais disponível no Drive (foi apagado ou movido).`);
  if (status === 403 && (reason === "exportSizeLimitExceeded" || reason === "fileNotExportable")) {
    return new DriveError("export-limit", `${name} é grande demais para o Google converter. Baixe como PDF no Drive, divida em partes e envie de novo.`);
  }
  if (status === 403 && (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || reason === "quotaExceeded")) {
    return new DriveError("unknown", "O Google limitou os pedidos por agora. Espere um minuto e tente de novo.");
  }
  if (status === 403) return new DriveError("permission", `Sem permissão para ler ${name}. Escolha o arquivo no seletor para liberar o acesso ou peça acesso a quem o compartilhou.`);
  if (status === 429) return new DriveError("unknown", "O Google limitou os pedidos por agora. Espere um minuto e tente de novo.");
  if (status >= 500) return new DriveError("unknown", "O Google Drive está instável agora. Tente de novo em instantes.");
  return new DriveError("unknown", `Não consegui baixar ${name} do Drive (erro ${status}).`);
}

export type DrivePicked = { id: string; name: string; mimeType: string; sizeBytes: number };
export type DriveProgress = { name: string; done: number; total: number; fileIndex: number; fileCount: number };

/* ---------- configuração ---------- */

export type DriveConfig = { clientId: string; apiKey: string; appId: string };

export function driveConfig(): DriveConfig | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  if (!clientId || !apiKey) return null;
  return { clientId, apiKey, appId: process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "" };
}

export const DRIVE_NOT_CONFIGURED =
  "O Google Drive ainda não foi configurado neste app. Falta criar as credenciais no Google Cloud e adicioná-las na Vercel (veja GOOGLE_DRIVE_SETUP.md).";

/* ---------- scripts do Google (carregados só quando necessário) ---------- */

type GoogleGlobal = {
  accounts?: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
        error_callback?: (error: { type: string; message?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
    };
  };
  picker?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
type GapiGlobal = { load(name: string, options: { callback: () => void; onerror?: () => void }): void };

declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: GapiGlobal;
  }
}

const scriptLoads = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const cached = scriptLoads.get(src);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptLoads.delete(src);
      el.remove();
      reject(new DriveError("network", "Não consegui carregar o Google Drive. Confira sua conexão (ou se um bloqueador de anúncios está impedindo) e tente de novo."));
    };
    document.head.append(el);
  });
  scriptLoads.set(src, promise);
  return promise;
}

let pickerReady: Promise<void> | null = null;
async function loadPicker(): Promise<void> {
  if (!pickerReady) {
    pickerReady = (async () => {
      await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
      await new Promise<void>((resolve, reject) => {
        window.gapi?.load("picker", { callback: () => resolve(), onerror: () => reject(new DriveError("network", "Não consegui abrir o seletor do Google Drive.")) });
      });
    })().catch((cause) => {
      pickerReady = null;
      throw cause;
    });
  }
  return pickerReady;
}

/* ---------- token (só em memória) ---------- */

let memoryToken: { value: string; expiresAt: number } | null = null;

export function forgetDriveToken() {
  memoryToken = null;
}

async function accessToken(config: DriveConfig, force = false): Promise<string> {
  if (!force && memoryToken && memoryToken.expiresAt - 60_000 > Date.now()) return memoryToken.value;
  await loadPicker();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new DriveError("network", "Não consegui iniciar o login do Google. Tente de novo.");
  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          const denied = response.error === "access_denied";
          reject(new DriveError(denied ? "cancelled" : "auth", denied ? "Você não liberou o acesso ao Google Drive." : "Não consegui entrar no Google. Tente de novo."));
          return;
        }
        memoryToken = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error) => {
        const closed = error.type === "popup_closed" || error.type === "popup_failed_to_open";
        reject(new DriveError(closed ? "cancelled" : "auth", closed ? "A janela de login do Google foi fechada." : "Não consegui entrar no Google. Tente de novo."));
      },
    });
    client.requestAccessToken({ prompt: memoryToken ? "" : "select_account" });
  });
}

/* ---------- seletor ---------- */

export type PickOptions = { multi?: boolean; mimeTypes?: string[] };

/** Abre o seletor do Drive (com navegação por pastas e Drives compartilhados) e devolve o que foi escolhido. */
async function pickDocs(config: DriveConfig, token: string, options: PickOptions): Promise<DrivePicked[]> {
  const picker = window.google?.picker;
  if (!picker) throw new DriveError("network", "Não consegui abrir o seletor do Google Drive.");
  return new Promise<DrivePicked[]>((resolve) => {
    const sharedWithMe = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setOwnedByMe(false);
    if (options.mimeTypes?.length) sharedWithMe.setMimeTypes(options.mimeTypes.join(","));
    const mine = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setOwnedByMe(true);
    if (options.mimeTypes?.length) mine.setMimeTypes(options.mimeTypes.join(","));
    const shared = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setEnableDrives(true);
    if (options.mimeTypes?.length) shared.setMimeTypes(options.mimeTypes.join(","));
    const builder = new picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setLocale("pt-BR")
      .setTitle("Escolher do Google Drive")
      .addView(mine)
      .addView(sharedWithMe)
      .addView(shared)
      .setCallback((data: Record<string, unknown>) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) return resolve([]);
        if (action !== picker.Action.PICKED) return;
        const docs = (data[picker.Response.DOCUMENTS] as Record<string, unknown>[] | undefined) ?? [];
        resolve(
          docs.map((doc) => ({
            id: String(doc[picker.Document.ID]),
            name: String(doc[picker.Document.NAME] ?? "arquivo"),
            mimeType: String(doc[picker.Document.MIME_TYPE] ?? ""),
            sizeBytes: Number(doc[picker.Document.SIZE_BYTES] ?? 0) || 0,
          }))
        );
      });
    if (config.appId) builder.setAppId(config.appId);
    if (options.multi !== false) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.enableFeature(picker.Feature.SUPPORT_DRIVES);
    builder.build().setVisible(true);
  });
}

/* ---------- download ---------- */

async function errorReason(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    return body.error?.errors?.[0]?.reason ?? body.error?.status;
  } catch {
    return undefined;
  }
}

async function readWithProgress(response: Response, onBytes: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const total = Number(response.headers.get("content-length") ?? 0) || 0;
  if (!response.body) {
    const blob = await response.blob();
    onBytes(blob.size, blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    if (signal?.aborted) throw new DriveError("cancelled", "Download cancelado.");
    const { value, done: finished } = await reader.read();
    if (finished) break;
    if (value) {
      chunks.push(value);
      done += value.byteLength;
      if (done > DRIVE_MAX_BYTES) {
        void reader.cancel();
        throw new DriveError("too-large", "O arquivo passa de 50 MB. Divida em partes menores e tente de novo.");
      }
      onBytes(done, total);
    }
  }
  return new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") ?? undefined });
}

export async function downloadOne(
  token: string,
  doc: DrivePicked,
  onBytes: (done: number, total: number) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ file: File; token: string }> {
  const plan = exportPlanFor(doc.mimeType);
  if (plan === "unsupported") {
    throw new DriveError("unsupported", `“${doc.name}” é de um tipo do Google que não dá para ler aqui (como Formulários). Abra no Drive e baixe como PDF.`);
  }
  if (!plan && doc.sizeBytes > DRIVE_MAX_BYTES) {
    throw new DriveError("too-large", `“${doc.name}” passa de 50 MB. Divida em partes menores e tente de novo.`);
  }
  const base = "https://www.googleapis.com/drive/v3/files";
  const url = plan
    ? `${base}/${encodeURIComponent(doc.id)}/export?mimeType=${encodeURIComponent(plan.mime)}`
    : `${base}/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw new DriveError("cancelled", "Download cancelado.");
    throw new DriveError("network", `Falha de conexão ao baixar “${doc.name}”. Confira sua internet e tente de novo.`);
  }
  if (!response.ok) throw driveErrorFor(response.status, await errorReason(response), doc.name);
  let blob: Blob;
  try {
    blob = await readWithProgress(response, onBytes, signal);
  } catch (cause) {
    if (cause instanceof DriveError) throw cause;
    throw new DriveError("network", `A conexão caiu durante o download de “${doc.name}”. Tente de novo.`);
  }
  const name = driveFileName(doc.name, plan || null);
  const type = plan ? plan.mime : doc.mimeType || blob.type || "application/octet-stream";
  return { file: new File([blob], name, { type }), token };
}

export type DriveResult = { files: File[]; failures: { name: string; message: string }[] };

/**
 * Fluxo completo: login (se precisar) → seletor → download/exportação de cada arquivo.
 * Falhas de arquivos individuais não derrubam os outros: voltam em `failures`.
 */
export async function pickFromDrive(
  options: PickOptions & { onProgress?: (progress: DriveProgress) => void; signal?: AbortSignal } = {}
): Promise<DriveResult> {
  const config = driveConfig();
  if (!config) throw new DriveError("unsupported", DRIVE_NOT_CONFIGURED);
  let token = await accessToken(config);
  const picked = await pickDocs(config, token, options);
  const files: File[] = [];
  const failures: { name: string; message: string }[] = [];
  for (let index = 0; index < picked.length; index++) {
    const doc = picked[index];
    const report = (done: number, total: number) =>
      options.onProgress?.({ name: doc.name, done, total: total || doc.sizeBytes, fileIndex: index, fileCount: picked.length });
    report(0, doc.sizeBytes);
    try {
      let result: { file: File; token: string };
      try {
        result = await downloadOne(token, doc, report, options.signal);
      } catch (cause) {
        if (cause instanceof DriveError && cause.kind === "auth") {
          token = await accessToken(config, true); // token vencido: entra de novo uma vez e repete
          result = await downloadOne(token, doc, report, options.signal);
        } else throw cause;
      }
      files.push(result.file);
    } catch (cause) {
      if (cause instanceof DriveError && cause.kind === "cancelled") throw cause;
      failures.push({ name: doc.name, message: cause instanceof Error ? cause.message : `Não consegui baixar “${doc.name}”.` });
    }
  }
  return { files, failures };
}

/** Tipos de arquivo que o Drive deve mostrar para cada uso. */
export const DRIVE_MIME = {
  pdf: ["application/pdf", `${GOOGLE_APPS}document`, `${GOOGLE_APPS}presentation`],
  images: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  study: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `${GOOGLE_APPS}document`,
    `${GOOGLE_APPS}presentation`,
    `${GOOGLE_APPS}spreadsheet`,
  ],
} as const;
