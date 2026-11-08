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

/** De onde vieram as questões: páginas do caderno e PDFs. Serve para consultar o material original de novo. */
export type ReviewSources = { pageIds: string[]; pdfs: { url: string; name: string }[] };

/** Preenchido quando a atividade é uma revisão direcionada aos pontos fracos de outra. */
export type ReportFocus = { difficulty: Difficulty; topics: string[]; parentId: string | null };

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
  focus?: ReportFocus | null;
};

/** Faixas usadas em todo o app: >= 80 bom desempenho, 50 a 79 atenção, abaixo de 50 precisa revisar. */
export const MASTERED_FROM = 80;
export const ATTENTION_BELOW = 50;
/** Com menos respostas que isso num assunto não dá para dizer nada confiável sobre o desempenho. */
export const MIN_ANSWERS_FOR_LEVEL = 2;

export type Difficulty = 1 | 2 | 3;
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { 1: "Básico", 2: "Intermediário", 3: "Avançado" };

export type Trend = "melhorando" | "piorando" | "estavel" | "insuficiente";
export const TREND_LABEL: Record<Trend, string> = {
  melhorando: "melhorando",
  piorando: "piorou",
  estavel: "estável",
  insuficiente: "poucos dados para avaliar a evolução",
};
/** Linha mínima da evolução de um assunto (o cálculo completo fica em lib/progress.ts). */
export type TopicEvolutionLine = { topic: string; points: { percent: number }[]; trend: Trend };

export type Situation = "Bom desempenho" | "Atenção" | "Precisa revisar" | "Poucos dados";

export function situationOf(stat: Pick<TopicStat, "total" | "percent">): Situation {
  if (stat.total < MIN_ANSWERS_FOR_LEVEL) return "Poucos dados";
  if (stat.percent >= MASTERED_FROM) return "Bom desempenho";
  if (stat.percent >= ATTENTION_BELOW) return "Atenção";
  return "Precisa revisar";
}

/** Chave estável de um assunto (sem acento, caixa ou pontuação), para agrupar o mesmo assunto entre atividades. */
export function topicKey(topic: string) {
  return topic
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
export const knownOf = (report: Report) => report.answers.filter((a) => a.correct);
/** Só conta como bom desempenho quando há respostas suficientes no assunto. */
export const masteredTopics = (report: Report) => report.topics.filter((t) => situationOf(t) === "Bom desempenho");
export const attentionTopics = (report: Report) => report.topics.filter((t) => t.percent < MASTERED_FROM);

export type WeakTopic = { topic: string; total: number; correct: number; percent: number; concepts: string[]; questions: string[] };

type MinimalAnswer = Pick<AnswerRecord, "question" | "topic" | "concept" | "correct">;

/**
 * Assuntos em que houve erro, do mais fraco para o mais forte, com os conceitos errados
 * e todas as perguntas já feitas (para a próxima revisão não repeti-las).
 * Usa somente as respostas realmente registradas.
 */
export function weakFocusFromAnswers(answers: MinimalAnswer[]): WeakTopic[] {
  const map = new Map<string, WeakTopic>();
  for (const a of answers) {
    const key = topicKey(a.topic);
    if (!key) continue;
    const entry = map.get(key) ?? { topic: a.topic, total: 0, correct: 0, percent: 0, concepts: [], questions: [] };
    entry.total += 1;
    if (a.correct) entry.correct += 1;
    else if (a.concept && !entry.concepts.includes(a.concept)) entry.concepts.push(a.concept);
    entry.questions.push(a.question);
    map.set(key, entry);
  }
  return [...map.values()]
    .map((t) => ({ ...t, percent: Math.round((t.correct / t.total) * 100) }))
    .filter((t) => t.correct < t.total && t.percent < MASTERED_FROM)
    .sort((a, b) => a.percent - b.percent || b.total - a.total);
}

export const weakFocusOf = (report: Report) => weakFocusFromAnswers(report.answers);

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Relatório completo em texto puro, pronto para colar numa conversa com a IA. */
export function reportToText(report: Report, evolution: TopicEvolutionLine[] = []): string {
  const quiz = report.mode === "quiz";
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(report.finishedAt));
  const mistakes = mistakesOf(report);
  const L: string[] = [];

  L.push(`RELATÓRIO DE DESEMPENHO — ${quiz ? "QUIZ" : "FLASHCARDS"} (Mednotes)`);
  L.push(`Material: ${oneLine(report.title) || "Revisão"}`);
  L.push(`Data: ${when}`);
  if (report.focus) L.push(`Tipo: revisão direcionada aos pontos fracos (nível ${DIFFICULTY_LABEL[report.focus.difficulty].toLowerCase()}) — assuntos: ${report.focus.topics.join(", ")}`);
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
  for (const t of report.topics) L.push(`- ${t.topic}: ${t.percent}% (${t.correct} de ${t.total}) — ${situationOf(t)}`);
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

  if (!quiz) {
    const known = knownOf(report);
    L.push(`== CARTÕES QUE EU SEI (${known.length}) ==`);
    if (!known.length) L.push("Nenhum cartão marcado como conhecido.");
    for (const a of known) L.push(`- ${oneLine(a.question).slice(0, 160)} [${a.topic}]`);
    L.push("");
  }

  const mastered = masteredTopics(report);
  L.push("== ASSUNTOS COM BOM DESEMPENHO NESTA SESSÃO ==");
  if (mastered.length) for (const t of mastered) L.push(`- ${t.topic} (${t.percent}%)`);
  else L.push("Nenhum assunto atingiu 80% de acerto nesta sessão.");
  L.push("Observação: uma única sessão não comprova domínio definitivo do conteúdo.");
  L.push("");

  const withHistory = evolution.filter((e) => e.points.length >= 2);
  if (withHistory.length) {
    L.push("== EVOLUÇÃO NOS ASSUNTOS (sessões anteriores até agora) ==");
    for (const e of withHistory) L.push(`- ${e.topic}: ${e.points.map((p) => `${p.percent}%`).join(" → ")} (${TREND_LABEL[e.trend]})`);
    L.push("");
  }

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
