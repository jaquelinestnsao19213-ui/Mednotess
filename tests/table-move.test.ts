import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { EditorState } from "@tiptap/pm/state";
import { boundaryNear, moveNodeTo, stepTarget, tableStartAt } from "../lib/block-move";

const schema = getSchema([StarterKit, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell]);
const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const cell = (t: string, colwidth?: number[]) => ({ type: "tableCell", attrs: colwidth ? { colwidth } : {}, content: [para(t)] });
const table = { type: "table", content: [{ type: "tableRow", content: [cell("a1", [120]), cell("a2", [200])] }, { type: "tableRow", content: [cell("b1"), cell("b2")] }] };
const doc = (...c: unknown[]) => schema.nodeFromJSON({ type: "doc", content: c });
const kinds = (s: EditorState) => s.doc.content.content.map((n) => (n.type.name === "paragraph" ? n.textContent : n.type.name));
const posOf = (d: ReturnType<typeof doc>, name: string) => { let r = -1; d.forEach((n, o) => { if (n.type.name === name) r = o; }); return r; };

test("tabela: sobe e desce entre parágrafos, sem perder linhas, células nem larguras", () => {
  const state = EditorState.create({ doc: doc(para("A"), para("B"), table, para("C")), schema });
  const from = posOf(state.doc, "table");
  const up = stepTarget(state.doc, from, -1)!;
  const moved = state.apply(moveNodeTo(state, from, up)!);
  assert.deepEqual(kinds(moved), ["A", "table", "B", "C"]);
  const t = moved.doc.child(1);
  assert.equal(t.childCount, 2);
  assert.equal(t.textContent, "a1a2b1b2");
  assert.deepEqual(t.child(0).child(0).attrs.colwidth, [120]);
  const down = stepTarget(moved.doc, posOf(moved.doc, "table"), 1)!;
  assert.deepEqual(kinds(moved.apply(moveNodeTo(moved, posOf(moved.doc, "table"), down)!)), ["A", "B", "table", "C"]);
});

test("tabela: nos extremos não há para onde ir; arrastar para o topo e o fim funciona", () => {
  const state = EditorState.create({ doc: doc(table, para("A"), para("B")), schema });
  assert.equal(stepTarget(state.doc, 0, -1), null);
  const end = boundaryNear(state.doc, state.doc.content.size - 2, true, schema.nodes.table);
  assert.deepEqual(kinds(state.apply(moveNodeTo(state, 0, end.at)!)), ["A", "B", "table"]);
  const top = boundaryNear(EditorState.create({ doc: doc(para("A"), table), schema }).doc, 1, false, schema.nodes.table);
  const s2 = EditorState.create({ doc: doc(para("A"), table), schema });
  assert.deepEqual(kinds(s2.apply(moveNodeTo(s2, posOf(s2.doc, "table"), top.at)!)), ["table", "A"]);
});

test("tabela: tableStartAt acha a tabela a partir de uma posição dentro de uma célula", () => {
  const d = doc(para("A"), table);
  const start = posOf(d, "table");
  assert.equal(tableStartAt(d, start + 5), start);
  assert.equal(tableStartAt(d, 1), null);
});
