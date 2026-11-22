import test from "node:test";
import assert from "node:assert/strict";
import { ellipsePath, hexToRgb01, inkPath, normRot, toUser, viewSize } from "../lib/pdf-export-geom";

const box = { x: 0, y: 0, width: 400, height: 560 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("normRot normaliza ângulos", () => {
  assert.equal(normRot(0), 0);
  assert.equal(normRot(90), 90);
  assert.equal(normRot(-90), 270);
  assert.equal(normRot(450), 90);
});

test("sem rotação: topo esquerdo da tela vira (0, altura) no PDF", () => {
  const [x, y] = toUser(0, 0, box, 0);
  close(x, 0);
  close(y, 560);
  const [x2, y2] = toUser(1, 1, box, 0);
  close(x2, 400);
  close(y2, 0);
});

test("rotação 90: topo esquerdo da tela é o canto inferior esquerdo do PDF", () => {
  assert.deepEqual(viewSize(box, 90), { W: 560, H: 400 });
  const [x, y] = toUser(0, 0, box, 90);
  close(x, 0);
  close(y, 0);
  const [x2, y2] = toUser(1, 0, box, 90); // topo direito da tela = canto superior esquerdo do PDF
  close(x2, 0);
  close(y2, 560);
});

test("rotação 180 e 270 levam o topo esquerdo aos cantos certos", () => {
  const [a, b] = toUser(0, 0, box, 180);
  close(a, 400);
  close(b, 0);
  const [c, d] = toUser(0, 0, box, 270);
  close(c, 400);
  close(d, 560);
});

test("respeita a origem do CropBox", () => {
  const [x, y] = toUser(0, 0, { x: 10, y: 20, width: 100, height: 200 }, 0);
  close(x, 10);
  close(y, 220);
});

test("caminho do traço usa y invertido e fecha na última ponta", () => {
  const d = inkPath([0, 0, 0.5, 0.5, 1, 1], box, 0);
  assert.ok(d.startsWith("M 0 -560"));
  assert.ok(d.includes("Q "));
  assert.ok(d.endsWith("L 400 0") || d.endsWith("L 400 -0"));
  assert.equal(inkPath([0.1, 0.1], box, 0), "");
});

test("elipse vira polígono fechado", () => {
  const d = ellipsePath(0.5, 0.5, 0.2, 0.1, box, 0);
  assert.ok(d.startsWith("M "));
  assert.ok(d.endsWith("Z"));
  assert.equal(d.split("L ").length - 1, 71);
});

test("cor hexadecimal", () => {
  assert.deepEqual(hexToRgb01("#ff0000"), [1, 0, 0]);
  assert.deepEqual(hexToRgb01("#0f0"), [0, 1, 0]);
  assert.equal(hexToRgb01("lixo").length, 3);
});
