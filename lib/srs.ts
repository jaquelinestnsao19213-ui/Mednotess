// Repetição espaçada simples (inspirada no SM-2): quanto melhor você acerta, mais tarde o item volta.
import type { StudyCard } from "@/lib/types";

export type Rating = 0 | 1 | 2 | 3; // errei, difícil, bom, fácil
export const RATING_LABELS = ["Errei", "Difícil", "Bom", "Fácil"] as const;

type Srs = Pick<StudyCard, "reps" | "interval_days" | "ease" | "lapses">;

export function nextSchedule(card: Srs, rating: Rating, now = new Date()) {
  let { reps, interval_days: interval, ease, lapses } = card;
  let days: number;
  if (rating === 0) {
    lapses += 1;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    days = 10 / 1440; // volta em 10 minutos
  } else if (rating === 1) {
    interval = Math.max(1, Math.round(Math.max(interval, 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
    days = interval;
  } else if (rating === 2) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, Math.round(interval * ease));
    reps += 1;
    days = interval;
  } else {
    interval = reps === 0 ? 3 : reps === 1 ? 6 : Math.max(2, Math.round(interval * ease * 1.3));
    ease += 0.15;
    reps += 1;
    days = interval;
  }
  return {
    reps,
    interval_days: interval,
    ease: Number(ease.toFixed(2)),
    lapses,
    due_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
    last_reviewed_at: now.toISOString(),
  };
}

/** Texto curto do próximo intervalo, para mostrar nos botões (ex.: "10 min", "3 d"). */
export function intervalLabel(card: Srs, rating: Rating) {
  if (rating === 0) return "10 min";
  const days = nextSchedule(card, rating).interval_days;
  if (days < 30) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30)} mês`;
  return `${Math.round(days / 365)} ano`;
}

export type CardStatus = "nova" | "revisar" | "em-dia";

export function statusOf(card: Pick<StudyCard, "reps" | "due_at" | "last_reviewed_at">, now = new Date()): CardStatus {
  if (!card.last_reviewed_at && card.reps === 0) return "nova";
  return new Date(card.due_at).getTime() <= now.getTime() ? "revisar" : "em-dia";
}
