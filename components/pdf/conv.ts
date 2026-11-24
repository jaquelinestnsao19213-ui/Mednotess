import { useSyncExternalStore } from "react";

// Mesmas fontes e mesma preferência (chave) da conversão do caderno.
export const CONV_FONTS: { name: string; v: string | null }[] = [
  { name: "Padrão", v: null },
  { name: "Sem serifa", v: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { name: "Com serifa", v: 'Georgia, "Times New Roman", serif' },
  { name: "Mono", v: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { name: "Caveat", v: 'Caveat, "Segoe Print", "Bradley Hand", cursive' },
  { name: "Patrick Hand", v: '"Patrick Hand", "Segoe Print", "Bradley Hand", cursive' },
  { name: "Kalam", v: 'Kalam, "Segoe Print", "Bradley Hand", cursive' },
];

export type ConvPrefs = { convFont: number; autoDelay: number; autoOn: boolean; snapOn: boolean };

const KEY = "mednotes-ink-prefs";
let prefs: ConvPrefs = { convFont: 4, autoDelay: 4, autoOn: false, snapOn: true };
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { convFont?: unknown; autoDelay?: unknown; snapOn?: unknown } | null;
    if (p && typeof p.snapOn === "boolean") prefs.snapOn = p.snapOn;
    if (p && typeof p.convFont === "number" && Number.isInteger(p.convFont) && p.convFont >= 0 && p.convFont < CONV_FONTS.length) prefs.convFont = p.convFont;
    if (p && typeof p.autoDelay === "number" && p.autoDelay >= 2 && p.autoDelay <= 10) prefs.autoDelay = Math.round(p.autoDelay);
  } catch {
    /* usa os valores padrão */
  }
}

export function getConvPrefs(): ConvPrefs {
  load();
  return prefs;
}

export function setConvPrefs(p: Partial<ConvPrefs>) {
  load();
  prefs = { ...prefs, ...p };
  try {
    const raw = window.localStorage.getItem(KEY);
    const old = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(KEY, JSON.stringify({ ...old, convFont: prefs.convFont, autoDelay: prefs.autoDelay, snapOn: prefs.snapOn }));
  } catch {
    /* vale só nesta sessão */
  }
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function useConvPrefs(): ConvPrefs {
  return useSyncExternalStore(subscribe, getConvPrefs, getConvPrefs);
}
