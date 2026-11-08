import { supabase } from "@/lib/supabase";
import type { AssistantCard } from "@/lib/cards";
import type { StudyCard } from "@/lib/types";

export const REVIEW_TABLE_HINT =
  "A área Revisões ainda não foi criada (ou atualizada) no Supabase. Rode schema9.sql, schema10.sql e schema11.sql (nessa ordem) no SQL Editor e tente de novo.";

/** Salva os cartões em Revisões. Pula os que já existem nessa página (mesma pergunta). Devolve também as linhas criadas. */
export async function saveCardsToReview(cards: AssistantCard[], pageId: string | null, sourceTitle: string) {
  let existing = new Set<string>();
  if (pageId) {
    const { data, error } = await supabase
      .from("study_cards")
      .select("question")
      .eq("page_id", pageId)
      .in("question", cards.map((card) => card.question));
    if (error) throw new Error(isMissingTable(error) ? REVIEW_TABLE_HINT : "Não foi possível salvar em Revisões agora.");
    existing = new Set((data ?? []).map((row: { question: string }) => row.question));
  }
  const fresh = cards.filter((card) => !existing.has(card.question));
  let rows: StudyCard[] = [];
  if (fresh.length) {
    const { data, error } = await supabase
      .from("study_cards")
      .insert(
        fresh.map((card) => ({
          page_id: pageId,
          source_title: sourceTitle.slice(0, 200),
          kind: card.type,
          question: card.question,
          answer: card.answer,
          explanation: card.explanation ?? null,
          options: card.options ?? null,
          correct_index: card.correctIndex ?? null,
          topic: card.topic ?? null,
          concept: card.concept ?? null,
          option_notes: card.optionNotes ?? null,
        }))
      )
      .select("*");
    if (error) throw new Error(isMissingTable(error) ? REVIEW_TABLE_HINT : "Não foi possível salvar em Revisões agora.");
    rows = (data ?? []) as StudyCard[];
  }
  return { saved: fresh.length, skipped: cards.length - fresh.length, rows };
}

export function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /study_cards|review_attempts|review_answers|topic|concept|option_notes|source_page_ids|source_pdfs|parent_attempt_id|focus_topics|difficulty/.test(error.message ?? "")
  );
}
