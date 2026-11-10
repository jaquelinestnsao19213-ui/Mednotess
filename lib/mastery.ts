// Regras do painel de desempenho: domínio aparente × retenção demonstrada ao longo do tempo.
// Tudo aqui é cálculo puro (sem rede), para ser fácil de testar. Usa só o que já existe em review_answers.

export type AnswerLite = {
  attempt_id: string;
  card_id: string | null;
  topic: string;
  topic_key: string;
  correct: boolean;
  seconds: number;
  created_at: string;
};

/** Uma resposta só conta como "retenção" se o mesmo item já tinha sido respondido há pelo menos este número de dias. */
export const RETENTION_DAYS = 7;
/** Mínimo de respostas de retenção para afirmar domínio (ou dificuldade persistente). */
export const MIN_RETENTION_SAMPLES = 2;

const DAY_MS = 86_400_000;

export type TaggedAnswer = AnswerLite & { gapDays: number | null; isRetention: boolean };

/** Marca cada resposta com o intervalo desde a resposta anterior do mesmo item (card). */
export function tagRetention(answers: AnswerLite[]): TaggedAnswer[] {
  const sorted = [...answers].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastByCard = new Map<string, number>();
  return sorted.map((answer) => {
    const at = new Date(answer.created_at).getTime();
    let gapDays: number | null = null;
    if (answer.card_id) {
      const previous = lastByCard.get(answer.card_id);
      if (previous !== undefined) gapDays = (at - previous) / DAY_MS;
      lastByCard.set(answer.card_id, at);
    }
    return { ...answer, gapDays, isRetention: gapDays !== null && gapDays >= RETENTION_DAYS };
  });
}

export type MasteryStatus = "poucos-dados" | "aprendendo" | "dominado" | "reforco";

export const STATUS_TEXT: Record<MasteryStatus, string> = {
  "poucos-dados": "Poucos dados",
  aprendendo: "Em aprendizado",
  dominado: "Dominado",
  reforco: "Precisa de reforço",
};

export type TopicMastery = {
  key: string;
  topic: string;
  total: number;
  correct: number;
  wrong: number;
  percent: number;
  seconds: number;
  retentionTotal: number;
  retentionCorrect: number;
  retentionPercent: number | null;
  lastAt: string;
  /** Vai bem nas sessões, mas ainda sem retenção comprovada depois de dias: domínio aparente. */
  apparent: boolean;
  status: MasteryStatus;
};

export function classify(m: Pick<TopicMastery, "total" | "percent" | "retentionTotal" | "retentionPercent"> & { lastRetentionCorrect: boolean | null }): MasteryStatus {
  if (m.total < 2) return "poucos-dados";
  const hasRetention = m.retentionTotal >= MIN_RETENTION_SAMPLES;
  if (hasRetention && (m.retentionPercent ?? 0) < 60) return "reforco";
  if (!hasRetention && m.total >= 3 && m.percent < 50) return "reforco";
  if (hasRetention && (m.retentionPercent ?? 0) >= 80 && m.lastRetentionCorrect !== false) return "dominado";
  return "aprendendo";
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function topicMastery(tagged: TaggedAnswer[]): TopicMastery[] {
  const groups = new Map<string, TaggedAnswer[]>();
  for (const a of tagged) {
    if (!a.topic_key) continue;
    const list = groups.get(a.topic_key) ?? [];
    list.push(a);
    groups.set(a.topic_key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const total = list.length;
    const correct = list.filter((a) => a.correct).length;
    const retention = list.filter((a) => a.isRetention);
    const retentionCorrect = retention.filter((a) => a.correct).length;
    const retentionPercent = retention.length ? pct(retentionCorrect, retention.length) : null;
    const lastRetentionCorrect = retention.length ? retention[retention.length - 1].correct : null;
    const percent = pct(correct, total);
    const status = classify({ total, percent, retentionTotal: retention.length, retentionPercent, lastRetentionCorrect });
    return {
      key,
      topic: list[list.length - 1].topic,
      total,
      correct,
      wrong: total - correct,
      percent,
      seconds: list.reduce((sum, a) => sum + (a.seconds || 0), 0),
      retentionTotal: retention.length,
      retentionCorrect,
      retentionPercent,
      lastAt: list[list.length - 1].created_at,
      apparent: total >= 3 && percent >= 80 && retention.length < MIN_RETENTION_SAMPLES,
      status,
    };
  });
}

/* ---------- agregados ---------- */

export type Totals = { total: number; correct: number; percent: number; seconds: number; retentionTotal: number; retentionPercent: number | null };

export function totalsOf(tagged: TaggedAnswer[]): Totals {
  const correct = tagged.filter((a) => a.correct).length;
  const retention = tagged.filter((a) => a.isRetention);
  return {
    total: tagged.length,
    correct,
    percent: pct(correct, tagged.length),
    seconds: tagged.reduce((sum, a) => sum + (a.seconds || 0), 0),
    retentionTotal: retention.length,
    retentionPercent: retention.length ? pct(retention.filter((a) => a.correct).length, retention.length) : null,
  };
}

export type MonthPoint = { month: string; total: number; correct: number; percent: number };

const monthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Aproveitamento por mês (só os meses que têm respostas). */
export function monthlySeries(tagged: TaggedAnswer[]): MonthPoint[] {
  const byMonth = new Map<string, { total: number; correct: number }>();
  for (const a of tagged) {
    const key = monthKey(a.created_at);
    const entry = byMonth.get(key) ?? { total: 0, correct: 0 };
    entry.total += 1;
    if (a.correct) entry.correct += 1;
    byMonth.set(key, entry);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, e]) => ({ month, total: e.total, correct: e.correct, percent: pct(e.correct, e.total) }));
}

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Dias seguidos com pelo menos uma resposta, contando até hoje (ou até ontem, se hoje ainda não estudou). */
export function studyStreak(tagged: Pick<TaggedAnswer, "created_at">[], now = new Date()): number {
  const days = new Set(tagged.map((a) => dayKey(new Date(a.created_at))));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export type SubjectStat = Totals & { id: string; name: string; color: string };

/** Agrupa as respostas por disciplina usando um resolvedor (card/assunto → disciplina). */
export function bySubject(
  tagged: TaggedAnswer[],
  resolve: (a: TaggedAnswer) => string | null,
  subjects: { id: string; name: string; color: string }[]
): SubjectStat[] {
  const groups = new Map<string, TaggedAnswer[]>();
  for (const a of tagged) {
    const id = resolve(a);
    if (!id) continue;
    const list = groups.get(id) ?? [];
    list.push(a);
    groups.set(id, list);
  }
  return subjects
    .filter((s) => groups.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, color: s.color, ...totalsOf(groups.get(s.id)!) }));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? `${seconds} s` : "0 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
