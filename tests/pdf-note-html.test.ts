import test from "node:test";
import assert from "node:assert/strict";
import { cleanNoteHtml, noteIsEmpty, noteToHtml } from "../lib/pdf-note-html";
import { fitWidth, rowRange } from "../lib/image-row";

test("comentário antigo (texto puro) continua legível e seguro", () => {
  assert.equal(noteToHtml("linha 1\nlinha 2"), "linha 1<br>linha 2");
  assert.equal(noteToHtml("dose < 5 mg & mais"), "dose &lt; 5 mg &amp; mais");
  assert.equal(noteToHtml(""), "");
});

test("cleanNoteHtml mantém a formatação permitida", () => {
  assert.equal(cleanNoteHtml("<h4>Título</h4><div>texto <b>forte</b> e <i>itálico</i></div>"), "<h4>Título</h4><div>texto <b>forte</b> e <i>itálico</i></div>");
  assert.equal(cleanNoteHtml('<span style="background-color: rgb(253, 230, 138);">marca</span>'), '<span style="background-color:rgb(253, 230, 138)">marca</span>');
  assert.equal(cleanNoteHtml("<ul><li>a</li><li>b</li></ul>"), "<ul><li>a</li><li>b</li></ul>");
});

test("cleanNoteHtml remove scripts, atributos e eventos", () => {
  const out = cleanNoteHtml('<b onclick="x()">oi</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:1">l</a>');
  assert.equal(out, "<b>oi</b>l");
  assert.equal(cleanNoteHtml('<span style="position:fixed;background:transparent">t</span>'), "<span>t</span>");
  assert.equal(cleanNoteHtml("5 < 6"), "5 &lt; 6");
});

test("noteIsEmpty ignora etiquetas e espaços", () => {
  assert.equal(noteIsEmpty("<div><br></div>"), true);
  assert.equal(noteIsEmpty("&nbsp;"), true);
  assert.equal(noteIsEmpty("<b>a</b>"), false);
});

test("rowRange: junta só imagens seguidas marcadas lado a lado", () => {
  const img = (row: boolean) => ({ isImage: true, row });
  const par = { isImage: false, row: false };
  const items = [par, img(true), img(true), img(true), par, img(true), img(false)];
  assert.deepEqual(rowRange(items, 2), [1, 3]);
  assert.deepEqual(rowRange(items, 5), [5, 5]);
  assert.deepEqual(rowRange(items, 6), [6, 6]);
  assert.deepEqual(rowRange(items, 0), [0, 0]);
});

test("fitWidth: 1, 2 ou 3 imagens cabem na linha", () => {
  assert.equal(fitWidth(900, 3), 292);
  assert.equal(fitWidth(900, 2), 442);
  assert.ok(fitWidth(900, 3) * 3 + 8 * 3 <= 900);
  assert.equal(fitWidth(100, 3), 80);
});
