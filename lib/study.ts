export type StudyMaterialType = "flashcard" | "question";

export type StudyMaterial = {
  id: string;
  user_id: string;
  page_id: string | null;
  page_title: string | null;
  subject_id: string | null;
  subject_name: string | null;
  type: StudyMaterialType;
  title: string;
  prompt: string;
  answer: string;
  options: string[] | null;
  correct_option: string | null;
  explanation: string | null;
  due_at: string | null;
  interval_days: number;
  ease: number;
  mastery: number;
  correct_count: number;
  incorrect_count: number;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function extractPageText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => extractPageText(item)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;

  const textParts: string[] = [];
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) textParts.push(item.trim());
    else if (Array.isArray(item)) textParts.push(extractPageText(item));
    else if (item && typeof item === "object") textParts.push(extractPageText(item));
  }

  return textParts.join("\n").replace(/\s+/g, " ").trim();
}

export function getReviewOutcome(correct: boolean, currentEase: number, currentInterval: number, mastery: number) {
  const ease = correct ? Math.min(3.5, Math.max(1.2, currentEase + 0.15)) : Math.max(1.2, currentEase - 0.25);
  const interval = correct ? Math.max(1, Math.round(currentInterval * ease)) : 1;
  const nextMastery = Math.min(100, Math.max(0, mastery + (correct ? 18 : -24)));
  const nextDueAt = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();

  return { ease, interval, mastery: nextMastery, nextDueAt };
}
