// Peças do servidor para gerar e validar itens de revisão (quiz/flashcards) com a IA.
import Anthropic from "@anthropic-ai/sdk";
import { sanitizeCards, type AssistantCard } from "@/lib/cards";
import { topicKey } from "@/lib/review-report";

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Traduz erros do provedor de IA em status e mensagem para o usuário (o detalhe técnico vai só para o log). */
export function describeAiError(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: 504, message: "A IA demorou mais do que o limite do servidor. Tente com menos itens ou com um PDF menor." };
  }
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    if (s === 401 || s === 403) return { status: 503, message: "O servidor não conseguiu autenticar na IA. Confira a variável ANTHROPIC_API_KEY na Vercel." };
    if (s === 404) return { status: 503, message: "O modelo de IA configurado não está disponível para esta chave. Confira o nome do modelo no servidor." };
    if (s === 429) return { status: 429, message: "A IA recebeu pedidos demais agora. Espere um minuto e tente de novo." };
    if (s === 413 || s === 400) return { status: 422, message: "A IA não conseguiu ler o material (um PDF pode estar grande demais, protegido ou inacessível). Tente sem o PDF ou com um menor." };
    if (s !== undefined && s >= 500) return { status: 502, message: "O serviço de IA está instável agora. Tente de novo em instantes." };
  }
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: "Não consegui me conectar à IA. Tente de novo em instantes." };
  return { status: 502, message: "Não foi possível falar com a IA agora. Tente de novo em instantes." };
}

/** Log técnico para o painel da Vercel: sem chaves, tokens nem o conteúdo das páginas. */
export function logError(scope: string, ref: string, err: unknown) {
  const detail =
    err instanceof Anthropic.APIError
      ? { type: err.name, status: err.status, message: String(err.message).slice(0, 300), requestId: err.requestID ?? null }
      : { type: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  console.error(`[review:${scope}] ref=${ref}`, JSON.stringify(detail));
}

/* ---------- leitura da resposta da IA ---------- */

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Recupera os itens completos de um JSON cortado no meio (ex.: a IA atingiu o limite de tokens). */
export function salvageCards(raw: string): unknown[] {
  const at = raw.indexOf('"cards"');
  if (at < 0) return [];
  const open = raw.indexOf("[", at);
  if (open < 0) return [];
  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          /* item quebrado: ignora */
        }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return items;
}

/** Lê o JSON da IA: aceita cercas de Markdown, texto antes/depois e respostas cortadas. */
export function parseModelObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const direct = parseObject(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = parseObject(cleaned.slice(start, end + 1));
    if (inner) return inner;
  }
  const cards = salvageCards(cleaned);
  return cards.length ? { cards } : null;
}

export function textOf(response: Anthropic.Message) {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/* ---------- geração em lotes paralelos ---------- */

const ANGLES = [
  "caso clínico curto com raciocínio em uma etapa",
  "mecanismo e fisiopatologia (por quê acontece)",
  "comparação entre conceitos parecidos e diagnóstico diferencial",
  "interpretação de dado, exame ou prescrição",
  "armadilhas, exceções e erros comuns de prova",
];

export type BatchPlan = { count: number; index: number; total: number };

/** Divide o pedido em lotes pequenos: cada chamada termina rápido e cabe no limite de tempo do servidor. */
export function planBatches(count: number, kind: "question" | "flashcard"): BatchPlan[] {
  const size = kind === "question" ? 5 : 8;
  const total = Math.max(1, Math.ceil(count / size));
  const base = Math.floor(count / total);
  const extra = count % total;
  return Array.from({ length: total }, (_, index) => ({ count: base + (index < extra ? 1 : 0), index, total }));
}

export function batchNote(plan: BatchPlan, kind: "question" | "flashcard") {
  if (plan.total === 1) return "";
  const angle = ANGLES[plan.index % ANGLES.length];
  return `\n\nEste é o lote ${plan.index + 1} de ${plan.total}; os outros lotes são gerados ao mesmo tempo. Para não repetir assuntos entre os lotes, neste lote dê preferência à parte ${plan.index + 1} de ${plan.total} do material (na ordem em que aparece) e, nos ${kind === "question" ? "enunciados" : "cartões"}, priorize a abordagem: ${angle}. Produza exatamente ${plan.count} itens.`;
}

type RunArgs = {
  anthropic: Anthropic;
  model: string;
  system: string;
  pdfBlocks: Anthropic.ContentBlockParam[];
  userText: (plan: BatchPlan) => string;
  kind: "question" | "flashcard";
  count: number;
  signal: AbortSignal;
  onBatchError: (err: unknown) => void;
};

/** Gera os itens em paralelo. Se um lote falhar, usa os que deram certo; se todos falharem, repassa o erro. */
export async function generateCards(args: RunArgs): Promise<{ cards: AssistantCard[]; message: string }> {
  const plans = planBatches(args.count, args.kind);
  const settled = await Promise.allSettled(
    plans.map(async (plan) => {
      const response = await args.anthropic.messages.create(
        {
          model: args.model,
          max_tokens: Math.min(8_000, plan.count * (args.kind === "question" ? 900 : 400) + 800),
          system: args.system,
          messages: [{ role: "user", content: [...args.pdfBlocks, { type: "text", text: args.userText(plan) }] }],
        },
        { signal: args.signal }
      );
      const parsed = parseModelObject(textOf(response));
      if (!parsed) throw new HttpError("A IA devolveu uma resposta que não consegui ler.", 502);
      const cards = sanitizeCards(parsed.cards, plan.count).filter((c) => c.type === args.kind);
      return { cards, message: typeof parsed.message === "string" ? parsed.message : "", truncated: response.stop_reason === "max_tokens" };
    })
  );

  const cards: AssistantCard[] = [];
  let message = "";
  let firstError: unknown = null;
  for (const item of settled) {
    if (item.status === "fulfilled") {
      cards.push(...item.value.cards);
      if (!message && item.value.message) message = item.value.message;
    } else {
      args.onBatchError(item.reason);
      firstError ??= item.reason;
    }
  }
  if (!cards.length && firstError && settled.every((s) => s.status === "rejected")) throw firstError;
  return { cards: dedupeCards(unifyTopics(cards)).slice(0, args.count), message };
}

/** Une variações do mesmo assunto ("Farmacocinética" / "Farmacocinética geral") para o desempenho agrupar certo. */
export function unifyTopics(cards: AssistantCard[]): AssistantCard[] {
  const canonical: { key: string; name: string }[] = [];
  return cards.map((card) => {
    if (!card.topic) return card;
    const key = topicKey(card.topic);
    if (!key) return card;
    const known = canonical.find((c) => c.key === key || c.key.startsWith(`${key} `) || key.startsWith(`${c.key} `));
    if (known) return { ...card, topic: known.name };
    canonical.push({ key, name: card.topic });
    return card;
  });
}

export function dedupeCards(cards: AssistantCard[]): AssistantCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = topicKey(card.question);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
