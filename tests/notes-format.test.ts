import { test } from "node:test";
import assert from "node:assert/strict";
import { continueList, toggleLinePrefix, wrapSelection } from "../lib/notes-format";

test("negrito envolve e desfaz a seleção", () => {
  const a = wrapSelection("estudar fisiologia", 8, 18, "**");
  assert.equal(a.value, "estudar **fisiologia**");
  const b = wrapSelection(a.value, a.start, a.end, "**");
  assert.equal(b.value, "estudar fisiologia");
});

test("itálico não confunde com negrito", () => {
  const a = wrapSelection("**texto**", 2, 7, "*");
  assert.equal(a.value, "***texto***");
});

test("sem seleção, o cursor fica entre os marcadores", () => {
  const a = wrapSelection("ab", 1, 1, "**");
  assert.equal(a.value, "a****b");
  assert.equal(a.start, 3);
});

test("título e lista aplicam e desfazem por linha", () => {
  const t = toggleLinePrefix("Resumo", 0, 0, "h1");
  assert.equal(t.value, "# Resumo");
  assert.equal(toggleLinePrefix(t.value, 0, 0, "h1").value, "Resumo");
  const l = toggleLinePrefix("a\nb\nc", 0, 5, "ol");
  assert.equal(l.value, "1. a\n2. b\n3. c");
  assert.equal(toggleLinePrefix(l.value, 0, l.value.length, "ol").value, "a\nb\nc");
  assert.equal(toggleLinePrefix("# x", 0, 0, "ul").value, "- x");
});

test("Enter continua lista e encerra no item vazio", () => {
  const a = continueList("- um", 4)!;
  assert.equal(a.value, "- um\n- ");
  const b = continueList("1. um", 5)!;
  assert.equal(b.value, "1. um\n2. ");
  const c = continueList("- um\n- ", 7)!;
  assert.equal(c.value, "- um\n");
  assert.equal(continueList("texto", 5), null);
});
