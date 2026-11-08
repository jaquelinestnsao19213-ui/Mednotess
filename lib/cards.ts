// Formato dos flashcards e questões gerados pela assistente (usado no servidor e no navegador).

export type AssistantCard = {
  type: "flashcard" | "question";
  question: string; // pergunta (ou enunciado)
  answer: string; // resposta (nas questões, o texto da alternativa correta)
  explanation?: string;
  options?: string[]; // só nas questões
  correctIndex?: number; // só nas questões
  optionNotes?: string[]; // só nas questões: por que cada alternativa está certa ou errada
  topic?: string; // assunto (usado para agrupar o desempenho)
  concept?: string; // conceito-chave que precisa ser compreendido
};

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Valida e limpa cartões vindos da IA ou do histórico; descarta o que estiver incompleto. */
export function sanitizeCards(raw: unknown, limit = 30): AssistantCard[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantCard[] = [];
  for (const item of raw) {
    if (out.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const question = clip(c.question ?? c.front, 1800);
    if (!question) continue;
    const explanation = clip(c.explanation, 1500) || undefined;
    const topic = clip(c.topic, 120) || undefined;
    const concept = clip(c.concept, 300) || undefined;

    if (c.type === "question" || Array.isArray(c.options)) {
      const options = Array.isArray(c.options) ? c.options.slice(0, 6).map((option) => clip(option, 400)) : [];
      const index = typeof c.correctIndex === "number" ? Math.trunc(c.correctIndex) : -1;
      if (options.length < 2 || options.some((option) => !option) || index < 0 || index >= options.length) continue;
      const rawNotes = Array.isArray(c.optionNotes) ? c.optionNotes.slice(0, options.length).map((note) => clip(note, 500)) : [];
      const optionNotes = rawNotes.length === options.length && rawNotes.some(Boolean) ? rawNotes : undefined;
      out.push({ type: "question", question, answer: options[index], explanation, options, correctIndex: index, optionNotes, topic, concept });
    } else {
      const answer = clip(c.answer ?? c.back, 1200);
      if (!answer) continue;
      out.push({ type: "flashcard", question, answer, explanation, topic, concept });
    }
  }
  return out;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Texto organizado (títulos, negrito e listas) para inserir como um bloco novo na página. */
export function cardsToMarkdown(cards: AssistantCard[], pageTitle?: string) {
  const letters = "ABCDEF";
  const lines: string[] = [`## Revisão — ${oneLine(pageTitle || "esta página")}`];
  cards.forEach((card, i) => {
    lines.push(`### ${card.type === "flashcard" ? "Flashcard" : "Questão"} ${i + 1}`);
    lines.push(`**Pergunta:** ${oneLine(card.question)}`);
    if (card.options) card.options.forEach((option, j) => lines.push(`- ${letters[j]}) ${oneLine(option)}`));
    lines.push(`**Resposta:** ${oneLine(card.answer)}`);
    if (card.explanation) lines.push(`**Explicação:** ${oneLine(card.explanation)}`);
  });
  return lines.join("\n");
}
