import test from "node:test";
import assert from "node:assert/strict";
import { applyDrop, canNest, childrenOf, cleanParents, diffTopics, dropZone, moveTopic, nestTargets, shiftTopic, unnestTopic } from "../lib/topic-tree";
import type { Topic } from "../lib/types";

let n = 0;
const t = (id: string, position: number, parent_id: string | null = null): Topic => ({ id, subject_id: "s", name: id, page_id: null, position, created_at: `2026-01-01T00:00:${String(++n).padStart(2, "0")}Z`, parent_id });
const names = (list: Topic[], parent: string | null) => childrenOf(list, parent).map((x) => x.id);
// A, B(b1, b2), C, D
const base = () => [t("A", 0), t("B", 1), t("b1", 0, "B"), t("b2", 1, "B"), t("C", 2), t("D", 3)];

test("árvore: ordem por posição e dados com defeito viram assunto principal", () => {
  assert.deepEqual(names(base(), null), ["A", "B", "C", "D"]);
  assert.deepEqual(names(base(), "B"), ["b1", "b2"]);
  const bad = cleanParents([t("A", 0), t("x", 1, "fantasma"), t("y", 2, "y"), t("z", 3, "b"), t("b", 4, "A")]);
  assert.deepEqual(bad.map((x) => x.parent_id ?? null), [null, null, null, null, "A"].map((v, i) => (i === 3 ? null : v)));
});

test("aninhar: só 2 níveis e só quem não tem subassuntos", () => {
  const l = base();
  assert.equal(canNest(l, "A", "C").ok, true);
  assert.equal(canNest(l, "A", "A").ok, false);
  assert.equal(canNest(l, "A", "b1").ok, false, "subassunto não recebe outro nível");
  assert.equal(canNest(l, "B", "C").ok, false, "B já tem subassuntos");
  assert.equal(canNest(l, "A", "nao-existe").ok, false);
  assert.deepEqual(nestTargets(l, "A").map((x) => x.id), ["B", "C", "D"]);
  assert.deepEqual(nestTargets(l, "B").map((x) => x.id), [], "B não pode virar subassunto de ninguém");
});

test("subir e descer trocam com o vizinho e param no limite", () => {
  const down = shiftTopic(base(), "A", 1)!;
  assert.deepEqual(names(down, null), ["B", "A", "C", "D"]);
  assert.equal(shiftTopic(base(), "A", -1), null);
  assert.equal(shiftTopic(base(), "D", 1), null);
  assert.deepEqual(names(shiftTopic(base(), "b2", -1)!, "B"), ["b2", "b1"]);
  assert.equal(shiftTopic(base(), "b1", -1), null);
});

test("virar subassunto e sair de dentro: renumera os dois grupos", () => {
  const nested = moveTopic(base(), "A", "C", 0)!;
  assert.deepEqual(names(nested, null), ["B", "C", "D"]);
  assert.deepEqual(childrenOf(nested, null).map((x) => x.position), [0, 1, 2]);
  assert.deepEqual(names(nested, "C"), ["A"]);
  const out = unnestTopic(base(), "b1")!;
  assert.deepEqual(names(out, null), ["A", "B", "b1", "C", "D"]);
  assert.deepEqual(names(out, "B"), ["b2"]);
  assert.equal(unnestTopic(base(), "A"), null);
});

test("arrastar: antes, depois e dentro; destinos inválidos são recusados", () => {
  assert.deepEqual(names(applyDrop(base(), "D", "A", "before")!, null), ["D", "A", "B", "C"]);
  assert.deepEqual(names(applyDrop(base(), "A", "C", "after")!, null), ["B", "C", "A", "D"]);
  assert.deepEqual(names(applyDrop(base(), "D", "B", "inside")!, "B"), ["b1", "b2", "D"]);
  assert.deepEqual(names(applyDrop(base(), "A", "b1", "before")!, "B"), ["A", "b1", "b2"], "soltar ao lado de um subassunto vira subassunto");
  assert.equal(applyDrop(base(), "A", "b1", "inside"), null, "subassunto não recebe filhos");
  assert.equal(applyDrop(base(), "B", "C", "inside"), null, "B tem subassuntos");
  assert.equal(applyDrop(base(), "A", "A", "before"), null);
  assert.deepEqual(names(applyDrop(base(), "b1", "A", "before")!, null), ["b1", "A", "B", "C", "D"], "subassunto arrastado para fora vira principal");
});

test("zona do toque: bordas e meio", () => {
  assert.equal(dropZone(100, 200, 90), "before");
  assert.equal(dropZone(100, 200, 110), "before");
  assert.equal(dropZone(100, 200, 150), "inside");
  assert.equal(dropZone(100, 200, 190), "after");
  assert.equal(dropZone(100, 200, 260), "after");
});

test("o que gravar: só o que mudou", () => {
  const l = base();
  assert.deepEqual(diffTopics(l, l), []);
  const ch = diffTopics(l, shiftTopic(l, "A", 1)!);
  assert.deepEqual(ch.map((c) => [c.id, c.patch]), [["A", { position: 1 }], ["B", { position: 0 }]], "só posição: funciona mesmo sem o schema16");
  const nest = diffTopics(l, moveTopic(l, "D", "C", 0)!);
  assert.deepEqual(nest.find((c) => c.id === "D")?.patch, { position: 0, parent_id: "C" });
});
