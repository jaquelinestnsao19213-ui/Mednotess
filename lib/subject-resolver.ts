// Descobre a disciplina de cada resposta: pelo caderno/página do card, pelo vínculo do assunto ou pelo nome do assunto.
import { topicKey } from "./review-report";

type SubjectRef = { id: string; notebook_page_id: string | null };
type TopicRef = { subject_id: string; name: string; page_id: string | null; id: string };
type LinkRef = { topic_id: string; page_id: string };
type PageRef = { id: string; parent_id: string | null };
type CardRef = { id: string; page_id: string | null; topic: string | null };

export function makeSubjectResolver(input: { subjects: SubjectRef[]; topics: TopicRef[]; links: LinkRef[]; pages: PageRef[]; cards: CardRef[] }) {
  const pageToSubject = new Map<string, string>();
  const topicById = new Map(input.topics.map((t) => [t.id, t]));
  // do mais genérico para o mais específico: o vínculo de assunto vence o caderno inteiro
  for (const s of input.subjects) if (s.notebook_page_id) pageToSubject.set(s.notebook_page_id, s.id);
  for (const t of input.topics) if (t.page_id) pageToSubject.set(t.page_id, t.subject_id);
  for (const l of input.links) {
    const topic = topicById.get(l.topic_id);
    if (topic) pageToSubject.set(l.page_id, topic.subject_id);
  }
  const parentOf = new Map(input.pages.map((p) => [p.id, p.parent_id]));
  const nameToSubject = new Map<string, string>();
  for (const t of input.topics) {
    const key = topicKey(t.name);
    if (key && !nameToSubject.has(key)) nameToSubject.set(key, t.subject_id);
  }
  const cardById = new Map(input.cards.map((c) => [c.id, c]));

  const fromPage = (pageId: string | null): string | null => {
    let current = pageId;
    for (let depth = 0; current && depth < 25; depth++) {
      const hit = pageToSubject.get(current);
      if (hit) return hit;
      current = parentOf.get(current) ?? null;
    }
    return null;
  };

  return (answer: { card_id: string | null; topic_key: string }): string | null => {
    const card = answer.card_id ? cardById.get(answer.card_id) : undefined;
    return (
      fromPage(card?.page_id ?? null) ??
      (card?.topic ? nameToSubject.get(topicKey(card.topic)) ?? null : null) ??
      nameToSubject.get(answer.topic_key) ??
      null
    );
  };
}
