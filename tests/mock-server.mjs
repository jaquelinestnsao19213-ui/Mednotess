// Servidores falsos para testar a rota /api/review sem chaves reais:
//  - 54321: Supabase (auth + pages + study_cards), com dados de 2 usuárias
//  - 54322: Anthropic (/v1/messages), que registra cada pedido e simula falhas conforme o título da página
import http from "node:http";

const SUPA = "http://127.0.0.1:54321";
export const USERS = { "token-yasmim": "11111111-1111-4111-8111-111111111111", "token-outra": "22222222-2222-4222-8222-222222222222" };
const doc = (text, pdfUrl) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...(pdfUrl ? [{ type: "fileCard", attrs: { url: pdfUrl, name: "aula.pdf" } }] : [])] });
const own = USERS["token-yasmim"], other = USERS["token-outra"];
const P = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const pages = [
  { id: P(1), user: own, title: "Farmacologia geral", content: doc("Farmacocinética: absorção, distribuição, metabolismo e excreção. O paracetamol é metabolizado no fígado.", `${SUPA}/storage/v1/object/public/files/${own}/aula.pdf`) },
  { id: P(2), user: own, title: "SLOW", content: doc("conteúdo lento") },
  { id: P(3), user: own, title: "HTML500", content: doc("conteúdo") },
  { id: P(4), user: own, title: "RATE", content: doc("conteúdo") },
  { id: P(5), user: own, title: "TRUNC", content: doc("conteúdo") },
  { id: P(6), user: own, title: "AUTH", content: doc("conteúdo") },
  { id: P(7), user: own, title: "Página vazia", content: doc("") },
  { id: P(8), user: own, title: "PDF alheio", content: doc("texto próprio", `${SUPA}/storage/v1/object/public/files/${other}/segredo.pdf`) },
  { id: P(9), user: other, title: "Página da outra usuária", content: doc("SEGREDO DA OUTRA USUÁRIA") },
];
const cards = [{ id: "cccccccc-0000-4000-8000-000000000001", user: own, page_id: P(1) }];

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const userOf = (req) => USERS[(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")] ?? null;

// mini PostgREST em memória: as tabelas guardam user_id e cada usuária só enxerga as próprias linhas (como o RLS)
export const db = {
  pages: pages.map(({ user, ...row }) => ({ ...row, user_id: user, type: "page", icon: null, updated_at: new Date().toISOString() })),
  study_cards: cards.map(({ user, ...row }) => ({ due_at: new Date().toISOString(), interval_days: 0, ease: 2.5, reps: 0, lapses: 0, last_reviewed_at: null, created_at: new Date().toISOString(), source_title: "Farmacologia geral", kind: "flashcard", question: "Cartão antigo?", answer: "Sim", explanation: null, options: null, correct_index: null, topic: "Farmacocinética", concept: null, option_notes: null, ...row, user_id: user })),
  review_attempts: [],
  review_answers: [],
  chat_conversations: [],
  chat_messages: [],
  subjects: [{ id: "bbbbbbbb-0000-4000-8000-000000000001", user_id: own, name: "Farmacologia", position: 0, notebook_page_id: null }],
  study_tasks: [],
  study_task_steps: [],
  topics: [],
  topic_pages: [],
};
// interruptores para simular um banco sem o schema12.sql (campo de notas e tabela de etapas)
export const flags = { noNotes: false, noSteps: false, noActions: false };
const DEFAULTS = { chat_conversations: () => ({ title: "Nova conversa", scope: "home", updated_at: new Date().toISOString() }), chat_messages: () => ({ attachments: null, actions: null }), study_tasks: () => ({ completed: false, notes: null, topic: null, subject_id: null }), study_task_steps: () => ({ completed: false, position: 0 }), study_cards: () => ({ due_at: new Date().toISOString(), interval_days: 0, ease: 2.5, reps: 0, lapses: 0, last_reviewed_at: null, source_title: "" }), review_attempts: () => ({ name: "", kind: "original" }), review_answers: () => ({}) };
const RESERVED = new Set(["select", "order", "limit", "offset", "columns"]);
const matches = (row, params) => [...params.entries()].every(([col, expr]) => {
  if (RESERVED.has(col)) return true;
  if (expr.startsWith("eq.")) return String(row[col]) === expr.slice(3);
  if (expr.startsWith("in.(")) return expr.slice(4, -1).split(",").includes(String(row[col]));
  if (expr.startsWith("gte.")) return String(row[col]) >= expr.slice(4);
  if (expr.startsWith("lte.")) return String(row[col]) <= expr.slice(4);
  if (expr === "is.null") return row[col] === null || row[col] === undefined;
  return true;
});
const project = (row, select) => {
  if (!select || select === "*") return row;
  const out = {};
  for (const c of select.split(",")) out[c.trim()] = row[c.trim()] ?? null;
  return out;
};
function rest(req, res, user, url, bodyText) {
  const table = url.pathname.replace("/rest/v1/", "");
  const rows = db[table];
  if (table === "study_task_steps" && flags.noSteps) return json(res, 404, { code: "PGRST205", message: "Could not find the table 'public.study_task_steps' in the schema cache" });
  if (table === "study_tasks" && flags.noNotes) {
    const asksNotes = (url.searchParams.get("select") ?? "").split(",").includes("notes");
    if (asksNotes) return json(res, 400, { code: "42703", message: "column study_tasks.notes does not exist" });
    if (req.method === "POST" || req.method === "PATCH") { if (bodyText.includes('"notes"')) return json(res, 400, { code: "PGRST204", message: "Could not find the 'notes' column of 'study_tasks' in the schema cache" }); }
  }
  if (table === "chat_messages" && flags.noActions) {
    if ((url.searchParams.get("select") ?? "").split(",").includes("actions")) return json(res, 400, { code: "42703", message: "column chat_messages.actions does not exist" });
    if (req.method === "POST" && bodyText.includes('"actions"')) return json(res, 400, { code: "PGRST204", message: "Could not find the 'actions' column of 'chat_messages' in the schema cache" });
  }
  if (!rows) return json(res, 404, { code: "PGRST205", message: `Could not find the table 'public.${table}'` });
  const select = url.searchParams.get("select");
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const out = (list) => (single ? (list[0] ? json(res, 200, list[0]) : json(res, 406, { code: "PGRST116", message: "0 rows" })) : json(res, 200, list));
  const mine = () => rows.filter((r) => r.user_id === user && matches(r, url.searchParams));
  if (req.method === "HEAD") { const n = mine().length; res.writeHead(200, { "content-range": `0-0/${n}`, "content-type": "application/json" }); return res.end(); }
  if (req.method === "GET") {
    let list = mine();
    const order = url.searchParams.get("order");
    if (order) { const [col, dir] = order.split("."); list = [...list].sort((x, y) => (String(x[col]) === String(y[col]) ? 0 : String(x[col]) < String(y[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
    const limit = Number(url.searchParams.get("limit")); if (limit) list = list.slice(0, limit);
    return out(list.map((r) => project(r, select)));
  }
  if (req.method === "POST") {
    const input = JSON.parse(bodyText || "[]");
    const created = (Array.isArray(input) ? input : [input]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...r, user_id: user }));
    rows.push(...created);
    return (req.headers.prefer ?? "").includes("return=representation") ? out(created.map((r) => project(r, select))) : (res.writeHead(201), res.end());
  }
  if (req.method === "PATCH") {
    const list = mine(); const patch = JSON.parse(bodyText); list.forEach((r) => Object.assign(r, patch));
    if ((req.headers.prefer ?? "").includes("return=representation")) return out(list.map((r) => project(r, select)));
    res.writeHead(204); return res.end();
  }
  if (req.method === "DELETE") {
    const list = mine(); for (const r of list) rows.splice(rows.indexOf(r), 1);
    if ((req.headers.prefer ?? "").includes("return=representation")) return out(list.map((r) => project(r, select)));
    res.writeHead(204); return res.end();
  }
  return json(res, 405, {});
}

export const anthropicRequests = [];

/* ---------- IA simulada do agente de planejamento (cenários escolhidos por marcadores na 1ª mensagem) ---------- */
const textBlocks = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(content ?? ""));
const message = (res, content, stop = "end_turn") => json(res, 200, { id: "msg_a", type: "message", role: "assistant", model: "x", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } });
const toolUse = (name, input, n) => ({ type: "tool_use", id: `toolu_${name}_${n}`, name, input });
const NOTES = "Primeiro parágrafo sobre COX-1 e COX-2.\n\nSegundo parágrafo sobre efeitos adversos.\n\n- item um\n- item dois";
const STEPS = ["Revisar COX-1 e COX-2", "Estudar os AINEs", "Comparar com os corticoides", "Resolver questões"];
const quatroBase = { title: "Farmacologia dos anti-inflamatórios", date: "2026-11-09", time_label: "Manhã", subject_name: "Farmacologia", notes: NOTES, steps: STEPS };

async function agent(res, body) {
  const msgs = body.messages;
  const isToolResult = (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");
  // o cenário vem da ÚLTIMA mensagem real da usuária (a conversa pode ter várias)
  let lastReal = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user" && !isToolResult(msgs[i])) { lastReal = i; break; }
  const first = textBlocks(msgs[lastReal].content);
  const last = msgs[msgs.length - 1];
  const lastText = textBlocks(last.content);
  const results = msgs.slice(lastReal + 1).filter(isToolResult);
  const step = results.length;
  const overview = () => { const r = results[0]?.content?.find((b) => b.type === "tool_result"); try { return JSON.parse(r.content); } catch { return null; } };
  const has = (m) => first.includes(m);
  const tag = first.match(/\[\[(\w+)\]\]/)?.[1] ?? "PADRAO";
  const quatro = { ...quatroBase, title: tag === "QUATRO" || tag === "DUPLICADA" ? quatroBase.title : `Farmacologia ${tag}` };

  if (has("[[ERRO401]]")) return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  if (has("[[LENTA]]")) { await new Promise((r) => setTimeout(r, 4000)); return message(res, [{ type: "text", text: "tarde demais" }]); }
  if (has("[[NADA]]")) return message(res, []);
  if (has("[[CORTADO]]")) {
    if (!lastText.includes("cortada por tamanho") && step === 0) return message(res, [], "max_tokens");
    if (step === 0) return message(res, [toolUse("add_study_tasks", { tasks: [{ ...quatro, title: "Lote menor", notes: "curta", steps: ["a", "b"] }] }, 1)], "tool_use");
    return message(res, [{ type: "text", text: "Criei em lote menor." }]);
  }
  if (has("[[ATUALIZAR]]")) {
    if (step === 0) return message(res, [toolUse("get_overview", {}, 0)], "tool_use");
    if (step === 1) { const t = overview()?.atividades?.[0]; return message(res, [toolUse("update_study_task", { id: t.id, notes: "Notas novas\n\ncom dois parágrafos", steps: [STEPS[0], "Etapa nova"] }, 1)], "tool_use"); }
    return message(res, [{ type: "text", text: "Atualizei a atividade." }]);
  }
  if (has("[[LOTE]]")) { // 3 atividades, uma com data inválida
    if (step === 0) return message(res, [toolUse("add_study_tasks", { tasks: [{ title: "A", date: "2026-11-10", time_label: "08:00" }, { title: "B", date: "segunda", time_label: "08:00" }, { title: "C", date: "2026-11-11", time_label: "Tarde", subject_name: "Inexistente" }] }, 1)], "tool_use");
    return message(res, [{ type: "text", text: "Feito." }]);
  }
  // cenários que criam a atividade das 4 etapas
  if (step === 0) return message(res, [toolUse("get_overview", {}, 0)], "tool_use");
  if (step === 1) return message(res, [toolUse("add_study_tasks", { tasks: [quatro] }, 1)], "tool_use");
  if (has("[[SEMTEXTO_TOTAL]]")) return message(res, []);
  if (has("[[SEMTEXTO_APOS]]")) return body.tool_choice?.type === "none" ? message(res, [{ type: "text", text: "Resumo pedido à IA." }]) : message(res, []);
  return message(res, [{ type: "text", text: "Criei a atividade com notas e 4 etapas." }]);
}


export function start() {
  const supa = http.createServer((req, res) => {
    const user = userOf(req);
    const url = new URL(req.url, SUPA);
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); return res.end(); }
    res.setHeader("access-control-allow-origin", "*");
    if (url.pathname === "/__flag") { for (const [k, v] of url.searchParams) flags[k] = v === "1"; return json(res, 200, flags); }
    if (url.pathname === "/auth/v1/user") return user ? json(res, 200, { id: user, aud: "authenticated", email: "x@y.z" }) : json(res, 401, { msg: "invalid" });
    if (!user) return json(res, 401, { message: "JWT" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { if (url.pathname.startsWith("/rest/v1/")) rest(req, res, user, url, body); else json(res, 404, { message: "não mockado" }); });
  });

  let counter = 0;
  const claude = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = JSON.parse(raw || "{}");
      anthropicRequests.push(body);
      if (body.tools) return agent(res, body);
      const content = body.messages?.[0]?.content;
      const text = Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(content ?? "");
      if (text.includes("Página: SLOW")) { await new Promise((r) => setTimeout(r, 4000)); }
      if (text.includes("Página: HTML500")) { res.writeHead(500, { "content-type": "text/html" }); return res.end("<html>An error occurred</html>"); }
      if (text.includes("Página: RATE")) return json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } });
      if (text.includes("Página: AUTH")) return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const reply = (t, stop = "end_turn") => json(res, 200, { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: t }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });

      if (body.system?.includes("plano de revisão")) return reply(JSON.stringify({ summary: "Resumo do plano.", priorities: [{ topic: "Metabolismo hepático", focus: "Rever." }], strengths: ["Farmacocinética"], redo: ["q"] }));

      const n = Number((text.match(/exatamente (\d+) itens/) ?? text.match(/Crie (\d+)/) ?? [0, 5])[1]);
      const question = text.includes('type "question"');
      const weakTopics = [...text.matchAll(/^- "([^"]+)" \(/gm)].map((m) => m[1]);
      const topics = weakTopics.length ? weakTopics : ["Farmacocinética", "Farmacodinâmica"];
      const items = Array.from({ length: n }, (_, i) => {
        counter += 1;
        const topic = topics[(counter + i) % topics.length];
        return question
          ? { type: "question", question: `Questão inédita ${counter} sobre ${topic}`, options: ["A1", "B2", "C3", "D4", "E5"], correctIndex: counter % 5, explanation: "Porque sim.", optionNotes: ["a", "b", "c", "d", "e"], concept: `Conceito ${topic}`, topic }
          : { type: "flashcard", question: `Cartão inédito ${counter} sobre ${topic}`, answer: "Resposta", explanation: "x", concept: `Conceito ${topic}`, topic };
      });
      if (text.includes("Página: TRUNC")) {
        const full = JSON.stringify({ message: "ok", cards: items });
        return reply(full.slice(0, Math.floor(full.length * 0.7)), "max_tokens");
      }
      return reply("```json\n" + JSON.stringify({ message: "ok", cards: items }) + "\n```");
    });
  });
  return new Promise((resolve) => supa.listen(54321, "127.0.0.1", () => claude.listen(54322, "127.0.0.1", () => resolve({ close: () => { supa.close(); claude.close(); } }))));
}

if (process.argv[1]?.endsWith("mock-server.mjs")) start().then(() => console.log("mocks no ar"));
