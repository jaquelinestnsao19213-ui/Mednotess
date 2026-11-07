import type { Flashcard } from "@/lib/types";

export type SM2Result = Pick<
  Flashcard,
  "interval" | "ease_factor" | "repetitions" | "next_review"
>;

function dateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calculateSM2(
  card: Pick<Flashcard, "interval" | "ease_factor" | "repetitions">,
  quality: number,
  reviewedAt: Date = new Date(),
): SM2Result {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError("A nota SM-2 precisa ser um número inteiro entre 0 e 5.");
  }

  const qualityPenalty = 5 - quality;
  const easeFactor = Math.max(
    1.3,
    card.ease_factor +
      0.1 -
      qualityPenalty * (0.08 + qualityPenalty * 0.02),
  );

  let repetitions: number;
  let interval: number;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    repetitions = card.repetitions + 1;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(card.interval * easeFactor));
    }
  }

  const nextDate = new Date(reviewedAt);
  nextDate.setUTCHours(0, 0, 0, 0);
  nextDate.setUTCDate(nextDate.getUTCDate() + interval);

  return {
    interval,
    ease_factor: easeFactor,
    repetitions,
    next_review: dateToKey(nextDate),
  };
}
