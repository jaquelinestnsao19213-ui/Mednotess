import test from "node:test";
import assert from "node:assert/strict";
import { countLabel, topicPageIds, transferCheck } from "../lib/topic-links";
import { linkCandidates, type TreePage } from "../lib/page-tree";

const link = (page_id: string, position: number) => ({ id: `l${page_id}`, topic_id: "t", page_id, position, created_at: "" });
const pg = (id: string, parent_id: string | null, type: TreePage["type"] = "page", title = id): TreePage => ({ id, title, icon: null, type, parent_id });

test("assunto: página principal primeiro, atalhos na ordem e sem repetir", () => {
  assert.deepEqual(topicPageIds({ page_id: "a" }, [link("c", 2), link("b", 1), link("a", 0)]), ["a", "b", "c"]);
  assert.deepEqual(topicPageIds({ page_id: null }, [link("x", 5), link("y", 1)]), ["y", "x"]);
  assert.deepEqual(topicPageIds({ page_id: null }, []), []);
});

test("assunto: texto da contagem", () => {
  assert.equal(countLabel(0), "Nenhuma aula ou página ainda");
  assert.equal(countLabel(1), "1 aula ou página");
  assert.equal(countLabel(4), "4 aulas e páginas");
});

test("transferir: só quando dá para mover para o caderno da disciplina", () => {
  const pages = [pg("nbA", null, "notebook"), pg("nbB", null, "notebook"), pg("aula", "nbA", "lesson"), pg("sub", "aula"), pg("naDisc", "nbB", "lesson")];
  assert.equal(transferCheck(pages, "aula", "nbB").ok, true);
  assert.equal(transferCheck(pages, "aula", null).ok, false); // disciplina sem caderno
  assert.match(transferCheck(pages, "naDisc", "nbB").reason ?? "", /já está no caderno/);
  assert.equal(transferCheck(pages, "nbB", "nbB").ok, false); // caderno dentro dele mesmo
  assert.equal(transferCheck(pages, "aula", "sub").ok, false); // destino está dentro do que seria movido
  assert.equal(transferCheck(pages, "nao-existe", "nbB").ok, false);
});

test("importar: qualquer página pode ser escolhida, menos as já vinculadas", () => {
  const pages = [pg("nbA", null, "notebook"), pg("aula", "nbA", "lesson", "Aula 1"), pg("pag", "aula", "page", "Resumo")];
  assert.deepEqual(linkCandidates(pages).map((c) => c.id), ["nbA", "aula", "pag"]);
  const out = linkCandidates(pages, ["aula"]);
  assert.deepEqual(out.map((c) => c.id), ["nbA", "pag"]);
  assert.equal(out[1].path, "nbA / Aula 1");
});
