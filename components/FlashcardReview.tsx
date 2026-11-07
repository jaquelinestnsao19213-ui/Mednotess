"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Flashcard } from "@/lib/types";
import { calculateSM2 } from "@/lib/sm2";

const RATINGS = [
  { quality: 0, label: "0 · Não lembrei" },
  { quality: 1, label: "1 · Quase nada" },
  { quality: 2, label: "2 · Difícil" },
  { quality: 3, label: "3 · Com dificuldade" },
  { quality: 4, label: "4 · Lembrei" },
  { quality: 5, label: "5 · Fácil" },
] as const;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FlashcardReview() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("flashcards")
      .select("*")
      .lte("next_review", todayKey())
      .order("next_review", { ascending: true })
      .order("created_at", { ascending: true });

    if (loadError) {
      setError(
        "Não foi possível carregar os flashcards. Confira se a tabela foi criada no Supabase e se você está conectado.",
      );
      setCards([]);
    } else {
      setCards((data ?? []) as Flashcard[]);
      setIndex(0);
      setRevealed(false);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  async function submitRating(quality: number) {
    const card = cards[index];
    if (!card || saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    let result: ReturnType<typeof calculateSM2>;

    try {
      result = calculateSM2(card, quality);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nota inválida.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("flashcards")
      .update({
        ...result,
        updated_at: new Date().toISOString(),
      })
      .eq("id", card.id)
      .eq("user_id", card.user_id);

    if (updateError) {
      setError("Não foi possível salvar sua revisão. Tente novamente.");
      setSaving(false);
      return;
    }

    setCards((current) => current.filter((item) => item.id !== card.id));
    setIndex(0);
    setRevealed(false);
    setNotice(`Revisão salva. Próxima revisão: ${result.next_review}.`);
    setSaving(false);
  }

  const card = cards[index];

  if (loading) {
    return <p className="muted">Carregando flashcards…</p>;
  }

  return (
    <section className="flashcard-review" aria-labelledby="flashcard-review-title">
      <div className="flashcard-review-heading">
        <div>
          <span className="eyebrow">REVISÃO</span>
          <h2 id="flashcard-review-title">Flashcards para hoje</h2>
        </div>

        <span aria-live="polite">
          {cards.length > 0 ? `${cards.length} restante(s)` : ""}
        </span>
      </div>

      {error && <p className="notice" role="alert">{error}</p>}
      {notice && <p className="flashcard-notice" role="status">{notice}</p>}

      {!card ? (
        <div className="flashcard-empty">
          <strong>Você terminou a fila de hoje.</strong>
          <p>Quando houver cartões vencidos, eles aparecerão aqui.</p>
          <button type="button" className="secondary" onClick={() => void loadCards()}>
            Atualizar fila
          </button>
        </div>
      ) : (
        <>
          <article className="flashcard" aria-live="polite">
            <p className="flashcard-side-label">{revealed ? "Resposta" : "Pergunta"}</p>
            <p className="flashcard-text">
              {revealed ? card.back : card.front}
            </p>

            {!revealed ? (
              <button
                type="button"
                className="primary"
                onClick={() => setRevealed(true)}
              >
                Virar cartão
              </button>
            ) : (
              <div className="flashcard-feedback">
                <p>Como foi lembrar da resposta?</p>
                <div className="flashcard-rating-buttons">
                  {RATINGS.map(({ quality, label }) => (
                    <button
                      key={quality}
                      type="button"
                      className={quality < 3 ? "secondary" : "primary"}
                      disabled={saving}
                      onClick={() => void submitRating(quality)}
                    >
                      {saving ? "Salvando…" : label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>

          <p className="muted flashcard-progress">
            Cartão {index + 1} de {cards.length} ·
            {" "}intervalo atual: {card.interval} dia(s)
          </p>
        </>
      )}
    </section>
  );
}
