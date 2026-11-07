"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getReviewOutcome, type StudyMaterial } from "@/lib/study";

export default function StudyWorkspace({
  pageId,
  pageTitle,
  sourceText,
}: {
  pageId: string | null;
  pageTitle: string;
  sourceText: string;
}) {
  const [items, setItems] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"flashcard" | "question">("flashcard");
  const [prompt, setPrompt] = useState("Crie um conjunto útil para revisão prática e objetiva.");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!pageId) return;

    let active = true;

    (async () => {
      const { data, error: loadError } = await supabase
        .from("study_materials")
        .select("*")
        .eq("page_id", pageId)
        .order("created_at", { ascending: false });

      if (!active) return;
      if (loadError) {
        setError("Não foi possível carregar os materiais desta página.");
      } else {
        setItems((data ?? []) as StudyMaterial[]);
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [pageId]);

  async function recordReview(material: StudyMaterial, correct: boolean) {
    const outcome = getReviewOutcome(correct, material.ease || 2.5, material.interval_days || 1, material.mastery || 0);
    const now = new Date().toISOString();
    const patch = {
      ease: outcome.ease,
      interval_days: outcome.interval,
      mastery: outcome.mastery,
      due_at: outcome.nextDueAt,
      next_review_at: outcome.nextDueAt,
      last_reviewed_at: now,
      correct_count: material.correct_count + (correct ? 1 : 0),
      incorrect_count: material.incorrect_count + (correct ? 0 : 1),
      updated_at: now,
    };

    const { error: updateError } = await supabase.from("study_materials").update(patch).eq("id", material.id);
    if (updateError) {
      setError("Não foi possível atualizar o histórico de revisão.");
      return;
    }

    setItems((current) => current.map((row) => row.id === material.id ? { ...row, ...patch } : row));
    setRevealed((current) => ({ ...current, [material.id]: true }));
  }

  async function generateNow() {
    if (!sourceText?.trim()) return setError("Adicione conteúdo na página antes de gerar materiais.");
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Faça login para gerar materiais de estudo.");

      const response = await fetch("/api/study/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          type: mode,
          title: pageTitle,
          text: sourceText,
          prompt,
          pageId,
        }),
      });

      const payload = await response.json() as { items?: Array<Record<string, unknown>>; error?: string };
      if (!response.ok || !payload.items?.length) throw new Error(payload.error ?? "Não foi possível gerar os materiais.");

      const rows = payload.items.map((item) => ({
        page_id: pageId,
        page_title: pageTitle,
        subject_id: null,
        subject_name: null,
        type: mode,
        title: String(item.title ?? pageTitle),
        prompt: String(item.prompt ?? item.question ?? item.front ?? ""),
        answer: String(item.answer ?? item.back ?? item.correct_option ?? ""),
        options: Array.isArray(item.options) ? (item.options as unknown[]).map((option) => String(option)) : null,
        correct_option: item.correct_option ? String(item.correct_option) : null,
        explanation: item.explanation ? String(item.explanation) : null,
        due_at: new Date().toISOString(),
        interval_days: 1,
        ease: 2.5,
        mastery: 0,
        correct_count: 0,
        incorrect_count: 0,
        last_reviewed_at: null,
        next_review_at: new Date().toISOString(),
      }));

      const { data: inserted, error: insertError } = await supabase.from("study_materials").insert(rows).select("*");
      if (insertError || !inserted) throw new Error("Não foi possível salvar os materiais no banco.");

      setItems((current) => [...(inserted as StudyMaterial[]), ...current]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar o material de revisão.");
    } finally {
      setBusy(false);
    }
  }

  if (!pageId) return null;

  return (
    <section className="study-board">
      <div className="study-header">
        <div>
          <span className="eyebrow">FLASHCARDS & QUESTÕES</span>
          <h2>Revisão inteligente</h2>
        </div>
      </div>

      <div className="study-generator">
        <div className="study-toggle">
          <button type="button" className={mode === "flashcard" ? "chip on" : "chip"} onClick={() => setMode("flashcard")}>Flashcards</button>
          <button type="button" className={mode === "question" ? "chip on" : "chip"} onClick={() => setMode("question")}>Questões</button>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="Ex.: Gere 5 flashcards focados nos pontos mais importantes deste conteúdo."
        />

        <div className="row">
          <button type="button" className="primary" disabled={busy || !sourceText.trim()} onClick={() => void generateNow()}>
            {busy ? "Gerando…" : `Gerar ${mode === "flashcard" ? "flashcards" : "questões"}`}
          </button>
        </div>
      </div>

      {error && <p className="notice">{error}</p>}

      {loading ? (
        <p className="muted">Carregando materiais…</p>
      ) : items.length === 0 ? (
        <div className="study-empty">
          <p>Nenhum material salvo ainda para este caderno.</p>
          <span>Use a IA para transformar este conteúdo em flashcards ou questões.</span>
        </div>
      ) : (
        <div className="study-grid">
          {items.map((material) => {
            const isQuestion = material.type === "question";
            const showAnswer = !!revealed[material.id];
            const options = material.options ?? [];

            return (
              <article key={material.id} className="study-card">
                <div className="study-card-head">
                  <span className={material.type === "flashcard" ? "study-pill accent" : "study-pill"}>{material.type === "flashcard" ? "Flashcard" : "Questão"}</span>
                  <small>{material.mastery}%</small>
                </div>

                <h3>{material.title}</h3>
                <p className="study-prompt">{material.prompt}</p>

                {isQuestion ? (
                  <div className="study-options">
                    {options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={selected[material.id] === option ? "study-option selected" : "study-option"}
                        onClick={async () => {
                          const correct = option === material.correct_option;
                          setSelected((current) => ({ ...current, [material.id]: option }));
                          setRevealed((current) => ({ ...current, [material.id]: true }));
                          await recordReview(material, correct);
                        }}
                      >
                        {option}
                      </button>
                    ))}

                    {showAnswer && (
                      <div className="study-answer-box">
                        <strong>Resposta correta:</strong> {material.correct_option ?? material.answer}
                        {material.explanation && <p>{material.explanation}</p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {!showAnswer ? (
                      <button type="button" className="secondary" onClick={() => setRevealed((current) => ({ ...current, [material.id]: true }))}>
                        Revelar resposta
                      </button>
                    ) : (
                      <div className="study-answer-box">
                        <strong>Resposta:</strong>
                        <p>{material.answer}</p>
                        {material.explanation && <p>{material.explanation}</p>}
                        <div className="study-actions">
                          <button type="button" className="chip on" onClick={() => void recordReview(material, true)}>Acertou</button>
                          <button type="button" className="chip" onClick={() => void recordReview(material, false)}>Errei</button>
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
    </section>
  );
}
