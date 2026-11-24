import test from "node:test";
import assert from "node:assert/strict";
import { snapShape } from "../components/pdf/shape-snap";

const W = 800;
const H = 1100;
// ruído determinístico
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
const jig = (a: number) => a * rnd();
const norm = (p: [number, number][]) => p.flatMap(([x, y]) => [x / W, y / H]);

function line(a: [number, number], b: [number, number], k: number, noise = 1.5): [number, number][] {
  return Array.from({ length: k }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (k - 1) + jig(noise), a[1] + ((b[1] - a[1]) * i) / (k - 1) + jig(noise)] as [number, number]);
}

test("reta torta vira reta; quase horizontal fica horizontal", () => {
  const s = snapShape(norm(line([100, 300], [400, 312], 40)), W, H);
  assert.ok(s && s.kind === "poly" && s.label === "Reta");
  const pts = s!.kind === "poly" ? s!.pts : [];
  assert.ok(Math.abs(pts[1] * H - pts[pts.length - 1] * H) < 0.5, "extremos na mesma altura");
});

test("retângulo à mão (com cantos arredondados e traço aberto) vira retângulo", () => {
  const pts = [...line([200, 200], [500, 200], 25), ...line([500, 200], [500, 380], 20), ...line([500, 380], [200, 380], 25), ...line([200, 380], [205, 210], 20)];
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "poly" && s.label === "Retângulo", JSON.stringify(s && s.label));
});

test("quadrado vira quadrado", () => {
  const pts = [...line([200, 200], [400, 200], 20), ...line([400, 200], [402, 405], 20), ...line([402, 405], [198, 400], 20), ...line([198, 400], [203, 205], 20)];
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "poly" && s.label === "Quadrado", JSON.stringify(s && s.label));
});

test("círculo torto vira círculo", () => {
  const pts: [number, number][] = Array.from({ length: 70 }, (_, i) => {
    const a = (i / 66) * Math.PI * 2;
    return [400 + Math.cos(a) * 90 * (1 + jig(0.04)), 500 + Math.sin(a) * 90 * (1 + jig(0.04))];
  });
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "ellipse" && s.label === "Círculo", JSON.stringify(s && s.label));
});

test("elipse achatada vira elipse", () => {
  const pts: [number, number][] = Array.from({ length: 70 }, (_, i) => {
    const a = (i / 66) * Math.PI * 2;
    return [400 + Math.cos(a) * 160, 500 + Math.sin(a) * 60];
  });
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "ellipse" && s.label === "Elipse", JSON.stringify(s && s.label));
});

test("triângulo vira triângulo", () => {
  const pts = [...line([300, 200], [450, 400], 25), ...line([450, 400], [150, 400], 25), ...line([150, 400], [305, 205], 25)];
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "poly" && s.label === "Triângulo", JSON.stringify(s && s.label));
});

test("seta (corpo + ponta no mesmo traço) vira seta", () => {
  const tip: [number, number] = [500, 300];
  const pts = [...line([200, 300], tip, 40), ...line(tip, [470, 280], 8), ...line([470, 280], tip, 8), ...line(tip, [470, 322], 8)];
  const s = snapShape(norm(pts), W, H);
  assert.ok(s && s.kind === "poly" && s.label === "Seta", JSON.stringify(s && s.label));
});

test("rabisco e letra não viram forma", () => {
  const zig: [number, number][] = Array.from({ length: 60 }, (_, i) => [200 + i * 4, 300 + Math.sin(i / 3) * 40]);
  assert.equal(snapShape(norm(zig), W, H), null);
  const tiny = line([100, 100], [110, 104], 10);
  assert.equal(snapShape(norm(tiny), W, H), null);
});
