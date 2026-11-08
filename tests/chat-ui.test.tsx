// Teste de interface da assistente (jsdom) passando pela pilha inteira: componente -> /api/chat (servidor Next real)
// -> IA e Supabase simulados. Veja tests/run-chat-ui.sh.
import "./chat-ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import HomeChat from "../components/HomeChat";
import { db, start } from "./mock-server.mjs";

test.before(async () => { await start(); });
const own = "11111111-1111-4111-8111-111111111111";
const W = { timeout: 20_000 };
const realFetch = globalThis.fetch;
const sentBodies: { messages: { role: string; content: string }[] }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.endsWith("/api/chat") && init?.body) sentBodies.push(JSON.parse(String(init.body)));
  return realFetch(input, init);
}) as typeof fetch;

const textarea = () => screen.getByLabelText("Escreva sua mensagem") as HTMLTextAreaElement;
async function send(text: string) {
  fireEvent.change(textarea(), { target: { value: text } });
  fireEvent.click(screen.getByLabelText("Enviar mensagem"));
}
const thread = () => within(document.querySelector(".ac-messages") as HTMLElement);
const section = () => document.querySelector("section.ac") as HTMLElement;
const reset = () => { cleanup(); window.localStorage.removeItem("mednotes-assistant:planner"); };
const mine = () => db.chat_conversations.filter((c: { user_id: string }) => c.user_id === own);

test("Teste 1 — interface: expandir, minimizar, voltar ao normal, sem perder a conversa", async () => {
  reset();
  render(<HomeChat scope="planner" />);
  assert.ok(section().classList.contains("ac-inline"));
  await send("[[UI1]] organize minha semana");
  await waitFor(() => assert.ok(thread().getAllByText(/Criei a atividade com notas e 4 etapas\./).length >= 1), W);
  fireEvent.click(screen.getByLabelText("Ampliar para tela cheia"));
  assert.ok(section().classList.contains("ac-full"));
  assert.ok(screen.getByRole("dialog"));
  assert.equal(window.localStorage.getItem("mednotes-assistant:planner"), "full");
  assert.ok(thread().getByText("[[UI1]] organize minha semana"), "perdeu a mensagem ao expandir");
  fireEvent.click(screen.getByLabelText("Reduzir para o tamanho normal"));
  assert.ok(section().classList.contains("ac-inline"));
  fireEvent.click(screen.getByLabelText("Minimizar a assistente"));
  assert.ok(section().classList.contains("ac-bar"));
  fireEvent.click(screen.getByLabelText("Abrir a assistente"));
  assert.ok(thread().getByText("[[UI1]] organize minha semana"), "perdeu a mensagem ao minimizar");
  // Esc fecha a janela ampla
  fireEvent.click(screen.getByLabelText("Ampliar para tela cheia"));
  fireEvent.keyDown(window, { key: "Escape" });
  assert.ok(section().classList.contains("ac-inline"));
  // "fechar" (X) na janela ampla minimiza e a conversa continua ao reabrir
  fireEvent.click(screen.getByLabelText("Ampliar para tela cheia"));
  fireEvent.click(screen.getByLabelText("Fechar e minimizar a assistente"));
  assert.ok(section().classList.contains("ac-bar"));
  fireEvent.click(screen.getByLabelText("Abrir a assistente"));
  assert.ok(thread().getByText("[[UI1]] organize minha semana"));
});

test("Teste 2 — mensagem longa com vários parágrafos aparece inteira, sem corte", async () => {
  reset();
  render(<HomeChat scope="planner" />);
  const paragraphs = Array.from({ length: 8 }, (_, i) => `Parágrafo ${i + 1}: ${"meu objetivo é organizar a rotina com calma. ".repeat(12)}`);
  const long = `[[UI2]] ${paragraphs.join("\n\n")}\nFIM-DA-MENSAGEM`;
  await send(long);
  await waitFor(() => assert.ok(thread().getAllByText(/Criei a atividade com notas e 4 etapas\./).length >= 1), W);
  const bubble = [...document.querySelectorAll(".ac-msg.is-user .ac-usertext")].at(-1) as HTMLElement;
  assert.equal(bubble.textContent, long, "o texto exibido difere do enviado");
  assert.ok(bubble.textContent!.endsWith("FIM-DA-MENSAGEM"));
  assert.equal(sentBodies.at(-1)!.messages.at(-1)!.content, long, "a mensagem foi alterada no envio");
  const css = fs.readFileSync(`${process.cwd()}/app/home-chat.css`, "utf8");
  for (const cls of [".ac-usertext", ".ac-bubble"]) {
    const rule = css.split("\n").filter((l) => l.startsWith(`${cls} `) || l.startsWith(`${cls}{`)).join(" ");
    assert.ok(!/max-height|line-clamp|text-overflow|overflow:\s*hidden/.test(rule), `${cls} corta o texto`);
  }
  assert.match(css, /\.ac-usertext \{ white-space: pre-wrap/);
  assert.match(css, /\.ac-form textarea \{[^}]*max-height: 40vh/);
});

test("Teste 3/4 — pedir tarefa com notas e 4 etapas pelo chat: cartão na tela e dados no banco", async () => {
  reset();
  let changed = 0;
  render(<HomeChat scope="planner" onChanged={() => { changed += 1; }} />);
  await send("[[QUATRO]] Crie uma tarefa para estudar farmacologia dos anti-inflamatórios, com notas detalhadas de várias linhas e quatro etapas.");
  const card = await waitFor(() => { const el = document.querySelector(".ac-card") as HTMLElement; assert.ok(el); return el; }, W);
  assert.ok(within(card).getByText("Farmacologia dos anti-inflamatórios"));
  assert.ok(within(card).getByText("Criada"));
  assert.equal(card.querySelectorAll(".ac-card-steps li").length, 4);
  assert.ok(within(card).getByText("Comparar com os corticoides"));
  assert.match(card.textContent ?? "", /Primeiro parágrafo sobre COX-1/);
  assert.equal(changed, 1, "a tela de planejamento não foi avisada para recarregar");
  const task = db.study_tasks.find((t: { title: string }) => t.title === "Farmacologia dos anti-inflamatórios");
  assert.ok(task && task.notes.includes("\n\n"), "notas sem parágrafos no banco");
  assert.equal(db.study_task_steps.filter((s: { task_id: string }) => s.task_id === task.id).length, 4);
});

test("Teste 5 — conversas persistem: fechar e reabrir o app traz a conversa e o cartão de volta", async () => {
  cleanup(); // simula fechar o app (nada fica em memória)
  render(<HomeChat scope="planner" />);
  await thread().findByText(/Crie uma tarefa para estudar farmacologia/, undefined, W);
  await waitFor(() => assert.ok(document.querySelector(".ac-card")), W);
  assert.ok(screen.getAllByText(/4 etapas/).length > 0);
});

test("histórico: lista, destaca a aberta, nova conversa não apaga as anteriores, alterna sem perder mensagens", async () => {
  reset();
  render(<HomeChat scope="planner" />);
  await thread().findByText(/Crie uma tarefa para estudar farmacologia/, undefined, W);
  const before = mine().length;
  assert.ok(before >= 3);
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  const drawer = document.querySelector(".ac-drawer") as HTMLElement;
  assert.ok(drawer.classList.contains("is-open"));
  assert.ok(within(drawer).getByText("Nova conversa"));
  const items = drawer.querySelectorAll(".ac-conv");
  assert.equal(items.length, before);
  assert.equal(drawer.querySelectorAll(".ac-conv.is-active").length, 1);
  // nova conversa
  fireEvent.click(within(drawer).getByText("Nova conversa"));
  assert.ok(!drawer.classList.contains("is-open"));
  assert.ok(screen.getByText("Como posso ajudar sua rotina?"));
  await send("[[UI6]] segunda conversa");
  await waitFor(() => assert.ok(thread().getAllByText(/Criei a atividade com notas e 4 etapas\./).length >= 1), W);
  assert.equal(mine().length, before + 1, "nova conversa deveria somar, não substituir");
  // volta à conversa antiga
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  fireEvent.click(within(document.querySelector(".ac-drawer") as HTMLElement).getByText(/Crie uma tarefa para estudar farmacologia/));
  await thread().findByText(/Crie uma tarefa para estudar farmacologia dos anti-inflamatórios, com notas/, undefined, W);
  assert.ok(!thread().queryByText("[[UI6]] segunda conversa"));
  // e de novo à nova
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  fireEvent.click(within(document.querySelector(".ac-drawer") as HTMLElement).getByText("[[UI6]] segunda conversa"));
  await thread().findByText("[[UI6]] segunda conversa", undefined, W);
  assert.equal((document.querySelector(".ac-conv.is-active .ac-conv-open strong") as HTMLElement).textContent, "[[UI6]] segunda conversa");
});

test("renomear e excluir (com confirmação) uma conversa", async () => {
  reset();
  render(<HomeChat scope="planner" />);
  await thread().findByText("[[UI6]] segunda conversa", undefined, W);
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  fireEvent.click(screen.getByLabelText("Renomear [[UI6]] segunda conversa"));
  const input = screen.getByLabelText("Novo nome da conversa") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Plano da semana" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => assert.ok(mine().some((c: { title: string }) => c.title === "Plano da semana")), W);
  assert.ok(await screen.findByText("Plano da semana"));
  // excluir: primeiro pede confirmação; cancelar mantém
  const count = mine().length;
  fireEvent.click(screen.getByLabelText("Excluir Plano da semana"));
  assert.ok(screen.getByText("Excluir esta conversa?"));
  fireEvent.click(screen.getByText("Cancelar"));
  assert.equal(mine().length, count);
  fireEvent.click(screen.getByLabelText("Excluir Plano da semana"));
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  await waitFor(() => assert.equal(mine().length, count - 1), W);
  assert.ok(!mine().some((c: { title: string }) => c.title === "Plano da semana"));
  assert.ok(screen.getByText("Como posso ajudar sua rotina?"), "deveria voltar à tela de nova conversa");
});

test("Teste 6 — erros: mostram o motivo real, o código de referência e permitem tentar de novo (nada de 'Não consegui concluir')", async () => {
  reset();
  render(<HomeChat scope="planner" />);
  await send("[[ERRO401]] oi");
  const alert = await screen.findByRole("alert", undefined, W);
  assert.match(alert.textContent ?? "", /ANTHROPIC_API_KEY/);
  assert.match(alert.textContent ?? "", /\(ref\. \w{6}\)/);
  assert.ok(screen.getByText("Tentar de novo"));
  assert.ok(!screen.queryByText(/Não consegui concluir agora/));
  fireEvent.click(screen.getByText("Tentar de novo"));
  await waitFor(() => assert.ok(screen.getByRole("alert")), W);
  // IA sem resposta e sem alterações
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  fireEvent.click(within(document.querySelector(".ac-drawer") as HTMLElement).getByText("Nova conversa"));
  await send("[[NADA]] oi");
  const alert2 = await screen.findByRole("alert", undefined, W);
  assert.match(alert2.textContent ?? "", /terminou sem responder/);
});

test("Teste 6b — resposta que não é JSON (página de erro da Vercel) vira mensagem clara, não 'Unexpected token'", async () => {
  reset();
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    typeof input === "string" && input.endsWith("/api/chat") ? new Response("An error occurred with your deployment", { status: 500, headers: { "content-type": "text/plain" } }) : saved(input, init)) as typeof fetch;
  try {
    render(<HomeChat scope="planner" />);
    await send("oi");
    const alert = await screen.findByRole("alert", undefined, W);
    assert.ok(!/Unexpected token|JSON/.test(alert.textContent ?? ""));
    assert.match(alert.textContent ?? "", /servidor/);
  } finally { globalThis.fetch = saved; }
});

test("histórico antigo: a falsa resposta 'Não consegui concluir' não é reenviada à IA", async () => {
  reset();
  const conv = { id: crypto.randomUUID(), user_id: own, title: "Conversa antiga", scope: "planner", updated_at: new Date(Date.now() + 60_000).toISOString(), created_at: new Date().toISOString() };
  db.chat_conversations.push(conv);
  const t = (n: number) => new Date(Date.now() + n).toISOString();
  db.chat_messages.push(
    { id: crypto.randomUUID(), user_id: own, conversation_id: conv.id, role: "user", content: "primeiro pedido", attachments: null, actions: null, created_at: t(1) },
    { id: crypto.randomUUID(), user_id: own, conversation_id: conv.id, role: "assistant", content: "Não consegui concluir agora. Tente novamente.", attachments: null, actions: null, created_at: t(2) },
  );
  render(<HomeChat scope="planner" />);
  await thread().findByText("primeiro pedido", undefined, W);
  await send("[[UI8]] tente de novo");
  await waitFor(() => assert.ok(thread().getAllByText(/Criei a atividade com notas e 4 etapas\./).length >= 1), W);
  const body = sentBodies.at(-1)!;
  assert.ok(!body.messages.some((m) => m.content.includes("Não consegui concluir")), "reenviou a falha antiga à IA");
});

test("sem o schema13.sql (coluna 'actions'): a conversa continua sendo salva e reaberta, só sem o cartão", async () => {
  reset();
  await fetch("http://127.0.0.1:54321/__flag?noActions=1");
  try {
    render(<HomeChat scope="planner" />);
    fireEvent.click(screen.getByLabelText("Histórico de conversas"));
    fireEvent.click(within(document.querySelector(".ac-drawer") as HTMLElement).getByText("Nova conversa"));
    await send("[[UI9]] crie");
    await waitFor(() => assert.ok(document.querySelector(".ac-card")), W);
    const conv = mine().find((c: { title: string }) => c.title.includes("[[UI9]]"));
    assert.ok(conv, "conversa não foi criada");
    await waitFor(() => assert.equal(db.chat_messages.filter((m: { conversation_id: string }) => m.conversation_id === conv.id).length, 2), W);
    cleanup();
    render(<HomeChat scope="planner" />);
    await thread().findByText(/\[\[UI9\]\] crie/, undefined, W);
    await thread().findByText(/Criei a atividade com notas e 4 etapas\./, undefined, W);
  } finally { await fetch("http://127.0.0.1:54321/__flag?noActions=0"); }
});

test("'Ver no calendário' leva ao dia/atividade (e reduz a janela ampla)", async () => {
  reset();
  const opened: { id: string; date: string }[] = [];
  render(<HomeChat scope="planner" onOpenTask={(r) => opened.push(r)} />);
  fireEvent.click(screen.getByLabelText("Histórico de conversas"));
  fireEvent.click(within(document.querySelector(".ac-drawer") as HTMLElement).getByText("Nova conversa"));
  await send("[[UI11]] crie");
  await waitFor(() => assert.ok(document.querySelector(".ac-card")), W);
  fireEvent.click(screen.getByLabelText("Ampliar para tela cheia"));
  const open = await screen.findAllByText("Ver no calendário", undefined, W);
  fireEvent.click(open[0]);
  assert.equal(opened.length, 1);
  assert.match(opened[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(section().classList.contains("ac-inline"), "deveria reduzir a janela para mostrar o calendário");
});

test.after(() => { cleanup(); setTimeout(() => process.exit(process.exitCode ?? 0), 50); });
