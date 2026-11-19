// Regras que controlam o gasto de tokens do chat da Maria (anexos, regras de cartões, histórico, limite de resposta e cache).
// Funções puras, sem rede, para poderem ser testadas sozinhas (tests/chat-cost.test.ts).
import type Anthropic from "@anthropic-ai/sdk";

const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const HISTORY_LIMIT = 12; // mensagens (6 trocas) reenviadas à IA
export const MAX_TOKENS_SHORT = 4_000;
export const MAX_TOKENS_LONG = 8_000; // cartões e textos para inserir na página

// Pedidos que precisam do conteúdo dos PDFs: resumo, cartões, "onde aparece", citar página/fonte, tabelas e figuras.
const PDF_INTENT = /\b(pdfs?|arquivos?|documentos?|materiais|material|apostilas?|slides?|artigos?|livros?|capitulos?|anexos?|anexado|paginas?|pag|resum\w*|flashcards?|cards?|cartao|cartoes|questao|questoes|quiz|simulado|aparece\w*|cit(?:e|ar|a|acao|acoes)|fontes?|referencia\w*|trechos?|tabelas?|figuras?|imagens?|imagem|graficos?|esquemas?|conforme|segundo)\b|\bp\.\s?\d+|\bonde\s+(?:est|fal|diz|const|mencion)\w*/;
// Só estes pedidos recebem as regras longas de cartões/questões.
const CARDS_INTENT = /\b(flashcards?|cards?|cartao|cartoes|questao|questoes|quiz|simulado|exercicios?|perguntas? de revisao|me teste|testar meu|treinar)\b/;
const WRITE_INTENT = /\b(resum\w*|reescrev\w*|acrescent\w*|inser\w*|escrev\w*|redij\w*|redig\w*|roteiro|mapa)\b/;

type Msg = { role: string; content: string };

/** Verdadeiro se qualquer mensagem da usuária na conversa pede algo que depende dos PDFs (fica ligado nas seguintes). */
export const needsPdfs = (messages: Msg[]) => messages.some((m) => m.role === "user" && PDF_INTENT.test(plain(m.content)));
export const wantsCards = (text: string) => CARDS_INTENT.test(plain(text));
export const maxTokensFor = (text: string) => (CARDS_INTENT.test(plain(text)) || WRITE_INTENT.test(plain(text)) ? MAX_TOKENS_LONG : MAX_TOKENS_SHORT);

/** Mantém só as últimas mensagens; a conversa enviada sempre começa por uma mensagem da usuária. */
export function trimHistory<T extends { role: "user" | "assistant" }>(messages: T[], limit = HISTORY_LIMIT): T[] {
  if (messages.length <= limit) return messages;
  let tail = messages.slice(-limit);
  while (tail.length > 1 && tail[0].role !== "user") tail = tail.slice(1);
  return tail;
}

/* ---------- cache de prompt (modo agente) ---------- */

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
const EPHEMERAL = { type: "ephemeral" } as const;

/** Marca o prompt do sistema e o último bloco da conversa como cacheáveis (as rodadas seguintes releem do cache). */
export function addCacheBreakpoints(params: CreateParams): CreateParams {
  const system = typeof params.system === "string" && params.system.trim() ? [{ type: "text" as const, text: params.system, cache_control: EPHEMERAL }] : params.system;
  let messages = params.messages;
  const last = messages[messages.length - 1];
  if (last && last.role === "user") {
    const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
    const tail = blocks[blocks.length - 1];
    if (tail && !(tail.type === "text" && !tail.text)) {
      blocks[blocks.length - 1] = { ...tail, cache_control: EPHEMERAL } as Anthropic.ContentBlockParam;
      messages = [...messages.slice(0, -1), { role: "user", content: blocks }];
    }
  }
  return { ...params, system, messages };
}

/** Cliente que aplica o cache e registra o uso (tokens lidos do cache, gravados e normais) a cada chamada. */
export function withPromptCaching(anthropic: Anthropic, log: (step: string, data?: Record<string, unknown>) => void): Anthropic {
  const create = (params: CreateParams, options?: Parameters<Anthropic["messages"]["create"]>[1]) =>
    anthropic.messages.create(addCacheBreakpoints(params), options).then((response) => {
      const u = (response.usage ?? {}) as unknown as Record<string, number | undefined>;
      log("usage", { input: u.input_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, output: u.output_tokens });
      return response;
    });
  // runAgent só usa messages.create
  return { messages: { create } } as unknown as Anthropic;
}
