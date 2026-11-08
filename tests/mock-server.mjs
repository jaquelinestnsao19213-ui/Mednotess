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
};
const DEFAULTS = { study_cards: () => ({ due_at: new Date().toISOString(), interval_days: 0, ease: 2.5, reps: 0, lapses: 0, last_reviewed_at: null, source_title: "" }), review_attempts: () => ({ name: "", kind: "original" }), review_answers: () => ({}) };
const RESERVED = new Set(["select", "order", "limit", "offset", "columns"]);
const matches = (row, params) => [...params.entries()].every(([col, expr]) => {
  if (RESERVED.has(col)) return true;
  if (expr.startsWith("eq.")) return String(row[col]) === expr.slice(3);
  if (expr.startsWith("in.(")) return expr.slice(4, -1).split(",").includes(String(row[col]));
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
  if (!rows) return json(res, 404, { code: "PGRST205", message: `Could not find the table 'public.${table}'` });
  const select = url.searchParams.get("select");
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const out = (list) => (single ? (list[0] ? json(res, 200, list[0]) : json(res, 406, { code: "PGRST116", message: "0 rows" })) : json(res, 200, list));
  const mine = () => rows.filter((r) => r.user_id === user && matches(r, url.searchParams));
  if (req.method === "GET") {
    let list = mine();
    const order = url.searchParams.get("order");
    if (order) { const [col, dir] = order.split("."); list = [...list].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
    const limit = Number(url.searchParams.get("limit")); if (limit) list = list.slice(0, limit);
    return out(list.map((r) => project(r, select)));
  }
  if (req.method === "POST") {
    const input = JSON.parse(bodyText || "[]");
    const created = (Array.isArray(input) ? input : [input]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...r, user_id: user }));
    rows.push(...created);
    return (req.headers.prefer ?? "").includes("return=representation") ? out(created.map((r) => project(r, select))) : (res.writeHead(201), res.end());
  }
  if (req.method === "PATCH") { const list = mine(); const patch = JSON.parse(bodyText); list.forEach((r) => Object.assign(r, patch)); res.writeHead(204); return res.end(); }
  if (req.method === "DELETE") { for (const r of mine()) rows.splice(rows.indexOf(r), 1); res.writeHead(204); return res.end(); }
  return json(res, 405, {});
}

export const anthropicRequests = [];

export function start() {
  const supa = http.createServer((req, res) => {
    const user = userOf(req);
    const url = new URL(req.url, SUPA);
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); return res.end(); }
    res.setHeader("access-control-allow-origin", "*");
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
