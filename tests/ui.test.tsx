// Testes de interface (jsdom): correção imediata, relatório, botão de pontos fracos, evolução e cópia.
// Dependências só para o teste (não entram no package.json): npm i --no-save jsdom @testing-library/react @testing-library/dom @testing-library/user-event
import { dom } from "./ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ReviewSession from "../components/ReviewSession";
import ReviewReport from "../components/ReviewReport";
import { buildReport } from "../lib/review-report";
import { buildEvolution, evolutionForReport } from "../lib/progress";
import type { StudyCard } from "../lib/types";
import type { AnswerRecord } from "../lib/review-report";

const card = (i: number, over: Partial<StudyCard> = {}): StudyCard => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, user_id: "u", page_id: null, source_title: "Farmacologia", kind: "question",
  question: `Enunciado ${i}?`, answer: `Certa ${i}`, explanation: `Explicação ${i}`, options: [`Certa ${i}`, `Errada ${i}a`, `Errada ${i}b`, `Errada ${i}c`, `Errada ${i}d`],
  correct_index: 0, topic: i === 1 ? "Farmacocinética" : "Metabolismo hepático", concept: `Conceito ${i}`, option_notes: ["ok", `Nota errada ${i}a`, "b", "c", "d"],
  due_at: new Date().toISOString(), interval_days: 0, ease: 2.5, reps: 0, lapses: 0, last_reviewed_at: null, created_at: new Date().toISOString(), ...over,
});

test("quiz: correção imediata com gabarito, explicação e nota da alternativa; registra acertos e erros", async () => {
  let result: { answers: AnswerRecord[]; reason: string } | null = null;
  render(<ReviewSession cards={[card(1), card(2)]} mode="quiz" timeLimitMin={null} onFinish={(r) => { result = r; }} />);
  assert.ok(screen.getByText(/de 2/));
  // questão 1: acerta
  fireEvent.click(screen.getByText("Certa 1"));
  fireEvent.click(screen.getByText("Confirmar resposta"));
  assert.ok(screen.getByText("✓ Resposta correta!"));
  assert.ok(screen.getByText(/Explicação 1/));
  fireEvent.click(screen.getByText("Próxima questão"));
  // questão 2: erra
  fireEvent.click(screen.getByText("Errada 2a"));
  fireEvent.click(screen.getByText("Confirmar resposta"));
  assert.ok(screen.getByText("✕ Resposta incorreta"));
  assert.ok(screen.getByText(/Nota errada 2a/));
  assert.ok(screen.getByText(/Gabarito:/));
  assert.ok(screen.getByText(/Conceito 2/));
  // a resposta fica travada depois de confirmar
  assert.ok((screen.getByText("Certa 2").closest("button") as HTMLButtonElement).disabled);
  fireEvent.click(screen.getByText("Ver resultado"));
  await waitFor(() => assert.ok(result));
  const r = result as unknown as { answers: AnswerRecord[]; reason: string };
  assert.deepEqual(r.answers.map((a) => a.correct), [true, false]);
  assert.equal(r.answers[1].topic, "Metabolismo hepático");
  assert.match(r.answers[1].chosen ?? "", /Errada 2a/);
  assert.match(r.answers[1].correctAnswer, /Certa 2/);
  assert.equal(r.reason, "completo");
  cleanup();
});

test("flashcards: vira o cartão e marca sei / não sei", async () => {
  let result: { answers: AnswerRecord[] } | null = null;
  const cards = [card(1, { kind: "flashcard", options: null, correct_index: null }), card(2, { kind: "flashcard", options: null, correct_index: null })];
  render(<ReviewSession cards={cards} mode="flashcards" timeLimitMin={null} onFinish={(r) => { result = r; }} />);
  assert.ok((screen.getByText("✓ Sei a resposta") as HTMLButtonElement).disabled, "só libera depois de virar");
  fireEvent.click(screen.getByLabelText("Virar o cartão para ver a resposta"));
  fireEvent.click(screen.getByText("✓ Sei a resposta"));
  fireEvent.click(screen.getByLabelText("Virar o cartão para ver a resposta"));
  fireEvent.click(screen.getByText("✕ Não sei a resposta"));
  await waitFor(() => assert.ok(result));
  assert.deepEqual((result as unknown as { answers: AnswerRecord[] }).answers.map((a) => a.correct), [true, false]);
  cleanup();
});

const mk = (topic: string, correct: boolean, n: number): AnswerRecord => ({
  cardId: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, kind: "question", question: `Pergunta ${n}`, chosen: "B) x", correctAnswer: "A) y",
  explanation: "Explicação", chosenNote: "Nota", topic, concept: correct ? null : `Conceito de ${topic}`, correct, seconds: 5,
});
const report = buildReport([mk("Farmacocinética", true, 1), mk("Farmacocinética", true, 2), mk("Metabolismo hepático", false, 3), mk("Metabolismo hepático", false, 4), mk("Metabolismo hepático", true, 5)], { mode: "quiz", title: "Paracetamol", seconds: 80, reason: "completo" });

test("relatório: desempenho geral, situação por assunto, análise dos erros", () => {
  render(<ReviewReport report={report} onBack={() => {}} />);
  const text = document.body.textContent ?? "";
  for (const piece of ["60%", "Respondidas", "Acertos", "Erros", "Tempo", "Bom desempenho", "Precisa revisar", "Análise dos erros (2)", "Sua resposta:", "Gabarito", "Explicação:", "Revisar: Conceito de Metabolismo hepático", "Uma única sessão não comprova domínio"]) {
    assert.ok(text.includes(piece), `faltou: ${piece}`);
  }
  assert.ok(!screen.queryByText("Revisar meus pontos fracos"), "botão não deve aparecer sem onFocus");
  cleanup();
});

test("botão 'Revisar meus pontos fracos': abre as opções e dispara a revisão com tipo e quantidade escolhidos", () => {
  const calls: unknown[] = [];
  render(<ReviewReport report={report} onBack={() => {}} onFocus={(r) => calls.push(r)} focusDifficulty={2} />);
  fireEvent.click(screen.getByText("Revisar meus pontos fracos"));
  assert.ok(screen.getByText(/nível/), "mostra o nível sugerido");
  assert.ok(screen.getByText(/intermediário/));
  for (const n of ["5", "10", "15", "20"]) assert.ok(screen.getByRole("radio", { name: n }));
  fireEvent.click(screen.getByRole("radio", { name: "Flashcards" }));
  fireEvent.click(screen.getByRole("radio", { name: "15" }));
  fireEvent.click(screen.getByText("Gerar 15 flashcards"));
  assert.deepEqual(calls, [{ kind: "flashcard", count: 15 }]);
  cleanup();
});

test("botão de pontos fracos mostra carregando e erro compreensível; some quando não há erros", () => {
  const { rerender } = render(<ReviewReport report={report} onBack={() => {}} onFocus={() => {}} focusBusy />);
  fireEvent.click(screen.getByText("Revisar meus pontos fracos"));
  assert.ok((screen.getByText(/A IA está criando/) as HTMLButtonElement).disabled);
  rerender(<ReviewReport report={report} onBack={() => {}} onFocus={() => {}} focusError="A IA demorou mais do que o limite do servidor." />);
  assert.ok(screen.getByRole("alert"));
  const perfect = buildReport([mk("A", true, 1), mk("A", true, 2)], { mode: "quiz", title: "t", seconds: 5, reason: "completo" });
  rerender(<ReviewReport report={perfect} onBack={() => {}} onFocus={() => {}} />);
  assert.ok(!screen.queryByText("Revisar meus pontos fracos"));
  cleanup();
});

test("evolução 40% → 60% → 90% aparece no relatório", () => {
  const rows = (attempt: string, at: string, c: number, total: number) => Array.from({ length: total }, (_, i) => ({ attempt_id: attempt, topic: "Metabolismo hepático", correct: i < c, created_at: at }));
  const evo = evolutionForReport(buildEvolution([...rows("a", "2026-01-01T00:00:00Z", 2, 5), ...rows("b", "2026-01-02T00:00:00Z", 3, 5), ...rows("c", "2026-01-03T00:00:00Z", 9, 10)]), report);
  render(<ReviewReport report={report} onBack={() => {}} evolution={evo} />);
  assert.ok(screen.getByText("40% → 60% → 90%"));
  assert.ok(screen.getByText(/melhorando/));
  cleanup();
});

test("copiar relatório: copia o texto completo e confirma na tela", async () => {
  let copied = "";
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
  render(<ReviewReport report={report} onBack={() => {}} />);
  fireEvent.click(screen.getByText("Copiar relatório"));
  await waitFor(() => assert.ok(screen.getByText("✓ Relatório copiado")));
  for (const piece of ["DESEMPENHO GERAL", "Aproveitamento: 60%", "QUESTÕES ERRADAS (2)", "Minha resposta: B) x", "Gabarito: A) y", "Explicação: Explicação", "Revisar: Conceito de Metabolismo hepático", "PLANO DE REVISÃO", "DESEMPENHO POR ASSUNTO"]) assert.ok(copied.includes(piece), `faltou no texto copiado: ${piece}`);
  cleanup();
});

test("copiar relatório funciona sem a API de área de transferência (alternativa execCommand)", async () => {
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async () => { throw new Error("bloqueado"); } }, configurable: true });
  let used = false;
  (dom.window.document as unknown as { execCommand: () => boolean }).execCommand = () => { used = true; return true; };
  render(<ReviewReport report={report} onBack={() => {}} />);
  fireEvent.click(screen.getByText("Copiar relatório"));
  await waitFor(() => assert.ok(screen.getByText("✓ Relatório copiado")));
  assert.ok(used);
  cleanup();
});

test("flashcards: relatório mostra conhecidos e não conhecidos", () => {
  const fr = buildReport([{ ...mk("A", true, 1), kind: "flashcard", chosen: null }, { ...mk("A", false, 2), kind: "flashcard", chosen: null }], { mode: "flashcards", title: "t", seconds: 5, reason: "completo" });
  render(<ReviewReport report={fr} onBack={() => {}} />);
  const text = document.body.textContent ?? "";
  assert.ok(text.includes("Cartões que você sabe (1)") && text.includes("Cartões para revisar (1)") && text.includes("50%"));
  cleanup();
});
