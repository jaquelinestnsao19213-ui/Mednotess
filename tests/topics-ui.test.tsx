// Disciplina: importar páginas de outros cadernos para um assunto (vincular ou transferir).
// Requer: npm i --no-save jsdom @testing-library/react @testing-library/dom
// Rodar (direto com tsx, sem --test): UI_BACKEND=http://127.0.0.1:3100 npx tsx --tsconfig tests/tsconfig.json tests/topics-ui.test.tsx
import "./chat-ui-setup";
import Module from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { db, start } from "./mock-server.mjs";

const own = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "bbbbbbbb-0000-4000-8000-000000000001";
const IDS = { nbDisc: "e0000000-0000-4000-8000-000000000001", nbOut: "e0000000-0000-4000-8000-000000000002", tox: "e0000000-0000-4000-8000-000000000003", resumo: "e0000000-0000-4000-8000-000000000004", cox: "e0000000-0000-4000-8000-000000000005" };
const W = { timeout: 15_000 };
const now = new Date().toISOString();
let seq = 0;
const page = (id: string, parent_id: string | null, type: string, title: string) => ({ id, user_id: own, parent_id, type, title, icon: null, cover_url: null, content: null, props: {}, position: 0, created_at: new Date(Date.now() + ++seq).toISOString(), updated_at: now });
const pageRow = (id: string) => db.pages.find((p: { id: string }) => p.id === id);

// a página lê o id da disciplina pela rota do Next: aqui a rota é simulada
const real = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/navigation") return { useParams: () => ({ id: SUBJECT }), useRouter: () => ({ push() {}, replace() {}, back() {} }) };
  return real.call(this, request, ...rest);
};

let Route: React.ComponentType;
const card = (name: string) => screen.getByDisplayValue(name).closest("li") as HTMLElement;

async function importVia(opener: () => HTMLElement, search: string, option: string, mode: "Vincular" | "Transferir", topic?: string) {
  fireEvent.click(opener());
  const picker = await screen.findByRole("dialog", undefined, W);
  fireEvent.change(within(picker).getByLabelText("Buscar"), { target: { value: search } });
  fireEvent.click(await within(picker).findByText(option, undefined, W));
  await waitFor(() => assert.ok(screen.getByText(/Como importar/)), W);
  const dialog = screen.getByRole("dialog");
  if (topic) fireEvent.change(within(dialog).getByLabelText("Assunto"), { target: { value: topic } });
  fireEvent.click(within(dialog).getByLabelText(new RegExp(mode)));
  fireEvent.click(within(dialog).getByText("Importar"));
}

// cada cenário limpa a tela no fim, mesmo se falhar, para não sujar o próximo
const scene = (name: string, fn: () => Promise<void>) => test(name, async () => { try { await fn(); } finally { cleanup(); } });

test.before(async () => {
  await start();
  db.pages.push(page(IDS.nbDisc, null, "notebook", "Farmacologia"), page(IDS.nbOut, null, "notebook", "Outro caderno"), page(IDS.tox, IDS.nbOut, "lesson", "Toxicidade do paracetamol"), page(IDS.resumo, IDS.nbOut, "page", "Resumo de AINEs"), page(IDS.cox, IDS.nbOut, "page", "Inibidores de COX"));
  (db.subjects[0] as { notebook_page_id: string | null }).notebook_page_id = IDS.nbDisc;
  db.topics.push({ id: "d0000000-0000-4000-8000-000000000001", user_id: own, subject_id: SUBJECT, name: "Paracetamol", page_id: null, position: 0, created_at: now });
  Route = (await import("../app/disciplinas/[id]/page")).default;
});

scene("vincular: a página continua no caderno original e aparece no assunto", async () => {
  render(<Route />);
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /Nenhuma aula ou página ainda/), W);
  await importVia(() => within(card("Paracetamol")).getByText(/Importar página/), "toxic", "Toxicidade do paracetamol", "Vincular");
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  assert.equal(db.topic_pages.length, 1);
  assert.equal(pageRow(IDS.tox).parent_id, IDS.nbOut, "não saiu do caderno de origem");
  const rel = within(card("Paracetamol")).getByText("Conteúdos relacionados").closest("details") as HTMLElement;
  assert.match(rel.textContent ?? "", /Toxicidade do paracetamol/);
  assert.match(rel.textContent ?? "", /Outro caderno/, "mostra de qual caderno veio");
  cleanup();
});

scene("já vinculada: não duplica", async () => {
  render(<Route />);
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  // o botão do assunto já esconde o que está nele; pelo botão geral a página aparece e a repetição é barrada
  assert.equal(screen.queryByText("Toxicidade do paracetamol"), null);
  await importVia(() => screen.getByText(/Importar de outro caderno/), "toxic", "Toxicidade do paracetamol", "Vincular", "d0000000-0000-4000-8000-000000000001");
  await waitFor(() => assert.ok(screen.getByText(/já está neste assunto/)), W);
  assert.equal(db.topic_pages.length, 1);
  cleanup();
});

scene("transferir: a página vai para o caderno da disciplina e fica ligada ao assunto", async () => {
  render(<Route />);
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  await importVia(() => within(card("Paracetamol")).getByText(/Importar página/), "resumo", "Resumo de AINEs", "Transferir");
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /2 aulas e páginas/), W);
  assert.equal(pageRow(IDS.resumo).parent_id, IDS.nbDisc);
  assert.equal(db.topic_pages.length, 2);
  cleanup();
});

scene("importar de outro caderno com assunto novo", async () => {
  render(<Route />);
  await waitFor(() => assert.ok(screen.getByDisplayValue("Paracetamol")), W);
  await importVia(() => screen.getByText(/Importar de outro caderno/), "cox", "Inibidores de COX", "Vincular", "__novo__");
  await waitFor(() => assert.ok(screen.getByDisplayValue("Inibidores de COX")), W);
  await waitFor(() => assert.match(card("Inibidores de COX").textContent ?? "", /1 aula ou página/), W);
  assert.equal(db.topics.length, 2);
  cleanup();
});

scene("desvincular: tira do assunto, mas a página não é apagada", async () => {
  render(<Route />);
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /2 aulas e páginas/), W);
  fireEvent.click(await within(card("Paracetamol")).findByLabelText(/Tirar Toxicidade do paracetamol do assunto/, undefined, W));
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  assert.ok(!db.topic_pages.some((l: { page_id: string; topic_id: string }) => l.page_id === IDS.tox && l.topic_id === "d0000000-0000-4000-8000-000000000001"));
  assert.ok(pageRow(IDS.tox), "a página continua existindo");
  cleanup();
});
