import { test } from "node:test";
import assert from "node:assert/strict";
import { ancestorIds, bringCandidates, canMoveTo, descendantIds, moveCandidates, pathLabel, reorderIds, searchCandidates, type TreePage } from "../lib/page-tree";

const P = (id: string, parent_id: string | null, type: TreePage["type"], title = id): TreePage => ({ id, title, icon: null, type, parent_id });
// Farmacologia(nb) > Paracetamol(lesson) > Toxicidade(page); Farmacologia > TBL(lesson); Outro(nb) > Sub(nb) > Aula(lesson)
const pages = [P("far", null, "notebook", "Farmacologia"), P("par", "far", "lesson", "Paracetamol"), P("tox", "par", "page", "Toxicidade"), P("tbl", "far", "lesson", "TBL"), P("out", null, "notebook", "Outro"), P("sub", "out", "notebook", "Sub"), P("aul", "sub", "lesson", "Aula")];
const get = (id: string) => pages.find((p) => p.id === id)!;

test("descendentes e ancestrais em qualquer nível", () => {
  assert.deepEqual([...descendantIds(pages, "far")].sort(), ["par", "tbl", "tox"]);
  assert.deepEqual(ancestorIds(pages, "tox"), ["par", "far"]);
  assert.equal(pathLabel(pages, "tox"), "Farmacologia / Paracetamol");
});

test("não deixa mover para dentro de si mesma nem do que ela contém (sem laços)", () => {
  assert.equal(canMoveTo(pages, get("far"), "far").ok, false);
  assert.equal(canMoveTo(pages, get("far"), "tox").ok, false);
  assert.equal(canMoveTo(pages, get("par"), "out").ok, true);
});

test("só cadernos vão para o início", () => {
  assert.equal(canMoveTo(pages, get("sub"), null).ok, true);
  assert.equal(canMoveTo(pages, get("par"), null).ok, false);
});

test("destinos: exclui a própria página e o que está dentro, marca onde já está", () => {
  const dest = moveCandidates(pages, get("par"));
  assert.ok(!dest.some((c) => c.id === "par" || c.id === "tox"));
  assert.equal(dest.find((c) => c.id === "far")?.disabled, "já está aqui");
  assert.equal(dest.find((c) => c.id === null), undefined, "aula não pode ir para o início");
  const nb = moveCandidates(pages, get("sub"));
  assert.ok(nb.some((c) => c.id === null && !c.disabled), "caderno aninhado pode virar principal");
});

test("trazer para cá: lista páginas de qualquer nível, menos ancestrais, a própria e as que já estão aqui", () => {
  const ids = bringCandidates(pages, "far").map((c) => c.id);
  assert.ok(ids.includes("tox"), "página de dentro de uma aula deve poder subir para o caderno");
  assert.ok(!ids.includes("par") && !ids.includes("tbl") && !ids.includes("far"));
  const root = bringCandidates(pages, null).map((c) => c.id);
  assert.deepEqual(root.sort(), ["sub"], "no início só cadernos aninhados");
  assert.equal(bringCandidates(pages, "far").find((c) => c.id === "tox")?.path, "Farmacologia / Paracetamol");
});

test("busca ignora acentos e maiúsculas e olha o caminho", () => {
  const all = bringCandidates(pages, "out");
  assert.deepEqual(searchCandidates(all, "TOXICIDADE").map((c) => c.id), ["tox"]);
  assert.deepEqual(searchCandidates(all, "farmaco").map((c) => c.id).sort(), ["far", "par", "tbl", "tox"]);
});

test("reordenar: sobe, desce e respeita os limites", () => {
  assert.deepEqual(reorderIds(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(reorderIds(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.equal(reorderIds(["a", "b", "c"], 0, -1), null);
  assert.equal(reorderIds(["a", "b", "c"], 2, 1), null);
});
