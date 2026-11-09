// Teste da barra de ações da imagem. Requer: npm i --no-save jsdom @testing-library/react @testing-library/dom
// Rodar: npx tsx --tsconfig tests/tsconfig.json --import ./tests/ui-setup.ts --test tests/image-toolbar.test.tsx
import "/home/claude/Mednotess/tests/ui-setup";
(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id); (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0); (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import Editor from "/home/claude/Mednotess/components/Editor";

const doc = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "antes" }] },
  { type: "image", attrs: { src: "http://x/a.png" } },
  { type: "paragraph", content: [{ type: "text", text: "depois" }] },
] };

test("barra da imagem: mover, ampliar, desenhar, remover", async () => {
  let latest: any = doc;
  const { container } = render(<Editor initial={doc as any} onChange={(d) => { latest = d; }} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  const pm = container.querySelector(".ProseMirror") as HTMLElement;
  assert.ok(container.querySelector(".img-box"), "imagem renderizada");
  assert.equal(container.querySelector(".img-toolbar"), null, "sem barra antes de selecionar");
  // seleciona a imagem pelo editor
  const ed = (globalThis as any).__ed;
  const view = (pm as any).editor?.view ?? null;
  assert.ok(view, "view do ProseMirror");
  const { NodeSelection } = await import("@tiptap/pm/state");
  await act(async () => { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize))); });
  const bar = container.querySelector(".img-toolbar");
  assert.ok(bar, "barra aparece com a imagem selecionada");
  const btn = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  await act(async () => { fireEvent.click(btn("Mover para baixo")); });
  const names = () => view.state.doc.children?.map?.((n: any) => n.type.name) ?? (() => { const a: string[] = []; view.state.doc.forEach((n: any) => a.push(n.type.name)); return a; })();
  assert.deepEqual(names().slice(0, 3), ["paragraph", "paragraph", "image"]);
  await act(async () => { fireEvent.click(btn("Mover para cima")); });
  assert.deepEqual(names().slice(0, 3), ["paragraph", "image", "paragraph"]);
  await act(async () => { fireEvent.click(btn("Ampliar imagem")); });
  assert.ok(document.querySelector(".imgmod-zoom"), "tela cheia abriu");
  await act(async () => { fireEvent.click(document.querySelector('[aria-label="Fechar imagem"]')!); });
  assert.equal(document.querySelector(".imgmod-zoom"), null);
  await act(async () => { fireEvent.click(btn("Desenhar na imagem")); });
  assert.ok(document.querySelector(".imgmod-draw"), "janela de desenho abriu");
  await act(async () => { fireEvent.click(Array.from(document.querySelectorAll(".imgmod-bar button")).find((b) => b.textContent === "Cancelar")!); });
  assert.equal(document.querySelector(".imgmod-draw"), null);
  await act(async () => { fireEvent.click(btn("Remover imagem")); });
  assert.equal(container.querySelector(".img-box"), null, "imagem removida");
  assert.ok(!JSON.stringify(latest).includes("image"), "documento sem imagem");
  cleanup();
});
