import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { StudyMaterial } from "@/lib/study";

export default function ReviewPage() {
  const [items, setItems] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "flashcard" | "question">("all");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: loadError } = await supabase
        .from("study_materials")
        .select("*")
        .order("next_review_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (!active) return;
      if (loadError) {
        setError("Não foi possível carregar a revisão. Verifique se a tabela study_materials foi criada no Supabase.");
      } else {
        setItems((data ?? []) as StudyMaterial[]);
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  async function mark(item: StudyMaterial, correct: boolean) {
    const outcome = {
      ease: correct ? Math.min(3.5, (item.ease || 2.5) + 0.15) : Math.max(1.2, (item.ease || 2.5) - 0.25),
      interval: correct ? Math.max(2, (item.interval_days || 1) + 1) : 1,
      mastery: Math.min(100, Math.max(0, item.mastery + (correct ? 18 : -24))),
    };

    const now = new Date().toISOString();
    const dueAt = new Date(Date.now() + outcome.interval * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase.from("study_materials").update({
      ease: outcome.ease,
      interval_days: outcome.interval,
      mastery: outcome.mastery,
      due_at: dueAt,
      next_review_at: dueAt,
      last_reviewed_at: now,
      correct_count: item.correct_count + (correct ? 1 : 0),
      incorrect_count: item.incorrect_count + (correct ? 0 : 1),
      updated_at: now,
    }).eq("id", item.id);

    if (updateError) {
      setError("Não foi possível registrar a revisão.");
      return;
    }

    setItems((current) => current.map((row) => row.id === item.id ? {
      ...row,
      ease: outcome.ease,
      interval_days: outcome.interval,
      mastery: outcome.mastery,
      due_at: dueAt,
      next_review_at: dueAt,
      last_reviewed_at: now,
      correct_count: row.correct_count + (correct ? 1 : 0),
      incorrect_count: row.incorrect_count + (correct ? 0 : 1),
      updated_at: now,
    } : row));
    setRevealed((current) => ({ ...current, [item.id]: true }));
  }

  const filtered = items.filter((item) => filter === "all" || item.type === filter);

  return (
    <div className="shell review-page">
      <div className="head">
        <div>
          <span className="eyebrow">REVISÃO</span>
          <h1 className="display">Painel de revisão</h1>
        </div>
        <Link className="secondary" href="/">Voltar ao início</Link>
      </div>

      {error && <p className="notice">{error}</p>}

      <div className="study-toggle review-filters">
        <button type="button" className={filter === "all" ? "chip on" : "chip"} onClick={() => setFilter("all")}>Tudo</button>
        <button type="button" className={filter === "flashcard" ? "chip on" : "chip"} onClick={() => setFilter("flashcard")}>Flashcards</button>
        <button type="button" className={filter === "question" ? "chip on" : "chip"} onClick={() => setFilter("question")}>Questões</button>
      </div>

      {loading ? (
        <p className="muted">Carregando revisão…</p>
      ) : filtered.length === 0 ? (
        <div className="study-empty">
          <p>Nenhum item pendente de revisão.</p>
          <span>Use o gerador de flashcards e questões nos cadernos para popular sua fila.</span>
        </div>
      ) : (
        <div className="study-grid review-grid">
          {filtered.map((item) => {
            const show = !!revealed[item.id];

            return (
              <article key={item.id} className="study-card review-card">
                <div className="study-card-head">
                  <span className={item.type === "flashcard" ? "study-pill accent" : "study-pill"}>{item.type === "flashcard" ? "Flashcard" : "Questão"}</span>
                  <small>{item.mastery}%</small>
                </div>

                <h3>{item.title}</h3>
                <p className="study-prompt">{item.prompt}</p>

                {item.type === "question" ? (
                  <>
                    {item.options?.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="study-option"
                        onClick={() => !show && void mark(item, option === item.correct_option)}
                      >
                        {option}
                      </button>
                    ))}

                    {show && (
                      <div className="study-answer-box">
                        <strong>Resposta correta:</strong> {item.correct_option ?? item.answer}
                        {item.explanation && <p>{item.explanation}</p>}
                        <div className="study-actions">
                          <button type="button" className="chip on" onClick={() => void mark(item, true)}>Acertou</button>
                          <button type="button" className="chip" onClick={() => void mark(item, false)}>Errei</button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {!show ? (
                      <button type="button" className="secondary" onClick={() => setRevealed((current) => ({ ...current, [item.id]: true }))}>Revelar resposta</button>
                    ) : (
                      <div className="study-answer-box">
                        <strong>Resposta:</strong>
                        <p>{item.answer}</p>
                        {item.explanation && <p>{item.explanation}</p>}
                        <div className="study-actions">
                          <button type="button" className="chip on" onClick={() => void mark(item, true)}>Acertou</button>
                          <button type="button" className="chip" onClick={() => void mark(item, false)}>Errei</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
