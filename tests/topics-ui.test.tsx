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
  if (request === "next/navigation") return { useParams: () => ({ id: SUBJECT }), useRouter: () => ({ push: (u: string) => { pushed.push(u); }, replace() {}, back() {} }) };
  return real.call(this, request, ...rest);
};

// jsdom não tem PointerEvent: versão mínima para o arrastar
(window as unknown as { PointerEvent: unknown }).PointerEvent = class extends (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
};
const pushed: string[] = [];

let Route: React.ComponentType;
const card = (name: string) => screen.getByText(name, { selector: "strong" }).closest("li[data-topic-card]") as HTMLElement;
const open = (name: string) => { const c = card(name); if (!within(c).queryByText(/Importar página/)) fireEvent.click(within(c).getByLabelText(`Expandir ${name}`)); return card(name); };
const menu = (name: string, item: string) => { fireEvent.click(within(card(name)).getByLabelText(`Mais ações para ${name}`)); fireEvent.click(screen.getByRole("menuitem", { name: item })); };
const topicRow = (name: string) => db.topics.find((x: { name: string }) => x.name === name);

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
  await importVia(() => within(open("Paracetamol")).getByText(/Importar página/), "toxic", "Toxicidade do paracetamol", "Vincular");
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  assert.equal(db.topic_pages.length, 1);
  assert.equal(pageRow(IDS.tox).parent_id, IDS.nbOut, "não saiu do caderno de origem");
  const body = open("Paracetamol");
  assert.match(body.textContent ?? "", /Toxicidade do paracetamol/);
  assert.match(body.textContent ?? "", /Outro caderno/, "mostra de qual caderno veio");
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
  await importVia(() => within(open("Paracetamol")).getByText(/Importar página/), "resumo", "Resumo de AINEs", "Transferir");
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /2 aulas e páginas/), W);
  assert.equal(pageRow(IDS.resumo).parent_id, IDS.nbDisc);
  assert.equal(db.topic_pages.length, 2);
  cleanup();
});

scene("importar de outro caderno com assunto novo", async () => {
  render(<Route />);
  await waitFor(() => assert.ok(screen.getByText("Paracetamol", { selector: "strong" })), W);
  await importVia(() => screen.getByText(/Importar de outro caderno/), "cox", "Inibidores de COX", "Vincular", "__novo__");
  await waitFor(() => assert.ok(screen.getByText("Inibidores de COX", { selector: "strong" })), W);
  await waitFor(() => assert.match(card("Inibidores de COX").textContent ?? "", /1 aula ou página/), W);
  assert.equal(db.topics.length, 2);
  cleanup();
});

scene("desvincular: tira do assunto, mas a página não é apagada", async () => {
  render(<Route />);
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /2 aulas e páginas/), W);
  fireEvent.click(await within(open("Paracetamol")).findByLabelText(/Tirar Toxicidade do paracetamol do assunto/, undefined, W));
  await waitFor(() => assert.match(card("Paracetamol").textContent ?? "", /1 aula ou página/), W);
  assert.ok(!db.topic_pages.some((l: { page_id: string; topic_id: string }) => l.page_id === IDS.tox && l.topic_id === "d0000000-0000-4000-8000-000000000001"));
  assert.ok(pageRow(IDS.tox), "a página continua existindo");
  cleanup();
});

scene("tocar no assunto com um só conteúdo abre direto no caderno", async () => {
  render(<Route />);
  await waitFor(() => assert.ok(card("Inibidores de COX")), W);
  await waitFor(() => assert.match(card("Inibidores de COX").textContent ?? "", /1 aula ou página/), W);
  pushed.length = 0;
  fireEvent.click(within(card("Inibidores de COX")).getByText("Inibidores de COX", { selector: "strong" }).closest("button")!);
  assert.deepEqual(pushed, [`/p/${IDS.cox}`]);
});

scene("subassunto: criar, subir/descer, tornar subassunto e tirar de dentro", async () => {
  const ask = (window as unknown as { prompt: (m: string) => string | null });
  const realPrompt = ask.prompt;
  ask.prompt = () => "Hepatotoxicidade";
  try {
    render(<Route />);
    await waitFor(() => assert.ok(card("Paracetamol")), W);
    fireEvent.click(within(open("Paracetamol")).getByText(/Subassunto/));
    await waitFor(() => assert.ok(card("Hepatotoxicidade")), W);
    assert.equal(topicRow("Hepatotoxicidade").parent_id, topicRow("Paracetamol").id);
    assert.match(card("Paracetamol").textContent ?? "", /1 subassunto/);

    // "Inibidores de COX" passa a ser subassunto de Paracetamol pelo menu
    menu("Inibidores de COX", "Tornar subassunto de…");
    fireEvent.click(await screen.findByText("Paracetamol", { selector: ".pm-text strong" }));
    await waitFor(() => assert.equal(topicRow("Inibidores de COX").parent_id, topicRow("Paracetamol").id), W);
    assert.equal(topicRow("Inibidores de COX").position, 1, "entra no fim da lista do pai");

    // descer/subir dentro do pai e tirar de dentro
    menu("Hepatotoxicidade", "Descer");
    await waitFor(() => assert.equal(topicRow("Hepatotoxicidade").position, 1), W);
    assert.equal(topicRow("Inibidores de COX").position, 0);
    menu("Inibidores de COX", "Tirar de dentro");
    await waitFor(() => assert.equal(topicRow("Inibidores de COX").parent_id, null), W);
    assert.equal(topicRow("Hepatotoxicidade").parent_id, topicRow("Paracetamol").id);
  } finally {
    ask.prompt = realPrompt;
  }
});

scene("arrastar pela alça: coloca um assunto dentro de outro e depois reordena", async () => {
  render(<Route />);
  await waitFor(() => assert.ok(card("Inibidores de COX")), W);
  // jsdom não tem layout: cada cabeçalho vira uma faixa de 100px, na ordem em que aparecem
  const EL = (window as unknown as { Element: typeof Element }).Element;
  const real = EL.prototype.getBoundingClientRect;
  EL.prototype.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    if (el.dataset?.topicHead !== undefined) {
      const i = Array.from(document.querySelectorAll("[data-topic-head]")).indexOf(el);
      return { top: i * 100, bottom: i * 100 + 80, left: 0, right: 300, width: 300, height: 80, x: 0, y: i * 100 } as DOMRect;
    }
    return real.call(this);
  };
  try {
    const heads = () => Array.from(document.querySelectorAll<HTMLElement>("[data-topic-head]")).map((h) => h.dataset.topicHead);
    const grip = within(card("Inibidores de COX")).getAllByLabelText("Arrastar Inibidores de COX")[0];
    const target = heads().indexOf(topicRow("Paracetamol").id);
    const midY = target * 100 + 40; // meio do cartão = "dentro"
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 0, button: 0 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: midY });
    await waitFor(() => assert.equal(document.querySelector(`[data-topic-head="${topicRow("Paracetamol").id}"]`)?.getAttribute("data-drop"), "inside"), W);
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: midY });
    await waitFor(() => assert.equal(topicRow("Inibidores de COX").parent_id, topicRow("Paracetamol").id), W);
    assert.equal(document.querySelector("[data-drop]"), null, "a marca de destino some ao soltar");
  } finally {
    EL.prototype.getBoundingClientRect = real;
  }
});
