// Fluxo completo da página de Revisões no jsdom, contra o servidor Next REAL (/api/review) com Supabase e IA simulados.
// Cobre: gerar quiz, correção imediata, persistência, relatório, revisão dos pontos fracos, 2ª tentativa com evolução,
// histórico, copiar relatório, erro amigável (IA lenta) e banco sem a migração.
import { dom } from "./ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { db, start, USERS } from "./mock-server.mjs";

const uid = USERS["token-yasmim"];
dom.window.localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "token-yasmim", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: "authenticated", email: "x@y.z" } }));
let copied = "";
Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });

import ReviewsPage from "../app/revisoes/page";
let mocks: { close: () => void };
test.before(async () => { mocks = await start(); });
const T = { timeout: 15_000 };

async function openGenerator(pageTitle: RegExp) {
  const details = document.querySelector("details.rv-gen") as HTMLDetailsElement;
  if (!details.open) { details.open = true; fireEvent(details, new dom.window.Event("toggle")); }
  fireEvent.click(await screen.findByLabelText(pageTitle, undefined, T));
}
async function answerAll(): Promise<number> {
  let n = 0;
  for (;;) {
    fireEvent.click(await screen.findByText("A1", undefined, T)); // sempre a 1ª alternativa: certa só em parte das questões
    fireEvent.click(screen.getByText("Confirmar resposta"));
    n += 1;
    const next = screen.queryByText("Próxima questão");
    if (next) { fireEvent.click(next); continue; }
    fireEvent.click(await screen.findByText("Ver resultado"));
    return n;
  }
}

test("fluxo completo: gerar → responder → persistir → pontos fracos → 2ª tentativa → evolução → histórico → copiar", async () => {
  render(<ReviewsPage />);
  await screen.findByRole("heading", { name: "Revisões" }, T);
  assert.ok(screen.getByText("Praticar") && screen.getByText(/Histórico/));

  /* 1) gerar quiz de 5 questões a partir da página */
  await openGenerator(/Farmacologia geral/);
  fireEvent.change(within(document.querySelector("details.rv-gen") as HTMLElement).getByLabelText("Quantidade"), { target: { value: "5" } });
  fireEvent.click(screen.getByText("Gerar e começar"));
  assert.equal(await answerAll(), 5);

  /* 2) relatório + persistência */
  await screen.findByText("RESULTADO DO QUIZ", undefined, T);
  assert.ok(screen.getByText("Revisar meus pontos fracos"));
  await waitFor(() => { assert.equal(db.review_attempts.length, 1); assert.equal(db.review_answers.length, 5); }, T);
  const first = db.review_attempts[0];
  assert.equal(first.user_id, uid);
  assert.deepEqual([first.total, first.kind, first.mode], [5, "original", "quiz"]);
  assert.deepEqual(first.source_page_ids, ["aaaaaaaa-0000-4000-8000-000000000001"]); // origem guardada para consultar o material de novo
  assert.ok(first.name.startsWith("Quiz — Farmacologia geral"));
  assert.ok(db.review_answers.every((a: { user_id: string; attempt_id: string }) => a.user_id === uid && a.attempt_id === first.id));
  assert.equal(first.correct + first.wrong, 5);
  assert.ok(first.wrong >= 1, "o teste precisa de ao menos um erro");
  assert.equal(db.study_cards.filter((c: { user_id: string }) => c.user_id === uid).length >= 5, true);

  /* 3) Revisar meus pontos fracos → nova atividade só com os assuntos errados */
  fireEvent.click(screen.getByText("Revisar meus pontos fracos"));
  fireEvent.click(screen.getByRole("radio", { name: "5" }));
  fireEvent.click(screen.getByText("Gerar 5 questões"));
  assert.equal(await answerAll(), 5);
  await screen.findByText("RESULTADO DO QUIZ", undefined, T);
  await waitFor(() => assert.equal(db.review_attempts.length, 2), T);
  const second = db.review_attempts[1];
  assert.equal(second.kind, "focused");
  assert.equal(second.parent_attempt_id, first.id, "a revisão direcionada precisa apontar para a atividade de origem");
  assert.equal(second.user_id, uid);
  assert.ok([1, 2, 3].includes(second.difficulty));
  assert.ok(second.focus_topics.length >= 1);
  assert.ok(second.name.startsWith("Pontos fracos"));
  assert.ok(second.source_page_ids.length === 1);
  await waitFor(() => assert.equal(db.review_answers.length, 10), T);
  // as perguntas novas não repetem as da primeira atividade
  const firstQs = new Set(first.report.answers.map((a: { question: string }) => a.question));
  assert.ok(second.report.answers.every((a: { question: string }) => !firstQs.has(a.question)), "repetiu perguntas");
  // só assuntos fracos
  const weakTopics = new Set(second.focus_topics);
  assert.ok(second.report.answers.every((a: { topic: string }) => weakTopics.has(a.topic)));
  assert.ok(screen.getByText(/Pontos fracos · nível/));

  /* 4) evolução entre a 1ª e a 2ª tentativa */
  await waitFor(() => assert.ok(screen.getByText("Evolução por assunto")), T);
  assert.match(document.body.textContent ?? "", /\d+% → \d+%/);

  /* 5) histórico */
  fireEvent.click(screen.getByText("Voltar às revisões"));
  fireEvent.click(await screen.findByText(/^Histórico/));
  await waitFor(() => assert.equal(document.querySelectorAll(".rh-row").length, 2), T);
  const hist = document.querySelector(".rv-list")!.textContent ?? "";
  for (const piece of ["Origem: Farmacologia geral", "Pontos fracos", "5 questões", "erros", "Quiz"]) assert.ok(hist.includes(piece), `histórico sem: ${piece}`);
  assert.ok(screen.getByText("Evolução por assunto"));
  // abrir uma atividade anterior mostra o relatório completo
  fireEvent.click(document.querySelectorAll(".rh-row")[1] as HTMLElement);
  await screen.findByText("RESULTADO DO QUIZ", undefined, T);
  assert.ok(screen.getByText(/Análise dos erros/));
  fireEvent.click(screen.getByText("Copiar relatório"));
  await waitFor(() => assert.ok(copied.includes("RELATÓRIO DE DESEMPENHO")), T);
  for (const piece of ["Aproveitamento:", "QUESTÕES ERRADAS", "Minha resposta:", "Gabarito:", "Explicação:", "DESEMPENHO POR ASSUNTO", "PLANO DE REVISÃO"]) assert.ok(copied.includes(piece), `texto copiado sem: ${piece}`);
  // do histórico também dá para reforçar os pontos fracos (usa a origem guardada)
  assert.ok(screen.getByText("Revisar meus pontos fracos"));
  cleanup();
});

test("a outra usuária não vê nada da Yasmim", () => {
  const others = [db.review_attempts, db.review_answers, db.study_cards].flatMap((t: { user_id: string }[]) => t.filter((r) => r.user_id === USERS["token-outra"]));
  assert.equal(others.length, 0);
});

test("IA lenta: a tela mostra mensagem clara, nunca 'Unexpected token … is not valid JSON'", async () => {
  render(<ReviewsPage />);
  await screen.findByRole("heading", { name: "Revisões" }, T);
  await openGenerator(/^SLOW/);
  fireEvent.click(screen.getByText("Gerar e começar"));
  const notice = await screen.findByText(/demorou/, undefined, { timeout: 12_000 });
  assert.ok(!/Unexpected token|not valid JSON/.test(document.body.textContent ?? ""));
  assert.match(notice.textContent ?? "", /\(ref\. [0-9a-f]{8}\)/); // código para achar o log no servidor
  cleanup();
});

test("banco sem a migração: o resultado continua na tela e o aviso explica o que rodar", async () => {
  const saved = db.review_answers;
  delete (db as Record<string, unknown>).review_answers;
  try {
    render(<ReviewsPage />);
    await screen.findByRole("heading", { name: "Revisões" }, T);
    await openGenerator(/Farmacologia geral/);
    fireEvent.change(within(document.querySelector("details.rv-gen") as HTMLElement).getByLabelText("Quantidade"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Gerar e começar"));
    await answerAll();
    await screen.findByText("RESULTADO DO QUIZ", undefined, T);
    await screen.findByText(/schema11\.sql/, undefined, T);
  } finally {
    (db as Record<string, unknown>).review_answers = saved;
    cleanup();
  }
});

test.afterEach(() => cleanup());
test.after(() => mocks.close());
