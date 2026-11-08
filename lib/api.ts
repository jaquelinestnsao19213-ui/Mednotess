// Chamadas à API do app com tratamento robusto: nunca deixa uma resposta que não seja JSON
// (página de erro da Vercel, texto puro, HTML) estourar como "Unexpected token ... is not valid JSON".

export class ApiError extends Error {
  status: number;
  ref: string | null;
  constructor(message: string, status = 0, ref: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.ref = ref;
  }
}

/** Mensagem compreensível para cada tipo de falha que não vem do nosso servidor em JSON. */
function messageForStatus(status: number) {
  if (status === 504 || status === 408) return "A IA demorou mais do que o limite do servidor. Tente de novo com menos itens ou com um PDF menor.";
  if (status === 413) return "O material enviado é grande demais. Escolha menos páginas ou um PDF menor.";
  if (status === 401 || status === 403) return "Sua sessão expirou. Entre novamente para continuar.";
  if (status === 429) return "Muitas solicitações em pouco tempo. Espere um minuto e tente de novo.";
  if (status >= 500) return "O servidor teve um problema ao processar o pedido. Tente de novo em instantes.";
  return "O servidor respondeu de um jeito inesperado. Tente de novo.";
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Envia um POST em JSON e devolve o corpo já validado.
 * 1) valida o status HTTP  2) confere o Content-Type  3) só então faz o parse  4) valida o formato.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: { token: string; timeoutMs?: number; validate: (data: Record<string, unknown>) => T | null }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 130_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    throw new ApiError(aborted ? "A IA demorou demais para responder. Tente de novo com menos itens." : "Sem conexão com o servidor. Confira sua internet e tente de novo.");
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (contentType.includes("application/json")) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!isRecord(payload)) {
    // resposta que não é JSON (ex.: página de erro da plataforma): mostramos uma mensagem clara e registramos o trecho no console
    console.error(`[api] ${url} respondeu ${response.status} (${contentType || "sem content-type"}) fora do formato JSON:`, text.slice(0, 200));
    throw new ApiError(messageForStatus(response.status), response.status);
  }

  if (!response.ok) {
    const message = typeof payload.error === "string" && payload.error ? payload.error : messageForStatus(response.status);
    throw new ApiError(message, response.status, typeof payload.ref === "string" ? payload.ref : null);
  }

  const valid = options.validate(payload);
  if (valid === null) {
    console.error(`[api] ${url} devolveu JSON em formato inesperado:`, text.slice(0, 200));
    throw new ApiError("A resposta da IA veio incompleta. Tente de novo.", response.status);
  }
  return valid;
}

/** Texto final mostrado ao usuário (inclui o código de referência, útil para achar o log no servidor). */
export function errorMessage(cause: unknown, fallback = "Não foi possível concluir agora.") {
  if (cause instanceof ApiError) return cause.ref ? `${cause.message} (ref. ${cause.ref})` : cause.message;
  return fallback;
}
