import test from "node:test";
import assert from "node:assert/strict";
import { classifyFile, humanSize, extensionLabel } from "../lib/attachment-kinds";
import { FILE_LIMITS, allocateBudget, cutText, inferKind, loadTextDocs, parseFileRefs, visualBlocks } from "../lib/server/attachments";
import { DriveError, downloadOne, driveErrorFor, driveFileName, exportPlanFor } from "../lib/google-drive";

const PREFIX = "https://x.supabase.co/storage/v1/object/public/files/user-1/";
const url = (n: string) => `${PREFIX}${n}`;

/* ---------- formatos aceitos ---------- */

test("classifyFile: aceita PDF, Word, PowerPoint, Excel, texto e imagens", () => {
  assert.deepEqual(classifyFile({ name: "aula.pdf", type: "application/pdf" }), { kind: "pdf" });
  assert.deepEqual(classifyFile({ name: "AULA.PDF", type: "" }), { kind: "pdf" });
  assert.deepEqual(classifyFile({ name: "resumo.docx", type: "" }), { kind: "text" });
  assert.deepEqual(classifyFile({ name: "slides.pptx", type: "" }), { kind: "text" });
  assert.deepEqual(classifyFile({ name: "tabela.xlsx", type: "" }), { kind: "text" });
  assert.deepEqual(classifyFile({ name: "notas.txt", type: "text/plain" }), { kind: "text" });
  assert.deepEqual(classifyFile({ name: "esquema.png", type: "image/png" }), { kind: "image" });
  assert.deepEqual(classifyFile({ name: "foto.jpeg", type: "" }), { kind: "image" });
});

test("classifyFile: recusa formatos que não dá para ler, com mensagem clara", () => {
  const legacy = classifyFile({ name: "antigo.doc", type: "" });
  assert.ok("error" in legacy && /formato antigo/.test(legacy.error));
  const heic = classifyFile({ name: "foto.heic", type: "image/heic" });
  assert.ok("error" in heic && /JPG ou PNG/.test(heic.error));
  const zip = classifyFile({ name: "tudo.zip", type: "application/zip" });
  assert.ok("error" in zip && /não é um formato aceito/.test(zip.error));
});

test("humanSize e extensionLabel", () => {
  assert.equal(humanSize(0), "");
  assert.equal(humanSize(512), "512 B");
  assert.equal(humanSize(2048), "2 KB");
  assert.equal(humanSize(3 * 1024 * 1024), "3,0 MB");
  assert.equal(extensionLabel("aula.final.pdf"), "PDF");
  assert.equal(extensionLabel("semextensao"), "ARQ");
});

/* ---------- servidor: validação e limites ---------- */

test("parseFileRefs: só aceita arquivos da pasta da própria usuária e remove duplicados", () => {
  const { refs, notes } = parseFileRefs(
    [
      { url: url("a.pdf"), name: "a.pdf" },
      { url: url("a.pdf"), name: "a de novo.pdf" },
      { url: "https://x.supabase.co/storage/v1/object/public/files/outra-pessoa/b.pdf", name: "b.pdf" },
      { url: "https://evil.example/c.pdf", name: "c.pdf" },
      { url: url("d.webp"), name: "d" },
      { url: url("e.txt"), name: "e" },
    ],
    PREFIX
  );
  assert.deepEqual(refs.map((r) => [r.name, r.kind]), [["a.pdf", "pdf"], ["d", "image"], ["e", "text"]]);
  assert.deepEqual(notes, []);
});

test("parseFileRefs: avisa quais arquivos ficaram de fora pelo limite (nunca descarta em silêncio)", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ url: url(`p${i}.pdf`), name: `aula${i}.pdf`, kind: "pdf" }));
  const { refs, notes } = parseFileRefs(many, PREFIX);
  assert.equal(refs.length, FILE_LIMITS.pdfs);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /aula5\.pdf.*limite é de 5 PDFs/);
});

test("parseFileRefs: conta os arquivos que já vieram (ex.: PDFs de dentro das páginas)", () => {
  const seed = [{ url: url("s.pdf"), name: "s.pdf", kind: "pdf" as const }];
  const { refs } = parseFileRefs([{ url: url("t.pdf"), name: "t.pdf" }], PREFIX, seed);
  assert.equal(refs.length, 2);
});

test("inferKind: atividades antigas (sem 'kind') continuam sendo PDF", () => {
  assert.equal(inferKind(url("x.pdf")), "pdf");
  assert.equal(inferKind(url("x.bin")), "pdf");
  assert.equal(inferKind(url("x.jpg?token=1")), "image");
  assert.equal(inferKind(url("x.txt")), "text");
  assert.equal(inferKind(url("x.pdf"), "text"), "text");
});

test("allocateBudget: arquivos curtos entram inteiros e o resto é dividido entre os longos", () => {
  assert.deepEqual(allocateBudget([100, 100, 100], 1000, 500), [100, 100, 100]);
  // 3 arquivos longos dividem o total igualmente
  assert.deepEqual(allocateBudget([900, 900, 900], 900, 500), [300, 300, 300]);
  // um curto libera espaço para os longos
  const out = allocateBudget([50, 900, 900], 900, 800);
  assert.equal(out[0], 50);
  assert.equal(out[1] + out[2], 850);
  assert.ok(out.every((n) => n > 0), "nenhum arquivo pode ficar sem espaço");
  // respeita o teto por arquivo
  assert.deepEqual(allocateBudget([10_000], 50_000, 8_000), [8_000]);
});

test("cutText: corta no fim de um parágrafo quando possível", () => {
  const text = `${"a".repeat(90)}\n\n${"b".repeat(50)}`;
  assert.equal(cutText(text, 100), "a".repeat(90));
  assert.equal(cutText("curto", 100), "curto");
});

test("loadTextDocs: lê todos os arquivos, avisa os cortados e os que falharam", async () => {
  const bodies: Record<string, string | null> = {
    [url("a.txt")]: "Primeiro ".repeat(10),
    [url("b.txt")]: "x".repeat(500),
    [url("c.txt")]: null, // indisponível
  };
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const body = bodies[String(input)];
    if (body === null || body === undefined) return new Response("nope", { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  const limits = { ...FILE_LIMITS, textPerFile: 200, textTotal: 300 };
  const refs = ["a", "b", "c"].map((n) => ({ url: url(`${n}.txt`), name: `${n}.txt`, kind: "text" as const }));
  const { docs, notes } = await loadTextDocs(refs, AbortSignal.timeout(5000), limits, fakeFetch);
  assert.equal(docs.length, 2, "os dois arquivos legíveis entram");
  assert.equal(docs[0].truncated, false);
  assert.equal(docs[1].truncated, true);
  assert.ok(docs[1].text.length > 0 && docs[1].text.length <= 210);
  assert.ok(notes.some((n) => /Não consegui ler “c\.txt”/.test(n)));
  assert.ok(notes.some((n) => /“b\.txt” é longo/.test(n)));
});

test("visualBlocks: PDFs e imagens viram blocos; texto não", () => {
  const blocks = visualBlocks([
    { url: url("a.pdf"), name: "a.pdf", kind: "pdf" },
    { url: url("b.png"), name: "b.png", kind: "image" },
    { url: url("c.txt"), name: "c.txt", kind: "text" },
  ]) as unknown as { type: string }[];
  assert.deepEqual(blocks.map((b) => b.type), ["document", "image"]);
});

/* ---------- Google Drive ---------- */

test("Drive: Docs e Slides viram PDF, Sheets vira xlsx, arquivos comuns baixam como estão", () => {
  assert.deepEqual(exportPlanFor("application/vnd.google-apps.document"), { mime: "application/pdf", extension: "pdf", label: "Google Docs" });
  assert.equal((exportPlanFor("application/vnd.google-apps.presentation") as { extension: string }).extension, "pdf");
  assert.equal((exportPlanFor("application/vnd.google-apps.spreadsheet") as { extension: string }).extension, "xlsx");
  assert.equal(exportPlanFor("application/pdf"), null);
  assert.equal(exportPlanFor("application/vnd.google-apps.form"), "unsupported");
});

test("Drive: nome do arquivo exportado ganha a extensão certa uma única vez", () => {
  const plan = exportPlanFor("application/vnd.google-apps.document");
  assert.ok(plan && plan !== "unsupported");
  assert.equal(driveFileName("Farmacologia", plan), "Farmacologia.pdf");
  assert.equal(driveFileName("Farmacologia.pdf", plan), "Farmacologia.pdf");
  assert.equal(driveFileName("Aula.docx", null), "Aula.docx");
});

test("Drive: mensagens de erro claras para cada situação", () => {
  assert.equal(driveErrorFor(401, undefined, "a.pdf").kind, "auth");
  assert.equal(driveErrorFor(404, undefined, "a.pdf").kind, "missing");
  assert.equal(driveErrorFor(403, "exportSizeLimitExceeded", "a").kind, "export-limit");
  assert.equal(driveErrorFor(403, "forbidden", "a").kind, "permission");
  assert.match(driveErrorFor(403, "forbidden", "a.pdf").message, /Sem permissão/);
  assert.match(driveErrorFor(404, undefined, "a.pdf").message, /não está mais disponível/);
  assert.match(driveErrorFor(503, undefined, "a.pdf").message, /instável/);
});

test("Drive: baixa arquivo comum com progresso e exporta Docs como PDF", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-length": "4" } });
  }) as typeof fetch;
  const seen: number[] = [];
  const a = await downloadOne("tok", { id: "ID1", name: "aula.pdf", mimeType: "application/pdf", sizeBytes: 4 }, (done) => seen.push(done), undefined, fakeFetch);
  assert.equal(a.file.name, "aula.pdf");
  assert.equal(a.file.size, 4);
  assert.ok(seen.includes(4));
  assert.match(calls[0], /files\/ID1\?alt=media/);

  const b = await downloadOne("tok", { id: "ID2", name: "Resumo", mimeType: "application/vnd.google-apps.document", sizeBytes: 0 }, () => {}, undefined, fakeFetch);
  assert.equal(b.file.name, "Resumo.pdf");
  assert.equal(b.file.type, "application/pdf");
  assert.match(calls[1], /files\/ID2\/export\?mimeType=application%2Fpdf/);
});

test("Drive: erros viram mensagens (sem permissão, arquivo apagado, conexão caiu, grande demais, tipo não suportado)", async () => {
  const status = (code: number, reason?: string) =>
    (async () => new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status: code })) as unknown as typeof fetch;
  const doc = { id: "X", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
  await assert.rejects(downloadOne("t", doc, () => {}, undefined, status(403, "forbidden")), (e: DriveError) => e.kind === "permission");
  await assert.rejects(downloadOne("t", doc, () => {}, undefined, status(404)), (e: DriveError) => e.kind === "missing");
  await assert.rejects(downloadOne("t", doc, () => {}, undefined, status(401)), (e: DriveError) => e.kind === "auth");
  const offline = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  await assert.rejects(downloadOne("t", doc, () => {}, undefined, offline), (e: DriveError) => e.kind === "network" && /conexão/.test(e.message));
  await assert.rejects(downloadOne("t", { ...doc, sizeBytes: 80 * 1024 * 1024 }, () => {}), (e: DriveError) => e.kind === "too-large");
  await assert.rejects(downloadOne("t", { ...doc, mimeType: "application/vnd.google-apps.form" }, () => {}), (e: DriveError) => e.kind === "unsupported");
});
