import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStrokes, strokesToSvg } from "../lib/image-strokes";
import { fileExtension } from "../lib/upload-ext";

const ink = { id: "a", kind: "ink", tool: "pen", color: "#dc2626", width: 0.004, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.2] };
const ell = { id: "b", kind: "ellipse", color: "#2563eb", width: 0.004, cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1 };

test("desenho: aceita traços válidos e descarta lixo", () => {
  const out = normalizeStrokes([ink, ell, { kind: "ink" }, null, 3, { ...ink, id: "c", color: "red" }, { ...ink, id: "d", pts: [0.1] }, { ...ink, id: "e", pts: [0.1, NaN] }]);
  assert.deepEqual(out.map((i) => i.id), ["a", "b"]);
});

test("desenho: lê texto JSON e ignora texto quebrado ou que não é lista", () => {
  assert.equal(normalizeStrokes(JSON.stringify([ink])).length, 1);
  assert.deepEqual(normalizeStrokes("{não é json"), []);
  assert.deepEqual(normalizeStrokes({ a: 1 }), []);
  assert.deepEqual(normalizeStrokes(undefined), []);
});

test("desenho: SVG usa o tamanho real da imagem e marca-texto fica translúcido", () => {
  const svg = strokesToSvg([ink as never, { ...ink, id: "m", tool: "highlighter" } as never, ell as never], 1000, 500);
  assert.match(svg, /viewBox="0 0 1000 500"/);
  assert.match(svg, /<ellipse cx="500" cy="250" rx="200" ry="50"/);
  assert.match(svg, /stroke-opacity="0.4"/);
  assert.match(svg, /stroke-width="4"/);
});

test("upload: extensão vem do nome ou, para imagem colada sem nome, do tipo", () => {
  assert.equal(fileExtension({ name: "Foto.JPG", type: "image/jpeg" }), "jpg");
  assert.equal(fileExtension({ name: "image", type: "image/png" }), "png");
  assert.equal(fileExtension({ name: "", type: "image/webp" }), "webp");
  assert.equal(fileExtension({ name: "x", type: "" }), "bin");
});
