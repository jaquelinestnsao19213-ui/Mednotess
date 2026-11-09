// Editor: arrastar a imagem para qualquer ponto da página e copiar a página com a formatação do app.
// Requer: npm i --no-save jsdom @testing-library/react @testing-library/dom
// Rodar: npx tsx --tsconfig tests/tsconfig.json --import ./tests/ui-setup.ts --test tests/image-copy-ui.test.tsx
import "./ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import Editor from "../components/Editor";
import { NodeSelection } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { richClipboard } from "../lib/copy-html";

const g = globalThis as unknown as Record<string, unknown>;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
const win = window as unknown as { PointerEvent: unknown; MouseEvent: typeof MouseEvent };
win.PointerEvent = class extends win.MouseEvent {
  pointerId: number; pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; }
};

const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const rich = { type: "doc", content: [
  { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Paracetamol" }] },
  { type: "paragraph", content: [
    { type: "text", text: "negrito", marks: [{ type: "bold" }] }, { type: "text", text: " " },
    { type: "text", text: "vermelho", marks: [{ type: "textStyle", attrs: { color: "#dc2626" } }] }, { type: "text", text: " " },
    { type: "text", text: "marcado", marks: [{ type: "highlight", attrs: { color: "#fde68a" } }] },
  ] },
  { type: "bulletList", content: [{ type: "listItem", content: [p("item 1")] }] },
  { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p("feito")] }, { type: "taskItem", attrs: { checked: false }, content: [p("a fazer")] }] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Dose")] }, { type: "tableHeader", content: [p("Uso")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p("500 mg")] }, { type: "tableCell", content: [p("oral")] }] }] },
  { type: "callout", attrs: { icon: "⚠️", backgroundColor: "#fef3c7" }, content: [p("Atenção ao fígado")] },
  { type: "image", attrs: { src: "https://exemplo.supabase.co/a.png", width: 240, align: "center" } },
] };

const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 100)); });
const viewOf = (container: HTMLElement) => (container.querySelector(".ProseMirror") as unknown as { editor: { view: import("@tiptap/pm/view").EditorView } }).editor.view;

test("copiar: título, cores, lista, tarefas, tabela, aviso e imagem saem com estilos embutidos", async () => {
  const { container } = render(<Editor initial={rich as never} onChange={() => {}} />);
  await wait();
  const view = viewOf(container);
  const { html, text } = richClipboard(view, new Slice(view.state.doc.content, 0, 0));
  assert.match(html, /<h1[^>]*style="[^"]*font-size:24pt/, "título com tamanho");
  assert.match(html, /<strong[^>]*>negrito/, "negrito mantido");
  assert.match(html, /color: ?rgb\(220, 38, 38\)|color: ?#dc2626/i, "cor do texto mantida");
  assert.match(html, /<mark[^>]*background-color:#fde68a/, "marca-texto com fundo");
  assert.match(html, /<li[^>]*>.*item 1/s, "lista");
  assert.ok(html.includes("☑ feito") && html.includes("☐ a fazer"), "tarefas viram ☑ e ☐");
  assert.ok(!/<input/i.test(html) && !/<label/i.test(html), "sem caixas de seleção do app");
  assert.match(html, /<table[^>]*border-collapse:collapse/);
  assert.match(html, /<td[^>]*border:1px solid #cbd5e1/, "células com borda");
  assert.match(html, /<th[^>]*background:#f1f5f9/, "cabeçalho da tabela destacado");
  assert.ok(html.includes("⚠️ Atenção ao fígado"), "aviso com o ícone");
  assert.match(html, /<div[^>]*background-color:\s*(#fef3c7|rgb\(254, 243, 199\))/, "aviso com a cor de fundo");
  assert.match(html, /<p[^>]*text-align:center[^>]*><img[^>]*src="https:\/\/exemplo\.supabase\.co\/a\.png"/, "imagem centralizada com endereço completo");
  assert.match(html, /<img[^>]*width:240px/);
  assert.match(text, /Paracetamol/);
  cleanup();
});

test("Ctrl+C no texto selecionado leva o HTML formatado e o texto puro", async () => {
  const { container } = render(<Editor initial={rich as never} onChange={() => {}} />);
  await wait();
  const view = viewOf(container);
  const { AllSelection } = await import("@tiptap/pm/state");
  await act(async () => { view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc))); });
  const data: Record<string, string> = {};
  const ev = new window.Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
  ev.clipboardData = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? "" };
  view.dom.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.match(data["text/html"], /font-size:24pt/);
  assert.match(data["text/plain"], /Paracetamol/);
  cleanup();
});

test("imagem: arrastar o corpo dela leva para outro ponto da página e alinha pelo lado onde foi solta", async () => {
  const doc = { type: "doc", content: [p("A"), { type: "image", attrs: { src: "http://x/a.png" } }, p("B")] };
  let latest: { content: { type: string; attrs?: { align?: string } }[] } = doc as never;
  const { container } = render(<Editor initial={doc as never} onChange={(d) => { latest = d as never; }} />);
  await wait();
  const view = viewOf(container);
  const imgPos = 3; // A ocupa 0..3
  await act(async () => { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos))); });
  // jsdom não tem layout: o ponto de soltar cai dentro do "B" (metade de baixo) e a coluna tem 300px de largura
  (view as unknown as { posAtCoords: unknown }).posAtCoords = () => ({ pos: 5, inside: 5 });
  const Elp = (window as unknown as { Element: typeof Element }).Element.prototype;
  const real = Elp.getBoundingClientRect;
  Elp.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    if (el === view.dom) return { left: 0, top: 0, right: 300, bottom: 400, width: 300, height: 400, x: 0, y: 0 } as DOMRect;
    if (el.tagName === "P" && el.textContent === "B") return { left: 0, top: 100, right: 300, bottom: 140, width: 300, height: 40, x: 0, y: 100 } as DOMRect;
    return real.call(this);
  };
  try {
    const img = container.querySelector(".img-box img") as HTMLElement;
    fireEvent.pointerDown(img, { clientX: 10, clientY: 10, button: 0, pointerType: "mouse" });
    await act(async () => { fireEvent.pointerMove(window, { clientX: 260, clientY: 135, pointerType: "mouse" }); });
    assert.ok(document.querySelector(".img-ghost"), "mostra a imagem acompanhando o dedo");
    assert.ok(document.querySelector(".img-dropline"), "mostra a linha do destino");
    await act(async () => { fireEvent.pointerUp(window, { clientX: 260, clientY: 135, pointerType: "mouse" }); });
    const names: string[] = [];
    view.state.doc.forEach((n) => names.push(n.type.name === "paragraph" ? n.textContent : n.type.name));
    assert.deepEqual(names.slice(0, 3), ["A", "B", "image"], "a imagem foi para depois do B");
    assert.equal(view.state.doc.child(2).attrs.align, "right", "foi solta no lado direito");
    assert.equal(document.querySelector(".img-ghost"), null, "limpa a tela ao soltar");
    assert.ok(JSON.stringify(latest).includes("right"));
  } finally {
    Elp.getBoundingClientRect = real;
    cleanup();
  }
});

test("imagem: um clique simples (sem arrastar) não move nem muda o alinhamento", async () => {
  const doc = { type: "doc", content: [p("A"), { type: "image", attrs: { src: "http://x/a.png" } }, p("B")] };
  const { container } = render(<Editor initial={doc as never} onChange={() => {}} />);
  await wait();
  const view = viewOf(container);
  const before = JSON.stringify(view.state.doc.toJSON());
  const img = container.querySelector(".img-box img") as HTMLElement;
  fireEvent.pointerDown(img, { clientX: 10, clientY: 10, button: 0, pointerType: "mouse" });
  fireEvent.pointerMove(window, { clientX: 12, clientY: 11, pointerType: "mouse" });
  fireEvent.pointerUp(window, { clientX: 12, clientY: 11, pointerType: "mouse" });
  assert.equal(document.querySelector(".img-ghost"), null);
  assert.equal(JSON.stringify(view.state.doc.toJSON()), before);
  cleanup();
});
