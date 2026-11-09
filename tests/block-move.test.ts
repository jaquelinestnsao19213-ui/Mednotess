import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { EditorState } from "@tiptap/pm/state";
import { alignFromX, boundaryNear, moveNodeTo } from "../lib/block-move";

const schema = getSchema([StarterKit, Image]);
const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const img = { type: "image", attrs: { src: "http://x/a.png" } };
const doc = (...c: unknown[]) => schema.nodeFromJSON({ type: "doc", content: c });
const kinds = (state: EditorState) => state.doc.content.content.map((n) => (n.type.name === "paragraph" ? n.textContent : n.type.name));
const posOf = (d: ReturnType<typeof doc>, name: string) => { let r = -1; d.forEach((n, o) => { if (n.type.name === name) r = o; }); return r; };

test("imagem: sobe e desce para qualquer lugar entre os blocos", () => {
  const state = EditorState.create({ doc: doc(para("A"), para("B"), img, para("C")), schema });
  const from = posOf(state.doc, "image");
  const toTop = boundaryNear(state.doc, 1, false, schema.nodes.image); // dentro do "A", metade de cima
  const up = moveNodeTo(state, from, toTop.at)!;
  assert.deepEqual(kinds(state.apply(up)), ["image", "A", "B", "C"]);
  const toEnd = boundaryNear(state.doc, state.doc.content.size - 2, true, schema.nodes.image); // depois do "C"
  const down = moveNodeTo(state, from, toEnd.at)!;
  assert.deepEqual(kinds(state.apply(down)), ["A", "B", "C", "image"]);
  const afterA = boundaryNear(state.doc, 1, true, schema.nodes.image); // depois do "A"
  assert.deepEqual(kinds(state.apply(moveNodeTo(state, from, afterA.at)!)), ["A", "image", "B", "C"]);
  const afterB = boundaryNear(state.doc, 4, true, schema.nodes.image); // logo antes da própria imagem: nada muda
  assert.equal(moveNodeTo(state, from, afterB.at), null);
});

test("imagem: soltar em cima de si mesma não faz nada", () => {
  const state = EditorState.create({ doc: doc(para("A"), img, para("B")), schema });
  const from = posOf(state.doc, "image");
  assert.equal(moveNodeTo(state, from, from), null);
  assert.equal(moveNodeTo(state, from, from + 1), null);
  assert.equal(moveNodeTo(state, 999, 0), null);
});

test("imagem: dentro de uma lista o encaixe sobe para fora do item (a imagem não entra como 1º filho)", () => {
  const list = { type: "bulletList", content: [{ type: "listItem", content: [para("item")] }] };
  const d = doc(list, para("fim"));
  const slot = boundaryNear(d, 4, false, schema.nodes.image); // dentro do texto do item, metade de cima
  assert.equal(slot.at, 0, "antes da lista inteira");
  const after = boundaryNear(d, 4, true, schema.nodes.image); // metade de baixo: cabe depois do parágrafo, dentro do item
  assert.ok(after.at > 0 && after.at < d.child(0).nodeSize, "dentro do item da lista, depois do parágrafo");
});

test("alinhamento pelo lugar onde soltou", () => {
  assert.equal(alignFromX(110, 100, 600), "left");
  assert.equal(alignFromX(400, 100, 600), "center");
  assert.equal(alignFromX(650, 100, 600), "right");
});
