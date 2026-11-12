// Ponte entre o leitor de PDF e a assistente: o leitor avisa qual PDF e qual página estão abertos
// (e aceita o comando "ir para a página N"), e a assistente lê isso para usar o PDF como contexto da conversa.

export type ActivePdf = { url: string; name: string; page: number; numPages: number };

type Reader = { info: ActivePdf; ratio: number; touched: number; goTo: (page: number) => void };

const readers = new Map<string, Reader>();
const listeners = new Set<() => void>();
let snapshot: { active: ActivePdf | null; all: ActivePdf[] } = { active: null, all: [] };

/** Qual leitor é o "aberto": o mais visível na tela; no empate, o que a pessoa tocou por último. */
export function pickActive(list: { info: ActivePdf; ratio: number; touched: number }[]): ActivePdf | null {
  const visible = list.filter((r) => r.ratio > 0.05);
  const pool = visible.length ? visible : list.filter((r) => r.touched > 0);
  if (!pool.length) return null;
  const best = [...pool].sort((a, b) => Math.round(b.ratio * 10) - Math.round(a.ratio * 10) || b.touched - a.touched)[0];
  return best.info;
}

function emit() {
  const list = [...readers.values()];
  const next = { active: pickActive(list), all: list.map((r) => r.info) };
  const same =
    next.all.length === snapshot.all.length &&
    next.all.every((p, i) => p.url === snapshot.all[i].url && p.page === snapshot.all[i].page && p.numPages === snapshot.all[i].numPages && p.name === snapshot.all[i].name) &&
    next.active?.url === snapshot.active?.url &&
    next.active?.page === snapshot.active?.page;
  if (same) return;
  snapshot = next;
  listeners.forEach((fn) => fn());
}

export function registerReader(id: string, info: ActivePdf, goTo: (page: number) => void): () => void {
  readers.set(id, { info, ratio: 0, touched: 0, goTo });
  emit();
  return () => {
    readers.delete(id);
    emit();
  };
}

export function updateReader(id: string, patch: Partial<ActivePdf> & { ratio?: number; touched?: number }) {
  const current = readers.get(id);
  if (!current) return;
  const { ratio, touched, ...info } = patch;
  readers.set(id, { ...current, info: { ...current.info, ...info }, ratio: ratio ?? current.ratio, touched: touched ?? current.touched });
  emit();
}

export const subscribeActivePdf = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const getActivePdfSnapshot = () => snapshot;
export const getServerActivePdfSnapshot = () => EMPTY;
const EMPTY: { active: ActivePdf | null; all: ActivePdf[] } = { active: null, all: [] };

/** Leva o leitor do PDF indicado até a página pedida. Devolve false se aquele PDF não está aberto na tela. */
export function goToPdfPage(url: string | null, page: number): boolean {
  const target = [...readers.values()].find((r) => (url ? r.info.url === url : true) && (url || r.info.url === snapshot.active?.url));
  if (!target) return false;
  target.goTo(page);
  const el = document.querySelector<HTMLElement>(`[data-pdf-url="${CSS.escape(target.info.url)}"]`);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}
