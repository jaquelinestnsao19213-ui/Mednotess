import test from "node:test";
import assert from "node:assert/strict";
import { buildEvolution, evolutionForReport, suggestDifficulty } from "../lib/progress";
import { buildReport, reportToText, situationOf, topicKey, weakFocusFromAnswers, type AnswerRecord } from "../lib/review-report";
import { dedupeCards, parseModelObject, planBatches, salvageCards, unifyTopics } from "../lib/server/review-ai";
import { ApiError, postJson } from "../lib/api";

const ans = (topic: string, correct: boolean, n = 1): AnswerRecord => ({
  cardId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, kind: "question", question: `Pergunta ${topic} ${n}`, chosen: correct ? "A) x" : "B) y",
  correctAnswer: "A) x", explanation: "porque sim", chosenNote: null, topic, concept: correct ? null : `Conceito de ${topic}`, correct, seconds: 10,
});

test("situação por assunto usa as faixas do enunciado e não inventa nível com poucos dados", () => {
  assert.equal(situationOf({ total: 5, percent: 80 }), "Bom desempenho");
  assert.equal(situationOf({ total: 4, percent: 50 }), "Atenção");
  assert.equal(situationOf({ total: 5, percent: 40 }), "Precisa revisar");
  assert.equal(situationOf({ total: 1, percent: 100 }), "Poucos dados");
});

test("relatório conta acertos, erros e agrupa por assunto", () => {
  const answers = [ans("Farmacocinética", true, 1), ans("Farmacocinética", true, 2), ans("Farmacodinâmica", false, 3), ans("Farmacodinâmica", true, 4), ans("Metabolismo hepático", false, 5), ans("Metabolismo hepático", false, 6)];
  const r = buildReport(answers, { mode: "quiz", title: "T", seconds: 90, reason: "completo" });
  assert.deepEqual([r.total, r.correct, r.wrong, r.percent], [6, 3, 3, 50]);
  assert.deepEqual(r.topics.map((t) => [t.topic, t.percent]), [["Metabolismo hepático", 0], ["Farmacodinâmica", 50], ["Farmacocinética", 100]]);
});

test("pontos fracos: só assuntos com erro, do pior ao melhor, com conceitos e perguntas já feitas", () => {
  const weak = weakFocusFromAnswers([ans("Farmacocinética", true, 1), ans("Farmacocinética", true, 2), ans("Metabolismo hepático", false, 3), ans("Farmacodinâmica", false, 4), ans("Farmacodinâmica", true, 5)]);
  assert.deepEqual(weak.map((w) => w.topic), ["Metabolismo hepático", "Farmacodinâmica"]);
  assert.deepEqual(weak[0].concepts, ["Conceito de Metabolismo hepático"]);
  assert.equal(weak[1].questions.length, 2);
  assert.deepEqual(weakFocusFromAnswers([ans("X", true)]), []); // sem erro, sem ponto fraco
});

test("topicKey ignora acento, caixa e pontuação", () => {
  assert.equal(topicKey("Farmacocinética!"), topicKey(" farmacocinetica "));
});

test("evolução 40% → 60% → 90% é reconhecida como melhora e só confirma com 2 sessões boas seguidas", () => {
  const rows = (attempt: string, at: string, correct: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ attempt_id: attempt, topic: "Farmacocinética", correct: i < correct, created_at: at }));
  const all = [...rows("a1", "2026-01-01T10:00:00Z", 2, 5), ...rows("a2", "2026-01-02T10:00:00Z", 3, 5), ...rows("a3", "2026-01-03T10:00:00Z", 9, 10)];
  const [evo] = buildEvolution(all);
  assert.deepEqual(evo.points.map((p) => p.percent), [40, 60, 90]);
  assert.equal(evo.trend, "melhorando");
  assert.equal(evo.delta, 50);
  assert.equal(evo.confirmed, false); // só uma sessão >= 80
  const [again] = buildEvolution([...all, ...rows("a4", "2026-01-04T10:00:00Z", 4, 5)]);
  assert.equal(again.confirmed, true);
});

test("uma única atividade não gera tendência nem 'domínio confirmado'", () => {
  const [evo] = buildEvolution([{ attempt_id: "a1", topic: "Anatomia", correct: true, created_at: "2026-01-01T00:00:00Z" }, { attempt_id: "a1", topic: "Anatomia", correct: true, created_at: "2026-01-01T00:00:00Z" }]);
  assert.equal(evo.trend, "insuficiente");
  assert.equal(evo.confirmed, false);
  const [one] = buildEvolution([{ attempt_id: "a1", topic: "X", correct: true, created_at: "2026-01-01T00:00:00Z" }, { attempt_id: "a2", topic: "X", correct: false, created_at: "2026-01-02T00:00:00Z" }]);
  assert.equal(one.trend, "insuficiente"); // 1 resposta por sessão não mede nada
});

test("evolução agrupa o mesmo assunto mesmo com acento/caixa diferentes e queda é detectada", () => {
  const mk = (attempt: string, at: string, topic: string, c: boolean[]) => c.map((correct) => ({ attempt_id: attempt, topic, correct, created_at: at }));
  const evo = buildEvolution([...mk("a", "2026-01-01T00:00:00Z", "Farmacocinética", [true, true, true, true]), ...mk("b", "2026-01-02T00:00:00Z", "farmacocinetica", [true, false, false, false])]);
  assert.equal(evo.length, 1);
  assert.equal(evo[0].trend, "piorando");
  const report = buildReport([ans("Farmacocinética", false)], { mode: "quiz", title: "t", seconds: 1, reason: "completo" });
  assert.equal(evolutionForReport(evo, report).length, 1);
});

test("dificuldade sobe com bom desempenho, mantém no meio e alivia quando vai mal", () => {
  assert.equal(suggestDifficulty({ percent: 85, focus: null }), 2);
  assert.equal(suggestDifficulty({ percent: 50, focus: null }), 1);
  assert.equal(suggestDifficulty({ percent: 80, focus: { difficulty: 2, topics: [], parentId: null } }), 3);
  assert.equal(suggestDifficulty({ percent: 95, focus: { difficulty: 3, topics: [], parentId: null } }), 3);
  assert.equal(suggestDifficulty({ percent: 55, focus: { difficulty: 2, topics: [], parentId: null } }), 2);
  assert.equal(suggestDifficulty({ percent: 20, focus: { difficulty: 2, topics: [], parentId: null } }), 1);
  assert.equal(suggestDifficulty({ percent: 20, focus: { difficulty: 1, topics: [], parentId: null } }), 1);
});

test("texto do relatório copiado traz resultado, erros, resposta marcada, gabarito, explicação, assuntos e recomendações", () => {
  const r = buildReport([ans("Farmacocinética", true, 1), ans("Metabolismo hepático", false, 2), ans("Metabolismo hepático", false, 3)], { mode: "quiz", title: "Paracetamol", seconds: 75, reason: "completo" });
  const text = reportToText(r, [{ topic: "Metabolismo hepático", points: [{ percent: 40 }, { percent: 0 }], trend: "piorando" }]);
  for (const piece of ["DESEMPENHO GERAL", "Acertos: 1", "Erros: 2", "Aproveitamento: 33%", "QUESTÕES ERRADAS (2)", "Minha resposta: B) y", "Gabarito: A) x", "Explicação: porque sim", "Assunto: Metabolismo hepático", "Revisar: Conceito de Metabolismo hepático", "Precisa revisar", "PLANO DE REVISÃO", "EVOLUÇÃO", "40% → 0%", "não comprova domínio"]) {
    assert.ok(text.includes(piece), `faltou: ${piece}`);
  }
});

test("flashcards: relatório lista cartões conhecidos e não conhecidos", () => {
  const known: AnswerRecord = { ...ans("A", true, 1), kind: "flashcard", chosen: null };
  const unknown: AnswerRecord = { ...ans("A", false, 2), kind: "flashcard", chosen: null };
  const text = reportToText(buildReport([known, unknown], { mode: "flashcards", title: "t", seconds: 5, reason: "completo" }));
  assert.ok(text.includes("CARTÕES QUE EU SEI (1)"));
  assert.ok(text.includes("CARTÕES QUE PRECISAM DE REVISÃO (1)"));
});

test("lotes: 20 questões viram 4 chamadas de 5; 10 viram 2; 3 viram 1; soma sempre bate", () => {
  assert.deepEqual(planBatches(20, "question").map((b) => b.count), [5, 5, 5, 5]);
  assert.deepEqual(planBatches(10, "question").map((b) => b.count), [5, 5]);
  assert.deepEqual(planBatches(3, "question").map((b) => b.count), [3]);
  assert.deepEqual(planBatches(7, "question").map((b) => b.count), [4, 3]);
  assert.deepEqual(planBatches(20, "flashcard").map((b) => b.count), [7, 7, 6]);
});

test("leitura da resposta da IA: cercas, texto em volta e JSON cortado no meio", () => {
  assert.deepEqual(parseModelObject('```json\n{"cards":[{"a":1}]}\n```'), { cards: [{ a: 1 }] });
  assert.deepEqual(parseModelObject('Aqui está: {"cards":[{"a":1}]} fim'), { cards: [{ a: 1 }] });
  const truncated = '{"message":"ok","cards":[{"type":"flashcard","question":"Q1 {chaves}","answer":"A1"},{"type":"flashcard","question":"Q2","answer":"A2 \\"aspas\\""},{"type":"flashcard","question":"Q3","ans';
  assert.equal(salvageCards(truncated).length, 2);
  assert.equal((parseModelObject(truncated)!.cards as unknown[]).length, 2);
  assert.equal(parseModelObject("An error occurred"), null);
  assert.equal(parseModelObject(""), null);
});

test("topics parecidos são unificados e perguntas repetidas removidas", () => {
  const mk = (topic: string, question: string) => ({ type: "flashcard" as const, question, answer: "a", topic });
  const out = unifyTopics([mk("Farmacocinética", "q1"), mk("Farmacocinética geral", "q2"), mk("farmacocinetica", "q3"), mk("Outro assunto", "q4")]);
  assert.deepEqual(out.map((c) => c.topic), ["Farmacocinética", "Farmacocinética", "Farmacocinética", "Outro assunto"]);
  assert.equal(dedupeCards([mk("a", "Mesma pergunta?"), mk("b", "mesma pergunta")]).length, 1);
});

/* ---------- helper de chamadas: o erro "Unexpected token 'A', "An error o"..." ---------- */
const realFetch = globalThis.fetch;
const stub = (status: number, body: string, contentType: string) => {
  globalThis.fetch = (async () => new Response(body, { status, headers: contentType ? { "content-type": contentType } : {} })) as typeof fetch;
};
const call = () => postJson("/api/review", {}, { token: "t", validate: (d) => (Array.isArray(d.cards) ? (d.cards as unknown[]) : null) });

test("resposta de texto puro da plataforma (504) vira mensagem clara, não SyntaxError", async () => {
  stub(504, "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", "text/plain");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && e.status === 504 && /demorou/.test(e.message) && !/JSON|token/i.test(e.message));
});
test("HTML de erro, 413, 429 e 500 sem JSON têm mensagens próprias", async () => {
  stub(500, "<html>boom</html>", "text/html");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && /servidor/.test(e.message));
  stub(413, "Request Entity Too Large", "text/plain");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && /grande demais/.test(e.message));
  stub(429, "slow down", "text/plain");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && /Muitas solicitações/.test(e.message));
});
test("200 com content-type errado ou JSON inválido/estrutura errada também é tratado", async () => {
  stub(200, "An error occurred", "text/plain");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError);
  stub(200, "{quebrado", "application/json");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError);
  stub(200, JSON.stringify({ cards: "não é lista" }), "application/json");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && /incompleta/.test(e.message));
});
test("erro em JSON do nosso servidor mostra a mensagem e a referência; sucesso devolve os dados validados", async () => {
  stub(502, JSON.stringify({ error: "A IA demorou", ref: "ab12cd34" }), "application/json; charset=utf-8");
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && e.ref === "ab12cd34" && e.message === "A IA demorou");
  stub(200, JSON.stringify({ cards: [1, 2] }), "application/json");
  assert.deepEqual(await call(), [1, 2]);
});
test("sem rede vira mensagem de conexão", async () => {
  globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  await assert.rejects(call, (e: unknown) => e instanceof ApiError && /conexão/.test(e.message));
  globalThis.fetch = realFetch;
});
