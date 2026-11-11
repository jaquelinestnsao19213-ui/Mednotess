import test from "node:test";
import assert from "node:assert/strict";
import {
  addChild, addNode, applyOps, canReparent, childrenOf, connectNodes, deleteEdges, deleteNodes, descendantsOf, hiddenIds, layoutTree,
  mergeGenerated, newRootDoc, normalizeDoc, parentOf, reparent, sizeOf, summarizeDoc, toggleCollapse, updateNodeData, type Generated, type MapDoc,
} from "../lib/mindmap";
import { excerptExists, sanitizeGenerated, sanitizeOps } from "../lib/mindmap-ai";

const GEN: Generated = {
  nodes: [
    { key: "aines", label: "AINEs", parentKey: null, color: "teal", detail: "Anti-inflamatórios não esteroidais" },
    { key: "cox", label: "Inibição da COX", parentKey: "aines", detail: "Bloqueia a ciclooxigenase" },
    { key: "pg", label: "Redução das prostaglandinas", parentKey: "cox" },
    { key: "efeitos", label: "Dor, febre e inflamação reduzidas", parentKey: "pg" },
    { key: "cox1", label: "COX-1", parentKey: "cox", pageId: "p1", excerpt: "COX-1 protege a mucosa gástrica" },
    { key: "cox2", label: "COX-2", parentKey: "cox" },
    { key: "renal", label: "Fluxo sanguíneo renal", parentKey: null, color: "blue", discipline: "Fisiologia" },
  ],
  links: [{ from: "pg", to: "renal", label: "vasodilatação renal" }],
};
const ids = (d: MapDoc) => d.nodes.map((n) => n.id);
const byLabel = (d: MapDoc, label: string) => d.nodes.find((n) => n.data.label === label)!;

test("gerar: cria hierarquia, conexão entre disciplinas e organiza sem sobreposição", () => {
  const { doc, report } = mergeGenerated(newRootDoc("x") && { ...newRootDoc("x"), nodes: [] }, GEN);
  assert.equal(report.addedNodes, 7);
  assert.equal(doc.edges.filter((e) => e.kind === "tree").length, 5);
  assert.equal(doc.edges.filter((e) => e.kind === "link").length, 1);
  assert.equal(parentOf(doc, byLabel(doc, "COX-1").id), byLabel(doc, "Inibição da COX").id);
  assert.equal(byLabel(doc, "COX-1").data.pageId, "p1");
  // nenhum retângulo se sobrepõe
  const boxes = doc.nodes.map((n) => ({ id: n.id, ...n, ...sizeOf(n) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(overlap, false, `${a.data.label} sobrepõe ${b.data.label}`);
  }
});

test("atualizar com a IA preserva edições manuais e não duplica", () => {
  let { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  const cox = byLabel(doc, "Inibição da COX");
  doc = updateNodeData(doc, cox.id, { label: "Inibição da ciclo-oxigenase (meu texto)" });
  doc = { ...doc, nodes: doc.nodes.map((n) => (n.id === cox.id ? { ...n, x: 999, y: 888 } : n)) };
  const manual = addChild(doc, byLabel(doc, "AINEs").id, "Minha observação");
  doc = manual.doc;
  const again = mergeGenerated(doc, { ...GEN, nodes: GEN.nodes.map((n) => (n.key === "cox" ? { ...n, label: "Outro nome da IA", detail: "texto novo da IA" } : n)).concat([{ key: "novo", label: "Efeitos adversos", parentKey: "aines" }]) });
  const kept = again.doc.nodes.find((n) => n.id === cox.id)!;
  assert.equal(kept.data.label, "Inibição da ciclo-oxigenase (meu texto)");
  assert.equal(kept.data.detail, "Bloqueia a ciclooxigenase");
  assert.equal([kept.x, kept.y].join(), "999,888");
  assert.ok(again.doc.nodes.some((n) => n.id === manual.id), "nó manual continua");
  assert.equal(again.report.addedNodes, 1);
  assert.equal(again.doc.nodes.filter((n) => n.data.label === "COX-1").length, 1, "sem duplicar");
  assert.equal(again.report.keptEdited, 1);
});

test("o que a usuária excluiu não volta na próxima atualização", () => {
  let { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  doc = deleteNodes(doc, [byLabel(doc, "COX-2").id]);
  const link = doc.edges.find((e) => e.kind === "link")!;
  doc = deleteEdges(doc, [link.id]);
  const again = mergeGenerated(doc, GEN);
  assert.equal(again.doc.nodes.some((n) => n.data.label === "COX-2"), false);
  assert.equal(again.doc.edges.some((e) => e.kind === "link"), false);
});

test("excluir um nó mantém os filhos (sobem para o pai); excluir ramo apaga tudo", () => {
  const { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  const cox = byLabel(doc, "Inibição da COX"), aines = byLabel(doc, "AINEs");
  const keep = deleteNodes(doc, [cox.id]);
  assert.equal(keep.nodes.length, 6);
  assert.equal(parentOf(keep, byLabel(keep, "COX-1").id), aines.id);
  assert.equal(parentOf(keep, byLabel(keep, "Redução das prostaglandinas").id), aines.id);
  const branch = deleteNodes(doc, [cox.id], true);
  assert.deepEqual(branch.nodes.map((n) => n.data.label).sort(), ["AINEs", "Fluxo sanguíneo renal"]);
});

test("reorganizar hierarquia: não deixa criar laço", () => {
  const { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  const aines = byLabel(doc, "AINEs"), pg = byLabel(doc, "Redução das prostaglandinas"), renal = byLabel(doc, "Fluxo sanguíneo renal");
  assert.equal(canReparent(doc, aines.id, pg.id).ok, false);
  assert.equal(reparent(doc, aines.id, pg.id), doc);
  const moved = reparent(doc, pg.id, renal.id);
  assert.equal(parentOf(moved, pg.id), renal.id);
  assert.ok(descendantsOf(moved, renal.id).has(byLabel(doc, "Dor, febre e inflamação reduzidas").id));
});

test("recolher esconde o ramo; conectar evita duplicata e laço consigo mesmo", () => {
  const { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  const cox = byLabel(doc, "Inibição da COX");
  const collapsed = toggleCollapse(doc, cox.id);
  assert.equal(hiddenIds(collapsed).size, 4);
  assert.equal(hiddenIds(toggleCollapse(collapsed, cox.id)).size, 0);
  const a = byLabel(doc, "COX-1").id, b = byLabel(doc, "COX-2").id;
  const first = connectNodes(doc, a, b);
  assert.ok(first.id);
  assert.equal(connectNodes(first.doc, b, a).id, null, "já existe conexão");
  assert.equal(connectNodes(doc, a, a).id, null);
});

test("comandos da IA: acrescentam e ligam ao que existe, sem excluir nada", () => {
  const { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  const aines = byLabel(doc, "AINEs").id, renal = byLabel(doc, "Fluxo sanguíneo renal").id;
  const res = applyOps(doc, [
    { op: "add_node", ref: "adv", label: "Efeitos adversos", parent: aines, inferred: true },
    { op: "add_node", label: "Lesão renal", parent: "adv" },
    { op: "add_edge", from: "adv", to: renal, label: "reduz perfusão" },
    { op: "update_node", id: aines, detail: "Nova observação" },
    { op: "add_edge", from: "nao-existe", to: aines },
  ]);
  assert.equal(res.report.addedNodes, 2);
  assert.equal(res.report.skipped, 1);
  assert.equal(res.doc.nodes.length, doc.nodes.length + 2);
  assert.equal(parentOf(res.doc, byLabel(res.doc, "Lesão renal").id), byLabel(res.doc, "Efeitos adversos").id);
  assert.equal(byLabel(res.doc, "AINEs").data.edited, true);
  assert.equal(byLabel(res.doc, "Efeitos adversos").data.inferred, true);
  assert.ok(summarizeDoc(res.doc).nodes.every((n) => typeof n.id === "string"));
});

test("salvar e recuperar: o documento sobrevive ao JSON do banco e dados quebrados não travam", () => {
  let { doc } = mergeGenerated({ ...newRootDoc("x"), nodes: [] }, GEN);
  doc = addNode(doc, "note", { x: 10, y: 20 }, { label: "Legenda", color: "yellow" }).doc;
  doc = addNode(doc, "image", { x: 30, y: 40 }, { imageUrl: "https://x/img.png", crop: { l: 0.1, t: 0, r: 0.2, b: 0 } }, { w: 200, h: 120 }).doc;
  doc = layoutTree(doc);
  const restored = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(doc)));
  const broken = normalizeDoc({ nodes: [{ id: "a", x: "oi", data: null }, { id: "a" }, 5], edges: [{ id: "e", source: "a", target: "zzz" }, { id: "e2", source: "a", target: "a" }], meta: { dismissed: [1, "x"] } });
  assert.equal(broken.nodes.length, 1);
  assert.equal(broken.edges.length, 0);
  assert.deepEqual(broken.meta.dismissed, ["x"]);
  assert.equal(normalizeDoc(null).nodes.length, 0);
  // dois pais para o mesmo nó: o segundo vira conexão solta
  const two = normalizeDoc({ nodes: ["a", "b", "c"].map((id) => ({ id, kind: "concept", x: 0, y: 0, data: { label: id, color: "teal" } })), edges: [{ id: "1", source: "a", target: "c", kind: "tree" }, { id: "2", source: "b", target: "c", kind: "tree" }, { id: "3", source: "c", target: "a", kind: "tree" }] });
  assert.deepEqual(two.edges.map((e) => e.kind), ["tree", "link", "link"]);
  assert.deepEqual(childrenOf(two, "a"), ["c"]);
  assert.equal(ids(restored).length, doc.nodes.length);
});

test("validação da IA: trecho inventado cai, laços e cores inválidas são corrigidos", () => {
  const pages = [{ id: "p1", title: "Farmaco", text: "Os AINEs inibem a COX.\n A COX-1 protege a mucosa gástrica e a COX-2 é induzida na inflamação." }];
  assert.equal(excerptExists(pages[0].text, "COX-1 protege a mucosa gástrica"), true);
  assert.equal(excerptExists(pages[0].text, "COX-1 causa hepatite fulminante"), false);
  const gen = sanitizeGenerated({
    nodes: [
      { key: "a", label: "A", parent: "b", color: "neon" },
      { key: "b", label: "B", parent: "a", pageId: "p1", excerpt: "COX-1 causa hepatite fulminante" },
      { key: "c", label: "C", parent: "fantasma", pageId: "p1", excerpt: "COX-1 protege a mucosa gástrica", inferred: true },
      { key: "a", label: "duplicada" },
      { label: "sem chave" },
    ],
    links: [{ from: "a", to: "c" }, { from: "a", to: "nao" }, { from: "c", to: "c" }],
  }, pages)!;
  assert.equal(gen.nodes.length, 3);
  assert.equal(gen.nodes.find((n) => n.key === "a")!.color, undefined);
  assert.equal(gen.nodes.filter((n) => n.parentKey).length, 1, "laço a↔b quebrado em uma das pontas");
  assert.equal(gen.nodes.find((n) => n.key === "b")!.excerpt, null);
  assert.equal(gen.nodes.find((n) => n.key === "b")!.pageId, "p1");
  assert.equal(gen.nodes.find((n) => n.key === "c")!.inferred, false, "com trecho real não é só sugestão");
  assert.equal(gen.links.length, 1);
  assert.equal(sanitizeGenerated(null, pages), null);
  const ops = sanitizeOps([
    { op: "delete_node", id: "n1" }, { op: "add_node", label: "X", ref: "x", parent: "n1" }, { op: "add_node", label: "Y", parent: "x" },
    { op: "add_edge", from: "x", to: "n1" }, { op: "add_edge", from: "x", to: "ghost" }, { op: "update_node", id: "ghost", label: "z" },
  ], { nodeIds: new Set(["n1"]), pages });
  assert.deepEqual(ops.map((o) => o.op), ["add_node", "add_node", "add_edge"]);
});

test("resposta da IA cortada no meio: aproveita os nós completos em vez de perder o mapa", async () => {
  const { parseMapJson, salvageArray } = await import("../lib/mindmap-ai");
  const cortada = '{"message":"Mapa de AINEs.","nodes":[{"key":"a","label":"AINEs","parent":null},{"key":"b","label":"COX","detail":"Inibe a \\"COX\\"; ok","parent":"a"},{"key":"c","label":"Prosta';
  assert.equal(salvageArray(cortada, "nodes").length, 2);
  const { data, salvaged } = parseMapJson(cortada);
  assert.equal(salvaged, true);
  assert.equal(data!.message, "Mapa de AINEs.");
  const gen = sanitizeGenerated(data, [])!;
  assert.deepEqual(gen.nodes.map((n) => n.key), ["a", "b"]);
  assert.equal(gen.nodes[1].detail, 'Inibe a "COX"; ok');
  // com cercas de Markdown e texto em volta, JSON inteiro
  const cercada = 'Claro!\n```json\n{"message":"ok","nodes":[{"key":"x","label":"X"}],"links":[]}\n```';
  assert.equal(parseMapJson(cercada).salvaged, false);
  assert.equal(sanitizeGenerated(parseMapJson(cercada).data, [])!.nodes.length, 1);
  // lixo total
  assert.equal(sanitizeGenerated(parseMapJson("desculpe, não consegui").data, []), null);
  // comandos (ops) cortados
  const ops = parseMapJson('{"message":"fiz","ops":[{"op":"add_node","label":"A"},{"op":"add_node","lab').data!;
  assert.equal((ops.ops as unknown[]).length, 1);
});

test("escolher um caderno inclui as aulas e páginas de dentro, sem repetir", async () => {
  const { expandToPages } = await import("../lib/mindmap-expand");
  const pg = (id: string, type: string, parent: string | null) => ({ id, title: id, icon: null, type, parent_id: parent }) as never;
  const pages = [pg("nb", "notebook", null), pg("l1", "lesson", "nb"), pg("p1", "page", "l1"), pg("l2", "lesson", "nb"), pg("t1", "task", "nb"), pg("outro", "notebook", null), pg("l3", "lesson", "outro")];
  const r = expandToPages(pages, ["nb", "l1"]);
  assert.deepEqual(r.ids.sort(), ["l1", "l2", "p1"]);
  assert.equal(r.fromContainers, 3);
  assert.equal(expandToPages(pages, ["outro"]).ids[0], "l3");
  const limited = expandToPages(pages, ["nb"], 2);
  assert.equal(limited.ids.length, 2);
  assert.equal(limited.truncated, true);
});

test("ligações entre disciplinas: só chaves reais, sem duplicata, sempre marcadas como sugestão", async () => {
  const { sanitizeLinks } = await import("../lib/mindmap-ai");
  const keys = new Set(["a", "b", "c"]);
  const links = sanitizeLinks([{ from: "a", to: "b", label: "leva a" }, { from: "b", to: "a" }, { from: "a", to: "zzz" }, { from: "c", to: "c" }, { from: "c", to: "a", label: "x".repeat(200) }], keys);
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.inferred === true));
  assert.equal(links[1].label!.length, 60);
});
