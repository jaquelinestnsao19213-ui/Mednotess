// Regras da Central de Avaliações: cobertura por assunto, índice de prontidão e cronograma regressivo.
// Tudo aqui é cálculo puro (sem rede), para ser fácil de testar.
import type { StudyCard, Topic } from "@/lib/types";

export type CardLite = Pick<StudyCard, "id" | "page_id" | "topic" | "kind" | "due_at" | "interval_days" | "reps" | "lapses" | "last_reviewed_at">;

export type TopicStatus = "sem-notas" | "sem-cards" | "nao-estudado" | "revisar" | "consolidado";

export const STATUS_LABEL: Record<TopicStatus, string> = {
  "sem-notas": "Sem anotações",
  "sem-cards": "Sem revisão criada",
  "nao-estudado": "Não estudado",
  revisar: "Precisa revisar",
  consolidado: "Consolidado",
};

export type TopicCoverage = {
  topic: Topic;
  pageIds: string[];
  cards: CardLite[];
  reviewed: number;
  consolidated: number;
  due: number;
  mastery: number | null; // 0..1, só existe quando há cards
  score: number; // 0..100, entra no índice de prontidão
  status: TopicStatus;
};

const norm = (text: string | null | undefined) => (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** Um card conta como consolidado quando já foi acertado mais de uma vez e só volta em 6 dias ou mais. */
const isConsolidated = (card: CardLite) => card.reps >= 2 && card.interval_days >= 6;

export function coverageFor(topic: Topic, pageIds: string[], allCards: CardLite[], now = new Date()): TopicCoverage {
  const pages = new Set(pageIds);
  const name = norm(topic.name);
  const cards = allCards.filter((c) => (c.page_id && pages.has(c.page_id)) || (name && norm(c.topic) === name));
  const reviewed = cards.filter((c) => !!c.last_reviewed_at).length;
  const consolidated = cards.filter(isConsolidated).length;
  const due = cards.filter((c) => new Date(c.due_at).getTime() <= now.getTime()).length;
  const mastery = cards.length ? consolidated / cards.length : null;

  let status: TopicStatus;
  let score: number;
  if (!pageIds.length && !cards.length) { status = "sem-notas"; score = 0; }
  else if (!cards.length) { status = "sem-cards"; score = 15; }
  else if (!reviewed) { status = "nao-estudado"; score = 25; }
  else {
    score = Math.round(30 + 70 * (mastery ?? 0));
    status = (mastery ?? 0) >= 0.7 ? "consolidado" : "revisar";
  }
  return { topic, pageIds, cards, reviewed, consolidated, due, mastery, score, status };
}

/** Índice de prontidão: média da pontuação dos assuntos cobrados. */
export function readiness(list: Pick<TopicCoverage, "score">[]): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, item) => sum + item.score, 0) / list.length);
}

/* ---------- datas (chave "AAAA-MM-DD", sempre no fuso local) ---------- */

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function fromDateKey(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(value: string, days: number) {
  const date = fromDateKey(value);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}
export function daysUntil(target: string, today: string) {
  return Math.round((fromDateKey(target).getTime() - fromDateKey(today).getTime()) / 86_400_000);
}

/* ---------- cronograma regressivo ---------- */

export type PlanKind = "estudo" | "revisao" | "geral";
export type PlanItem = { date: string; kind: PlanKind; topicId: string | null; title: string };
export const PLAN_LABEL: Record<PlanKind, string> = { estudo: "Estudar", revisao: "Revisar", geral: "Revisão geral" };

/**
 * Do dia de hoje até a véspera da prova:
 *  - 1ª fase (cerca de 60% dos dias): estudar cada assunto, começando pelos mais fracos;
 *  - 2ª fase: voltar nos assuntos (revisão), de novo dos mais fracos para os mais fortes;
 *  - últimos dias: revisão geral e simulado.
 * Os assuntos são espalhados por igual entre os dias disponíveis.
 */
export function buildPlan(topics: { id: string; name: string; score: number }[], examDate: string, today: string): PlanItem[] {
  const days = daysUntil(examDate, today);
  if (days <= 0 || !topics.length) return [];

  const dates = Array.from({ length: days }, (_, i) => addDays(today, i)); // hoje .. véspera
  const generalCount = days >= 10 ? 2 : days >= 3 ? 1 : 0;
  const workDates = dates.slice(0, days - generalCount);
  const studyCount = workDates.length === 1 ? 1 : Math.max(1, Math.ceil(workDates.length * 0.6));
  const studyDates = workDates.slice(0, studyCount);
  const reviewDates = workDates.slice(studyCount);

  const ordered = [...topics].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "pt-BR"));
  const items: PlanItem[] = [];
  const spread = (phase: string[], kind: PlanKind) => {
    if (!phase.length) return;
    ordered.forEach((topic, i) => {
      const date = phase[Math.floor((i * phase.length) / ordered.length)];
      items.push({ date, kind, topicId: topic.id, title: `${PLAN_LABEL[kind]}: ${topic.name}` });
    });
  };
  spread(studyDates, "estudo");
  spread(reviewDates, "revisao");

  const general = dates.slice(days - generalCount);
  general.forEach((date, i) => {
    const last = i === general.length - 1;
    items.push({ date, kind: "geral", topicId: null, title: last ? "Revisão geral + simulado" : "Revisão geral dos pontos fracos" });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
