// Teste de ponta a ponta da rota /api/chat (servidor Next real + Supabase e IA simulados).
// Uso: veja tests/run-e2e-chat.sh
import assert from "node:assert/strict";
import fs from "node:fs";
import { anthropicRequests, db, flags, start, USERS } from "./mock-server.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const own = USERS["token-yasmim"];
const other = USERS["token-outra"];
await start();
let passed = 0;

async function chat(text, { today = "2026-11-08", token = "token-yasmim", scope = "planner" } = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: [{ role: "user", content: text }], today, scope }),
  });
  const type = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  assert.ok(type.includes("application/json"), `resposta não é JSON (${res.status}): ${raw.slice(0, 80)}`);
  return { status: res.status, body: JSON.parse(raw) };
}
const mine = () => db.study_tasks.filter((t) => t.user_id === own);
const stepsOf = (id) => db.study_task_steps.filter((s) => s.task_id === id).sort((a, b) => a.position - b.position);
const toolResults = () => anthropicRequests.flatMap((r) => r.messages).filter((m) => m.role === "user" && Array.isArray(m.content)).flatMap((m) => m.content).filter((b) => b.type === "tool_result").map((b) => b.content);
async function t(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.message}`); process.exitCode = 1; }
}
const NOTES = "Primeiro parágrafo sobre COX-1 e COX-2.\n\nSegundo parágrafo sobre efeitos adversos.\n\n- item um\n- item dois";

await t("sem login: erro em JSON com etapa identificada", async () => {
  const { status, body } = await chat("oi", { token: null });
  assert.equal(status, 401);
  assert.equal(body.step, "autenticacao");
});

await t("Teste 3: cria atividade com notas de várias linhas e EXATAMENTE 4 etapas, verificadas no banco", async () => {
  const { status, body } = await chat("[[QUATRO]] Crie uma tarefa para estudar farmacologia dos anti-inflamatórios, com notas detalhadas e quatro etapas.");
  assert.equal(status, 200);
  assert.equal(body.changed, true);
  assert.ok(body.ref);
  assert.equal(body.actions.length, 1);
  const a = body.actions[0];
  assert.equal(a.type, "created");
  assert.equal(a.steps_total, 4);
  assert.equal(a.subject, "Farmacologia");
  assert.equal(a.notes_chars, NOTES.length);
  // o que está NO BANCO (não só na resposta)
  assert.equal(mine().length, 1);
  const row = mine()[0];
  assert.equal(row.notes, NOTES, "notas perderam parágrafos/quebras de linha");
  assert.equal(row.subject_id, "bbbbbbbb-0000-4000-8000-000000000001");
  const steps = stepsOf(row.id);
  assert.deepEqual(steps.map((s) => s.text), ["Revisar COX-1 e COX-2", "Estudar os AINEs", "Comparar com os corticoides", "Resolver questões"]);
  assert.deepEqual(steps.map((s) => s.position), [0, 1, 2, 3]);
  assert.ok(steps.every((s) => s.user_id === own && s.completed === false));
  const verified = JSON.parse(toolResults().at(-1));
  assert.equal(verified.verificado[0].ok, true);
  assert.equal(verified.verificado[0].etapas_salvas, 4);
});

await t("Teste 4: persistência — uma nova leitura pelo agente enxerga notas e etapas", async () => {
  const { status, body } = await chat("[[ATUALIZAR]] mostre", { today: "2026-11-10" });
  assert.equal(status, 200);
  const overview = JSON.parse(toolResults().filter((c) => c.includes('"periodo"')).at(-1));
  assert.equal(overview.atividades.length, 1);
  assert.equal(overview.atividades[0].tem_notas, true);
  assert.deepEqual(overview.atividades[0].etapas, { feitas: 0, total: 4 });
});

await t("atualizar: troca notas e etapas sem duplicar a tarefa e mantendo etapa já concluída", async () => {
  const id = mine()[0].id;
  stepsOf(id)[0].completed = true; // etapa 1 já concluída
  const { status, body } = await chat("[[ATUALIZAR]] mude as notas", { today: "2026-11-10" });
  assert.equal(status, 200);
  assert.equal(body.actions[0].type, "updated");
  assert.equal(mine().length, 1, "criou duplicata");
  assert.equal(mine()[0].notes, "Notas novas\n\ncom dois parágrafos");
  const steps = stepsOf(id);
  assert.deepEqual(steps.map((s) => s.text), ["Revisar COX-1 e COX-2", "Etapa nova"]);
  assert.equal(steps[0].completed, true, "perdeu o progresso da etapa mantida");
});

await t("sem duplicatas: pedir a mesma atividade de novo não cria outra", async () => {
  const before = mine().length;
  const { status, body } = await chat("[[DUPLICADA]] crie de novo");
  assert.equal(body.changed, false);
  assert.equal(mine().length, before);
  assert.ok(toolResults().at(-1).includes("ja_existiam"));
  assert.ok([200, 502].includes(status));
});

await t("lote misto: cria as válidas, recusa data inválida e avisa disciplina inexistente", async () => {
  const before = mine().length;
  const { status, body } = await chat("[[LOTE]] organize");
  assert.equal(status, 200);
  assert.equal(mine().length, before + 2);
  const res = JSON.parse(toolResults().at(-1));
  assert.equal(res.criadas, 2);
  assert.equal(res.recusadas.length, 1);
  assert.equal(res.sem_disciplina_vinculada.length, 1);
  assert.ok(mine().filter((x) => ["A", "C"].includes(x.title)).every((x) => x.subject_id === null));
  assert.ok(body.actions.length === 2);
});

await t("CAUSA DO ERRO ORIGINAL: IA cortada em max_tokens sem texto agora é refeita em lote menor (antes virava 'Não consegui concluir')", async () => {
  const before = anthropicRequests.length;
  const { status, body } = await chat("[[CORTADO]] organize minha semana inteira");
  assert.equal(status, 200);
  assert.equal(body.changed, true);
  assert.ok(!body.message.includes("Não consegui concluir"));
  assert.ok(mine().some((x) => x.title === "Lote menor"));
  const retry = anthropicRequests.slice(before)[1];
  assert.ok(JSON.stringify(retry.messages.at(-1)).includes("cortada por tamanho"), "não pediu lote menor");
});

await t("IA termina sem texto depois de salvar: pede resumo à IA", async () => {
  const { status, body } = await chat("[[SEMTEXTO_APOS]] crie");
  assert.equal(status, 200);
  assert.equal(body.message, "Resumo pedido à IA.");
  assert.equal(body.changed, true);
});

await t("IA termina sem texto mesmo no resumo: usamos resumo local só com o que foi verificado", async () => {
  const { status, body } = await chat("[[SEMTEXTO_TOTAL]] crie");
  assert.equal(status, 200);
  assert.match(body.message, /^Salvei no planejamento 1 atividade/);
  assert.match(body.message, /4 etapas/);
});

await t("IA sem texto e SEM alterações: erro explícito com etapa e ref (nunca mais 'Não consegui concluir' como se fosse resposta)", async () => {
  const before = mine().length;
  const { status, body } = await chat("[[NADA]] oi");
  assert.equal(status, 502);
  assert.equal(body.step, "sem_resposta");
  assert.ok(body.ref && body.error.length > 30);
  assert.equal(mine().length, before);
});

await t("erro 401 da IA vira mensagem sobre ANTHROPIC_API_KEY", async () => {
  const { status, body } = await chat("[[ERRO401]] oi");
  assert.equal(status, 503);
  assert.equal(body.step, "autenticacao_ia");
  assert.match(body.error, /ANTHROPIC_API_KEY/);
});

await t("IA lenta: responde JSON dentro do prazo (timeout identificado), sem texto cru da Vercel", async () => {
  const t0 = Date.now();
  const { status, body } = await chat("[[LENTA]] oi");
  assert.equal(status, 504);
  assert.equal(body.step, "tempo_esgotado");
  assert.ok(Date.now() - t0 < 3900, "passou do prazo configurado");
});

await t("banco SEM o campo de notas: salva a atividade, avisa que as notas não foram salvas (e não afirma sucesso)", async () => {
  await fetch("http://127.0.0.1:54321/__flag?noNotes=1");
  try {
    const { status, body } = await chat("[[SEMNOTAS]] crie");
    assert.equal(status, 200);
    const row = mine().find((x) => x.title === "Farmacologia SEMNOTAS");
    assert.ok(row, "atividade não foi criada");
    assert.ok(!row.notes);
    assert.equal(stepsOf(row.id).length, 4);
    const res = JSON.parse(toolResults().at(-1));
    assert.ok(res.avisos.some((a) => a.includes("NÃO foram salvas") && a.includes("schema12.sql")));
    assert.equal(body.actions[0].notes_chars, 0);
  } finally { await fetch("http://127.0.0.1:54321/__flag?noNotes=0"); }
});

await t("banco SEM a tabela de etapas: salva a atividade e avisa que as etapas não foram salvas", async () => {
  await fetch("http://127.0.0.1:54321/__flag?noSteps=1");
  try {
    const { status } = await chat("[[SEMETAPAS]] crie");
    assert.equal(status, 200);
    const row = mine().find((x) => x.title === "Farmacologia SEMETAPAS");
    assert.ok(row);
    assert.equal(db.study_task_steps.filter((s) => s.task_id === row.id).length, 0);
    const res = JSON.parse(toolResults().at(-1));
    assert.ok(res.avisos.some((a) => a.includes("etapas NÃO foram salvas")));
  } finally { await fetch("http://127.0.0.1:54321/__flag?noSteps=0"); }
});

await t("isolamento: a tarefa criada por outra usuária não aparece nem altera a da primeira", async () => {
  const before = mine().length;
  const { status } = await chat("[[QUATRO]] crie", { token: "token-outra" });
  assert.equal(status, 200);
  assert.equal(mine().length, before);
  assert.equal(db.study_tasks.filter((x) => x.user_id === other).length, 1);
});

await t("logs técnicos: mostram as etapas, mas nunca chave, token nem o texto das notas", async () => {
  const log = fs.readFileSync(process.env.SERVER_LOG ?? "/tmp/chat-server.log", "utf8");
  for (const step of ["request_start", "agent_start", "anthropic_response", "tool_result", "tasks_created", "task_updated", "truncated_retry", "agent_failed", "empty_final", "tool_db_error", "notes_column_missing", "done"]) assert.ok(log.includes(`"step":"${step}"`), `faltou o log ${step}`);
  assert.ok(!log.includes("token-yasmim") && !log.includes("teste-key") && !log.includes("COX-1"), "vazou dado sensível");
});

console.log(`\n${passed} testes passaram`);
process.exit(process.exitCode ?? 0);
