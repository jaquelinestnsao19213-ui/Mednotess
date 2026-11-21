import test from "node:test";
import assert from "node:assert/strict";
import { recognizeShape, snapStroke } from "../components/editor/ink-shapes";

const W = 1000;
const norm = (pts: [number, number][]) => pts.flatMap(([x, y]) => [x / W, y / W]);
const seg = (a: [number, number], b: [number, number], n = 30): [number, number][] =>
  Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const jit = (p: [number, number][]): [number, number][] => p.map(([x, y], i) => [x + Math.sin(i * 1.7) * 2, y + Math.cos(i * 2.3) * 2]);

test("linha quase horizontal vira linha horizontal", () => {
  const s = recognizeShape(norm(jit(seg([100, 200], [500, 210], 60))), W);
  assert.equal(s?.kind, "line");
  if (s?.kind === "line") assert.ok(Math.abs(s.a.y - s.b.y) < 0.01);
});

test("círculo", () => {
  const c = Array.from({ length: 80 }, (_, i): [number, number] => [300 + 100 * Math.cos((i / 80) * 2 * Math.PI * 1.03), 300 + 100 * Math.sin((i / 80) * 2 * Math.PI * 1.03)]);
  const s = recognizeShape(norm(jit(c)), W);
  assert.equal(s?.kind, "ellipse");
  if (s?.kind === "ellipse") assert.ok(Math.abs(s.rx - s.ry) < 0.01);
});

test("retângulo começando no meio de um lado", () => {
  const p = [...seg([300, 100], [500, 100]), ...seg([500, 100], [500, 250]), ...seg([500, 250], [100, 250], 50), ...seg([100, 250], [100, 100]), ...seg([100, 100], [300, 100])];
  const s = recognizeShape(norm(jit(p)), W);
  assert.equal(s?.kind, "poly");
  if (s?.kind === "poly") assert.equal(s.v.length, 4);
});

test("triângulo", () => {
  const p = [...seg([200, 300], [300, 120]), ...seg([300, 120], [400, 300]), ...seg([400, 300], [200, 300]), [200, 300] as [number, number]];
  const s = recognizeShape(norm(jit(p)), W);
  assert.equal(s?.kind, "poly");
  if (s?.kind === "poly") assert.equal(s.v.length, 3);
});

test("letra pequena e rabisco não viram forma", () => {
  const o = Array.from({ length: 30 }, (_, i): [number, number] => [10 * Math.cos((i / 30) * 6.3), 10 * Math.sin((i / 30) * 6.3)]);
  assert.equal(recognizeShape(norm(o), W), null);
  const zig = Array.from({ length: 60 }, (_, i): [number, number] => [100 + i * 4, 100 + (i % 2) * 60]);
  assert.equal(recognizeShape(norm(zig), W), null);
});

test("snapStroke ignora marca-texto", () => {
  const it = { id: "a", kind: "ink" as const, tool: "highlighter" as const, color: "#fa0", width: 0.02, pts: norm(seg([0, 0], [300, 0])) };
  assert.equal(snapStroke(it, W), null);
});
