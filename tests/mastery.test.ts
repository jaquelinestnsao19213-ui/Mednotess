import test from "node:test";
import assert from "node:assert/strict";
import { bySubject, monthlySeries, studyStreak, tagRetention, topicMastery, totalsOf, type AnswerLite } from "../lib/mastery";
import { makeSubjectResolver } from "../lib/subject-resolver";

let n = 0;
const ans = (card: string | null, topic: string, correct: boolean, iso: string, seconds = 10): AnswerLite => ({
  attempt_id: `a${++n}`, card_id: card, topic, topic_key: topic.toLowerCase(), correct, seconds, created_at: iso,
});
const d = (day: number, month = 3) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00Z`;

test("retenção: só conta quando o mesmo item volta depois de 7 dias ou mais", () => {
  const tagged = tagRetention([ans("c1", "Farmaco", true, d(1)), ans("c1", "Farmaco", true, d(3)), ans("c1", "Farmaco", true, d(12)), ans("c2", "Farmaco", true, d(12))]);
  assert.deepEqual(tagged.map((t) => t.isRetention), [false, false, true, false]);
  assert.equal(tagged[0].gapDays, null);
});

test("domínio aparente: acerta tudo na mesma semana, mas sem retenção comprovada", () => {
  const rows = [1, 2, 3, 4].map((i) => ans(`c${i}`, "Farmacocinética", true, d(i)));
  const [m] = topicMastery(tagRetention(rows));
  assert.equal(m.percent, 100);
  assert.equal(m.apparent, true);
  assert.equal(m.status, "aprendendo");
});

test("dominado: acertos repetidos depois de pelo menos 7 dias", () => {
  const rows = [ans("c1", "Anatomia", true, d(1)), ans("c2", "Anatomia", true, d(1)), ans("c1", "Anatomia", true, d(10)), ans("c2", "Anatomia", true, d(10))];
  const [m] = topicMastery(tagRetention(rows));
  assert.equal(m.retentionTotal, 2);
  assert.equal(m.status, "dominado");
  assert.equal(m.apparent, false);
});

test("reforço: acertou na hora e esqueceu depois; ou erra muito sem retenção", () => {
  const forgot = [ans("c1", "Mecanismos", true, d(1)), ans("c2", "Mecanismos", true, d(1)), ans("c1", "Mecanismos", false, d(10)), ans("c2", "Mecanismos", false, d(10))];
  assert.equal(topicMastery(tagRetention(forgot))[0].status, "reforco");
  const bad = [ans("c1", "Histo", false, d(1)), ans("c2", "Histo", false, d(2)), ans("c3", "Histo", true, d(3))];
  assert.equal(topicMastery(tagRetention(bad))[0].status, "reforco");
  assert.equal(topicMastery(tagRetention([ans("c1", "Pouco", true, d(1))]))[0].status, "poucos-dados");
});

test("dominado exige que a última retenção tenha sido acerto", () => {
  const rows = [ans("a", "X", true, d(1)), ans("b", "X", true, d(1)), ans("c", "X", true, d(1)), ans("d", "X", true, d(1)), ans("e", "X", true, d(1)),
    ans("a", "X", true, d(10)), ans("b", "X", true, d(10)), ans("c", "X", true, d(10)), ans("d", "X", true, d(10)), ans("e", "X", false, d(10))];
  assert.equal(topicMastery(tagRetention(rows))[0].status, "aprendendo"); // 4/5 = 80%, mas a última retenção foi erro
});

test("série mensal, totais e disciplina", () => {
  const rows = tagRetention([ans("c1", "A", true, d(5, 1)), ans("c2", "A", false, d(6, 1)), ans("c3", "B", true, d(5, 2))]);
  assert.deepEqual(monthlySeries(rows).map((p) => [p.month, p.percent]), [["2026-01", 50], ["2026-02", 100]]);
  assert.equal(totalsOf(rows).percent, 67);
  const resolve = makeSubjectResolver({
    subjects: [{ id: "s1", notebook_page_id: "nb1" }, { id: "s2", notebook_page_id: null }],
    topics: [{ id: "t2", subject_id: "s2", name: "B", page_id: null }],
    links: [], pages: [{ id: "p1", parent_id: "nb1" }],
    cards: [{ id: "c1", page_id: "p1", topic: null }, { id: "c2", page_id: null, topic: null }, { id: "c3", page_id: null, topic: "B" }],
  });
  const stats = bySubject(rows, resolve, [{ id: "s1", name: "Morfo", color: "#000" }, { id: "s2", name: "Lab", color: "#111" }]);
  assert.deepEqual(stats.map((s) => [s.name, s.total]), [["Morfo", 1], ["Lab", 1]]);
});

test("sequência de dias de estudo", () => {
  const now = new Date(2026, 2, 10, 15);
  const at = (day: number) => ({ created_at: new Date(2026, 2, day, 9).toISOString() });
  assert.equal(studyStreak([at(10), at(9), at(8), at(5)], now), 3);
  assert.equal(studyStreak([at(9), at(8)], now), 2, "hoje ainda não estudou: conta até ontem");
  assert.equal(studyStreak([at(5)], now), 0);
});
