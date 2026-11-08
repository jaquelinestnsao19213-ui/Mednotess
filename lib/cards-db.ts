import { supabase } from "@/lib/supabase";
import type { AssistantCard } from "@/lib/cards";

export const REVIEW_TABLE_HINT =
  "A área Revisões ainda não foi criada no Supabase. Rode o arquivo schema9.sql no SQL Editor e tente de novo.";

/** Salva os cartões em Revisões. Pula os que já existem nessa página (mesma pergunta). */
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
  if (fresh.length) {
    const { error } = await supabase.from("study_cards").insert(
      fresh.map((card) => ({
        page_id: pageId,
        source_title: sourceTitle.slice(0, 200),
        kind: card.type,
        question: card.question,
        answer: card.answer,
        explanation: card.explanation ?? null,
        options: card.options ?? null,
        correct_index: card.correctIndex ?? null,
      }))
    );
    if (error) throw new Error(isMissingTable(error) ? REVIEW_TABLE_HINT : "Não foi possível salvar em Revisões agora.");
  }
  return { saved: fresh.length, skipped: cards.length - fresh.length };
}

export function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /study_cards/.test(error.message ?? "");
}
