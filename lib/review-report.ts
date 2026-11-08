// Relatório de desempenho de um quiz ou de uma sessão de flashcards (usado no navegador e no servidor).

export type ReviewMode = "quiz" | "flashcards";

export type AnswerRecord = {
  cardId: string;
  kind: "flashcard" | "question";
  question: string;
  chosen: string | null; // alternativa marcada, já com a letra (só no quiz)
  correctAnswer: string; // alternativa correta com a letra (quiz) ou a resposta do cartão
  explanation: string | null;
  chosenNote: string | null; // por que a alternativa marcada está errada (quando a IA informou)
  topic: string;
  concept: string | null;
  correct: boolean;
  seconds: number;
};

export type TopicStat = { topic: string; total: number; correct: number; percent: number };

export type AiPlan = {
  summary: string;
  priorities: { topic: string; focus: string }[];
  strengths: string[];
  redo: string[];
};

export type Report = {
  version: 1;
  mode: ReviewMode;
  title: string;
  finishedAt: string;
  reason: "completo" | "tempo" | "encerrado";
  total: number;
  correct: number;
  wrong: number;
  percent: number;
  seconds: number;
  answers: AnswerRecord[];
  topics: TopicStat[];
  aiPlan: AiPlan | null;
};

export const MASTERED_FROM = 80;
export const ATTENTION_BELOW = 60;

export function buildReport(
  answers: AnswerRecord[],
  meta: { mode: ReviewMode; title: string; seconds: number; reason: Report["reason"] }
): Report {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const byTopic = new Map<string, { total: number; correct: number }>();
  for (const a of answers) {
    const entry = byTopic.get(a.topic) ?? { total: 0, correct: 0 };
    entry.total += 1;
    if (a.correct) entry.correct += 1;
    byTopic.set(a.topic, entry);
  }
  const topics: TopicStat[] = [...byTopic.entries()]
    .map(([topic, v]) => ({ topic, total: v.total, correct: v.correct, percent: Math.round((v.correct / v.total) * 100) }))
    .sort((a, b) => a.percent - b.percent || b.total - a.total);
  return {
    version: 1,
    mode: meta.mode,
    title: meta.title,
    finishedAt: new Date().toISOString(),
    reason: meta.reason,
    total,
    correct,
    wrong: total - correct,
    percent: total ? Math.round((correct / total) * 100) : 0,
    seconds: meta.seconds,
    answers,
    topics,
    aiPlan: null,
  };
}

export const mistakesOf = (report: Report) => report.answers.filter((a) => !a.correct);
export const masteredTopics = (report: Report) => report.topics.filter((t) => t.percent >= MASTERED_FROM);
export const attentionTopics = (report: Report) => report.topics.filter((t) => t.percent < MASTERED_FROM);

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Relatório completo em texto puro, pronto para colar numa conversa com a IA. */
export function reportToText(report: Report): string {
  const quiz = report.mode === "quiz";
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(report.finishedAt));
  const mistakes = mistakesOf(report);
  const L: string[] = [];

  L.push(`RELATÓRIO DE DESEMPENHO — ${quiz ? "QUIZ" : "FLASHCARDS"} (Mednotes)`);
  L.push(`Material: ${oneLine(report.title) || "Revisão"}`);
  L.push(`Data: ${when}`);
  L.push("");
  L.push("Use este relatório para fazer uma revisão direcionada exclusivamente aos meus erros: explique de novo os conceitos em que errei, com exemplos clínicos, e depois me faça novas perguntas só sobre esses pontos.");
  L.push("");
  L.push("== DESEMPENHO GERAL ==");
  L.push(`${quiz ? "Questões respondidas" : "Cartões revisados"}: ${report.total}`);
  L.push(quiz ? `Acertos: ${report.correct}` : `Sei a resposta: ${report.correct}`);
  L.push(quiz ? `Erros: ${report.wrong}` : `Não sei a resposta: ${report.wrong}`);
  L.push(`Aproveitamento: ${report.percent}%`);
  L.push(`Tempo: ${formatDuration(report.seconds)}`);
  if (report.reason !== "completo") L.push(report.reason === "tempo" ? "Observação: o tempo limite acabou antes do fim." : "Observação: sessão encerrada antes do fim.");
  L.push("");

  L.push("== DESEMPENHO POR ASSUNTO ==");
  for (const t of report.topics) L.push(`- ${t.topic}: ${t.percent}% (${t.correct} de ${t.total})`);
  L.push("");

  L.push(quiz ? `== QUESTÕES ERRADAS (${mistakes.length}) ==` : `== CARTÕES QUE PRECISAM DE REVISÃO (${mistakes.length}) ==`);
  if (!mistakes.length) L.push("Nenhum erro. Parabéns!");
  mistakes.forEach((a, i) => {
    L.push("");
    L.push(`${i + 1}. ${oneLine(a.question)}`);
    if (quiz && a.chosen) L.push(`   Minha resposta: ${oneLine(a.chosen)}`);
    L.push(`   ${quiz ? "Gabarito" : "Resposta"}: ${oneLine(a.correctAnswer)}`);
    if (a.explanation) L.push(`   Explicação: ${oneLine(a.explanation)}`);
    if (quiz && a.chosenNote) L.push(`   Por que a minha alternativa está errada: ${oneLine(a.chosenNote)}`);
    L.push(`   Assunto: ${a.topic}`);
    L.push(`   Revisar: ${a.concept ? oneLine(a.concept) : a.topic}`);
  });
  L.push("");

  const mastered = masteredTopics(report);
  L.push("== CONTEÚDOS COM BOM DOMÍNIO ==");
  if (mastered.length) for (const t of mastered) L.push(`- ${t.topic} (${t.percent}%)`);
  else L.push("Nenhum assunto atingiu 80% de acerto nesta sessão.");
  L.push("");

  L.push("== PLANO DE REVISÃO ==");
  const attention = attentionTopics(report);
  if (report.aiPlan?.summary) L.push(oneLine(report.aiPlan.summary));
  if (report.aiPlan?.priorities.length) {
    L.push("Estudar de novo:");
    for (const p of report.aiPlan.priorities) L.push(`- ${p.topic}: ${oneLine(p.focus)}`);
  } else if (attention.length) {
    L.push("Estudar de novo (do mais difícil para o mais fácil):");
    for (const t of attention) L.push(`- ${t.topic} (${t.percent}%)`);
  } else {
    L.push("Nada urgente: continue com revisões espaçadas.");
  }
  if (mistakes.length) {
    L.push("Refazer estas questões:");
    mistakes.forEach((a, i) => L.push(`- ${i + 1}. ${oneLine(a.question).slice(0, 140)}`));
  }
  if (report.aiPlan?.strengths.length) {
    L.push("Já dominado:");
    for (const s of report.aiPlan.strengths) L.push(`- ${oneLine(s)}`);
  }
  return L.join("\n");
}
