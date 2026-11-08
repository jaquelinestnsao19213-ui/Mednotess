// Evolução do desempenho por assunto ao longo das atividades e escolha do nível de dificuldade.
import { type Difficulty, type Report, type Trend, type TopicEvolutionLine, topicKey } from "@/lib/review-report";

/** Nível sugerido para a próxima revisão direcionada, a partir do resultado da atividade que acabou de terminar. */
export function suggestDifficulty(report: Pick<Report, "percent" | "focus">): Difficulty {
  const previous = report.focus?.difficulty;
  if (!previous) return report.percent >= 70 ? 2 : 1; // primeira revisão dos pontos fracos
  if (report.percent >= 75) return Math.min(3, previous + 1) as Difficulty; // foi bem: sobe
  if (report.percent < 40) return Math.max(1, previous - 1) as Difficulty; // foi mal: reforça num nível mais simples
  return previous;
}

export type AnswerRow = { attempt_id: string; topic: string; topic_key?: string | null; correct: boolean; created_at: string };
export type TopicPoint = { attemptId: string; at: string; total: number; correct: number; percent: number };
export type TopicEvolution = TopicEvolutionLine & {
  key: string;
  points: TopicPoint[];
  delta: number | null; // diferença entre a última e a primeira medição confiável
  confirmed: boolean; // bom desempenho repetido em pelo menos 2 sessões seguidas
};

/** Só compara sessões com respostas suficientes; uma pergunta isolada não mede nada. */
const MIN_PER_POINT = 2;
const CHANGE_POINTS = 15;

export function buildEvolution(rows: AnswerRow[]): TopicEvolution[] {
  const byTopic = new Map<string, { topic: string; at: string; attempts: Map<string, TopicPoint> }>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const row of sorted) {
    const key = row.topic_key || topicKey(row.topic);
    if (!key) continue;
    const entry = byTopic.get(key) ?? { topic: row.topic, at: row.created_at, attempts: new Map<string, TopicPoint>() };
    entry.topic = row.topic; // mantém o nome mais recente
    const point = entry.attempts.get(row.attempt_id) ?? { attemptId: row.attempt_id, at: row.created_at, total: 0, correct: 0, percent: 0 };
    point.total += 1;
    if (row.correct) point.correct += 1;
    point.percent = Math.round((point.correct / point.total) * 100);
    entry.attempts.set(row.attempt_id, point);
    byTopic.set(key, entry);
  }

  return [...byTopic.entries()].map(([key, entry]) => {
    const points = [...entry.attempts.values()].sort((a, b) => a.at.localeCompare(b.at));
    const reliable = points.filter((p) => p.total >= MIN_PER_POINT);
    let trend: Trend = "insuficiente";
    let delta: number | null = null;
    if (reliable.length >= 2) {
      delta = reliable[reliable.length - 1].percent - reliable[0].percent;
      trend = delta >= CHANGE_POINTS ? "melhorando" : delta <= -CHANGE_POINTS ? "piorando" : "estavel";
    }
    const lastTwo = reliable.slice(-2);
    const confirmed = lastTwo.length === 2 && lastTwo.every((p) => p.percent >= 80);
    return { key, topic: entry.topic, points, trend, delta, confirmed };
  });
}

/** Evolução só dos assuntos de um relatório, na mesma ordem dele. */
export function evolutionForReport(all: TopicEvolution[], report: Pick<Report, "topics">): TopicEvolution[] {
  const byKey = new Map(all.map((e) => [e.key, e]));
  return report.topics.map((t) => byKey.get(topicKey(t.topic))).filter((e): e is TopicEvolution => !!e);
}
