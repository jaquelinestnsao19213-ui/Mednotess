import test from "node:test";
import assert from "node:assert/strict";
import { createAutosaver, type SaveStatus } from "../lib/autosave";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("autosave: várias alterações seguidas viram uma gravação só, com o último estado", async () => {
  const saved: number[] = [];
  const status: SaveStatus[] = [];
  const saver = createAutosaver<number>(async (v) => { saved.push(v); }, (s) => status.push(s), 30);
  saver.schedule(1); saver.schedule(2); saver.schedule(3);
  assert.equal(saved.length, 0, "ainda não gravou (espera parar de mexer)");
  await wait(80);
  assert.deepEqual(saved, [3]);
  assert.equal(status.at(-1), "saved");
  assert.equal(saver.hasPending(), false);
});

test("autosave: flush grava na hora (ao sair da tela)", async () => {
  const saved: string[] = [];
  const saver = createAutosaver<string>(async (v) => { saved.push(v); }, () => {}, 10_000);
  saver.schedule("a");
  await saver.flush();
  assert.deepEqual(saved, ["a"]);
  saver.dispose();
});

test("autosave: se falhar, mantém o estado e tenta de novo; alteração durante a gravação não se perde", async () => {
  let attempts = 0;
  const saved: number[] = [];
  const status: SaveStatus[] = [];
  const saver = createAutosaver<number>(async (v) => {
    attempts++;
    await wait(15);
    if (attempts === 1) throw new Error("rede");
    saved.push(v);
  }, (s) => status.push(s), 10, 40);
  saver.schedule(1);
  await wait(30);
  assert.ok(status.includes("error"));
  saver.schedule(2); // chega depois da falha
  await wait(120);
  assert.deepEqual(saved, [2]);
  assert.equal(status.at(-1), "saved");

  // alteração enquanto grava
  const s2: number[] = [];
  const saver2 = createAutosaver<number>(async (v) => { await wait(30); s2.push(v); }, () => {}, 5);
  saver2.schedule(10);
  await wait(15);
  saver2.schedule(11);
  await wait(120);
  assert.deepEqual(s2, [10, 11]);
});
