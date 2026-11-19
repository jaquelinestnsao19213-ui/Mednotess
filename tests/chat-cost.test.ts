import test from "node:test";
import assert from "node:assert/strict";
import { addCacheBreakpoints, HISTORY_LIMIT, MAX_TOKENS_LONG, MAX_TOKENS_SHORT, maxTokensFor, needsPdfs, trimHistory, wantsCards } from "../lib/server/chat-cost";

const u = (content: string) => ({ role: "user", content });

test("needsPdfs: só liga quando o pedido depende dos PDFs", () => {
  assert.equal(needsPdfs([u("O que é glicólise?")]), false);
  assert.equal(needsPdfs([u("Explique a ação da insulina")]), false);
  assert.equal(needsPdfs([u("Resuma a página")]), true);
  assert.equal(needsPdfs([u("Onde aparece COX-2?")]), true);
  assert.equal(needsPdfs([u("o que diz no PDF sobre dose?")]), true);
  assert.equal(needsPdfs([u("cite a página da tabela")]), true);
});

test("needsPdfs: continua ligado nas perguntas seguintes", () => {
  assert.equal(needsPdfs([u("resuma"), { role: "assistant", content: "ok" }, u("e a segunda parte?")]), true);
});

test("wantsCards e maxTokensFor", () => {
  assert.equal(wantsCards("Crie 5 flashcards"), true);
  assert.equal(wantsCards("Faça um quiz de farmacologia"), true);
  assert.equal(wantsCards("Questões sobre o SNA"), true);
  assert.equal(wantsCards("Explique a glicólise"), false);
  assert.equal(maxTokensFor("Explique a glicólise"), MAX_TOKENS_SHORT);
  assert.equal(maxTokensFor("Crie 10 flashcards"), MAX_TOKENS_LONG);
  assert.equal(maxTokensFor("Resuma para inserir na página"), MAX_TOKENS_LONG);
});

test("trimHistory: limita e sempre começa por mensagem da usuária", () => {
  const msgs = Array.from({ length: 15 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: String(i) }));
  const out = trimHistory(msgs);
  assert.ok(out.length <= HISTORY_LIMIT);
  assert.equal(out[0].role, "user");
  assert.equal(out[out.length - 1].content, "14");
  assert.equal(trimHistory(msgs.slice(0, 5)).length, 5);
});

test("addCacheBreakpoints: marca sistema e último bloco sem alterar o texto", () => {
  const out = addCacheBreakpoints({ model: "m", max_tokens: 10, system: "regras", messages: [{ role: "user", content: "oi" }] });
  const sys = out.system as { text: string; cache_control?: unknown }[];
  assert.equal(sys[0].text, "regras");
  assert.deepEqual(sys[0].cache_control, { type: "ephemeral" });
  const blocks = out.messages[0].content as { text: string; cache_control?: unknown }[];
  assert.equal(blocks[0].text, "oi");
  assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
});
