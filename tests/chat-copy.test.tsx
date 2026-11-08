// Copiar mensagens (da usuária e da IA) pelo botão de cada balão.
import "./chat-ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import HomeChat from "../components/HomeChat";
import { db, start } from "./mock-server.mjs";

const own = "11111111-1111-4111-8111-111111111111";
const USER_TEXT = "Primeira linha\n\n### Título\n| Manhã | Oração | 10 min |";
const AI_TEXT = "**Pronto!** Criei a atividade.\n\n- etapa 1\n- etapa 2";
const copied: string[] = [];

test.before(async () => {
  await start();
  const id = crypto.randomUUID();
  db.chat_conversations.push({ id, user_id: own, title: "Copiar", scope: "planner", updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
  db.chat_messages.push(
    { id: crypto.randomUUID(), user_id: own, conversation_id: id, role: "user", content: USER_TEXT, attachments: null, actions: null, created_at: new Date(Date.now() + 1).toISOString() },
    { id: crypto.randomUUID(), user_id: own, conversation_id: id, role: "assistant", content: AI_TEXT, attachments: null, actions: null, created_at: new Date(Date.now() + 2).toISOString() },
  );
});

test("cada mensagem tem botão Copiar e copia o texto original, com quebras de linha", async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { copied.push(t); } }, configurable: true });
  render(<HomeChat scope="planner" />);
  await waitFor(() => assert.equal(screen.getAllByLabelText("Copiar mensagem").length, 2), { timeout: 10_000 });
  const [userBtn, aiBtn] = screen.getAllByLabelText("Copiar mensagem");
  fireEvent.click(userBtn);
  await waitFor(() => assert.equal(copied[0], USER_TEXT));
  assert.ok(screen.getByText("Copiado"));
  fireEvent.click(aiBtn);
  await waitFor(() => assert.equal(copied[1], AI_TEXT));
  cleanup();
});

test("sem a API de área de transferência usa o plano B (execCommand)", async () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  let used = "";
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = (cmd) => { used = cmd; return true; };
  render(<HomeChat scope="planner" />);
  await waitFor(() => assert.equal(screen.getAllByLabelText("Copiar mensagem").length, 2), { timeout: 10_000 });
  fireEvent.click(screen.getAllByLabelText("Copiar mensagem")[0]);
  await waitFor(() => assert.ok(screen.getByText("Copiado")));
  assert.equal(used, "copy");
  cleanup();
});

test.after(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50));
