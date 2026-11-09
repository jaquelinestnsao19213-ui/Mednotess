// Organizar aulas e páginas: subir/descer, mover, trazer de outro nível, subir um nível e excluir.
// Passa pelo cliente Supabase real contra o servidor simulado (veja tests/chat-ui-setup.ts).
import "./chat-ui-setup";
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import SubpagesTable from "../components/SubpagesTable";
import { db, start } from "./mock-server.mjs";
import { supabase } from "../lib/supabase";
import type { PageRow } from "../lib/types";

const own = "11111111-1111-4111-8111-111111111111";
const W = { timeout: 15_000 };
const now = new Date().toISOString();
let seq = 0;
const row = (id: string, parent_id: string | null, type: PageRow["type"], title: string, position = 0) =>
  ({ id, user_id: own, parent_id, type, title, icon: null, cover_url: null, content: null, props: {}, position, created_at: new Date(Date.now() + ++seq).toISOString(), updated_at: now });
const get = (id: string) => db.pages.find((p: { id: string }) => p.id === id);
const exists = (id: string) => !!get(id);

// Farmacologia(nb) > [Farmacodinâmica, Paracetamol(lesson) > Toxicidade(page)]; Outro(nb) > Sub(nb)
const IDS = { far: "f0000000-0000-4000-8000-000000000001", fd: "f0000000-0000-4000-8000-000000000002", par: "f0000000-0000-4000-8000-000000000003", tox: "f0000000-0000-4000-8000-000000000004", out: "f0000000-0000-4000-8000-000000000005", sub: "f0000000-0000-4000-8000-000000000006" };

function Harness({ parentId, grandparent }: { parentId: string; grandparent: { id: string; title: string } | null }) {
  const [items, setItems] = React.useState<PageRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const parent = db.pages.find((p: { id: string }) => p.id === parentId) as PageRow;
  const reload = React.useCallback(async () => {
    const { data } = await supabase.from("pages").select("*").eq("parent_id", parentId).order("position").order("created_at");
    setItems((data ?? []) as PageRow[]);
  }, [parentId]);
  React.useEffect(() => { void reload(); }, [reload]);
  return (<><SubpagesTable parent={parent} grandparent={grandparent} items={items} setItems={(u) => setItems(u)} reload={reload} onAdd={() => {}} onError={setError} />{error && <p role="alert">{error}</p>}</>);
}
const titles = () => [...document.querySelectorAll<HTMLInputElement>("tbody input[aria-label='Título']")].map((i) => i.value);
const rowOf = (title: string) => screen.getByDisplayValue(title).closest("tr") as HTMLElement;
const openMenu = (title: string) => fireEvent.click(within(rowOf(title)).getByLabelText(/Mais ações para/));

test.before(async () => {
  await start();
  db.pages.push(
    row(IDS.far, null, "notebook", "Farmacologia"), row(IDS.fd, IDS.far, "lesson", "Farmacodinâmica", 0), row(IDS.par, IDS.far, "lesson", "Paracetamol", 1), row(IDS.tox, IDS.par, "page", "Toxicidade", 0),
    row(IDS.out, null, "notebook", "Outro caderno"), row(IDS.sub, IDS.out, "notebook", "Subcaderno"),
  );
});

test("subir e descer troca a ordem na tela e grava no banco; limites desativados", async () => {
  render(<Harness parentId={IDS.far} grandparent={null} />);
  await waitFor(() => assert.deepEqual(titles(), ["Farmacodinâmica", "Paracetamol"]), W);
  assert.equal((within(rowOf("Farmacodinâmica")).getByLabelText(/Subir/) as HTMLButtonElement).disabled, true);
  assert.equal((within(rowOf("Paracetamol")).getByLabelText(/Descer/) as HTMLButtonElement).disabled, true);
  fireEvent.click(within(rowOf("Paracetamol")).getByLabelText(/Subir/));
  await waitFor(() => assert.deepEqual(titles(), ["Paracetamol", "Farmacodinâmica"]), W);
  await waitFor(() => assert.equal(get(IDS.par).position, 0), W);
  assert.equal(get(IDS.fd).position, 1);
  cleanup();
  render(<Harness parentId={IDS.far} grandparent={null} />); // reabrir: a ordem fica
  await waitFor(() => assert.deepEqual(titles(), ["Paracetamol", "Farmacodinâmica"]), W);
  fireEvent.click(within(rowOf("Paracetamol")).getByLabelText(/Descer/));
  await waitFor(() => assert.deepEqual(titles(), ["Farmacodinâmica", "Paracetamol"]), W);
  cleanup();
});

test("trazer para cá: uma página de dentro de uma aula passa para a tabela do caderno", async () => {
  render(<Harness parentId={IDS.far} grandparent={null} />);
  await waitFor(() => assert.equal(titles().length, 2), W);
  fireEvent.click(screen.getByText("Trazer para cá"));
  const dialog = await screen.findByRole("dialog", undefined, W);
  fireEvent.change(within(dialog).getByLabelText("Buscar"), { target: { value: "toxic" } });
  const option = await within(dialog).findByText("Toxicidade", undefined, W);
  assert.match(dialog.textContent ?? "", /Farmacologia \/ Paracetamol/, "deveria mostrar de onde a página vem");
  fireEvent.click(option);
  await waitFor(() => assert.ok(titles().includes("Toxicidade")), W);
  assert.equal(get(IDS.tox).parent_id, IDS.far);
  assert.equal(get(IDS.tox).position, 2, "vai para o fim da lista");
  cleanup();
});

test("mover para outro lugar: some da tabela, aparece no destino; destinos inválidos não são oferecidos", async () => {
  render(<Harness parentId={IDS.far} grandparent={null} />);
  await waitFor(() => assert.ok(titles().includes("Paracetamol")), W);
  openMenu("Paracetamol");
  fireEvent.click(screen.getByRole("menuitem", { name: /Mover para/ }));
  const dialog = await screen.findByRole("dialog", undefined, W);
  await within(dialog).findByText("Subcaderno", undefined, W);
  assert.ok(!within(dialog).queryByText("Paracetamol", { selector: "strong" }), "não pode oferecer ela mesma");
  assert.ok(!within(dialog).queryByText("Início (cadernos principais)"), "aula não vai para o início");
  fireEvent.click(within(dialog).getByText("Subcaderno"));
  await waitFor(() => assert.ok(!titles().includes("Paracetamol")), W);
  assert.equal(get(IDS.par).parent_id, IDS.sub);
  cleanup();
});

test("subir um nível: tira da aula e leva para o caderno de cima", async () => {
  // Paracetamol agora está em Subcaderno (dentro de Outro caderno): a tabela de Subcaderno sobe itens para "Outro caderno"
  render(<Harness parentId={IDS.sub} grandparent={{ id: IDS.out, title: "Outro caderno" }} />);
  await waitFor(() => assert.deepEqual(titles(), ["Paracetamol"]), W);
  openMenu("Paracetamol");
  fireEvent.click(screen.getByRole("menuitem", { name: /Subir para "Outro caderno"/ }));
  await waitFor(() => assert.equal(titles().length, 0), W);
  assert.equal(get(IDS.par).parent_id, IDS.out);
  cleanup();
});

test("caderno dentro de caderno volta a ser principal", async () => {
  render(<Harness parentId={IDS.out} grandparent={null} />);
  await waitFor(() => assert.ok(titles().includes("Subcaderno")), W);
  openMenu("Subcaderno");
  fireEvent.click(screen.getByRole("menuitem", { name: /Tornar caderno principal/ }));
  await waitFor(() => assert.ok(!titles().includes("Subcaderno")), W);
  assert.equal(get(IDS.sub).parent_id, null);
  // aula não ganha essa opção
  openMenu("Paracetamol");
  assert.ok(!screen.queryByRole("menuitem", { name: /Tornar caderno principal/ }));
  fireEvent.keyDown(document, { key: "Escape" });
  cleanup();
});

test("excluir: pede confirmação (cancelar mantém) e apaga a página com tudo o que há dentro", async () => {
  render(<Harness parentId={IDS.far} grandparent={null} />);
  await waitFor(() => assert.ok(titles().includes("Farmacodinâmica")), W);
  const asked: string[] = [];
  // dentro de Paracetamol (agora em "Outro caderno") não há nada; criamos um filho de Farmacodinâmica para testar o "e N dentro"
  db.pages.push(row("f0000000-0000-4000-8000-000000000007", IDS.fd, "page", "Filha da aula"));
  (window as unknown as { confirm: (m: string) => boolean }).confirm = (m) => { asked.push(m); return false; };
  openMenu("Farmacodinâmica");
  fireEvent.click(screen.getByRole("menuitem", { name: /Excluir/ }));
  await waitFor(() => assert.equal(asked.length, 1), W);
  assert.match(asked[0], /Farmacodinâmica.*e 1 página dentro dela/);
  assert.ok(exists(IDS.fd), "cancelar não pode apagar");
  (window as unknown as { confirm: (m: string) => boolean }).confirm = () => true;
  openMenu("Farmacodinâmica");
  fireEvent.click(screen.getByRole("menuitem", { name: /Excluir/ }));
  await waitFor(() => assert.ok(!titles().includes("Farmacodinâmica")), W);
  assert.ok(!exists(IDS.fd) && !exists("f0000000-0000-4000-8000-000000000007"), "a página dentro também deve sair");
  assert.ok(exists(IDS.far), "o caderno fica");
  cleanup();
});

test("editar título continua funcionando", async () => {
  render(<Harness parentId={IDS.far} grandparent={null} />);
  await waitFor(() => assert.ok(titles().includes("Toxicidade")), W);
  const input = screen.getByDisplayValue("Toxicidade");
  fireEvent.change(input, { target: { value: "Toxicidade hepática" } });
  fireEvent.blur(input);
  await waitFor(() => assert.equal(get(IDS.tox).title, "Toxicidade hepática"), W);
  cleanup();
});

test.after(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50));
