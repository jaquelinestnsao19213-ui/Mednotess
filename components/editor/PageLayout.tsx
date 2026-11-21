"use client";

import { useEffect, useState } from "react";

// Largura da área de escrita e espaço entre parágrafos: preferência do aparelho, vale para todos os cadernos.
const KEY = "mednotes-page-layout";
const WIDTHS = [
  { id: "narrow", name: "Estreita" },
  { id: "medium", name: "Média" },
  { id: "wide", name: "Larga" },
  { id: "full", name: "Tela cheia" },
] as const;
const GAPS = [
  { id: "compact", name: "Compacto" },
  { id: "normal", name: "Normal" },
  { id: "airy", name: "Amplo" },
] as const;

type Prefs = { width: (typeof WIDTHS)[number]["id"]; gap: (typeof GAPS)[number]["id"] };
const DEFAULTS: Prefs = { width: "medium", gap: "normal" };

function read(): Prefs {
  try {
    const p = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    return {
      width: WIDTHS.some((w) => w.id === p?.width) ? (p!.width as Prefs["width"]) : DEFAULTS.width,
      gap: GAPS.some((g) => g.id === p?.gap) ? (p!.gap as Prefs["gap"]) : DEFAULTS.gap,
    };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: Prefs) {
  document.documentElement.dataset.pw = p.width;
  document.documentElement.dataset.pg = p.gap;
}

// Aplica a preferência assim que o app abre (montado uma vez no layout).
export function PageLayoutApply() {
  useEffect(() => apply(read()), []);
  return null;
}

// Botões da aba "Aa" do editor.
export function PageLayoutPicker() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => setPrefs(read()), []);
  const set = (next: Partial<Prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    apply(merged);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  };
  return (
    <>
      <p className="sheet-label">Largura da página</p>
      <div className="sheet-row">
        {WIDTHS.map((w) => (
          <button type="button" key={w.id} className={prefs.width === w.id ? "chip on" : "chip"} onClick={() => set({ width: w.id })}>
            {w.name}
          </button>
        ))}
      </div>
      <p className="sheet-label">Espaço entre parágrafos</p>
      <div className="sheet-row">
        {GAPS.map((g) => (
          <button type="button" key={g.id} className={prefs.gap === g.id ? "chip on" : "chip"} onClick={() => set({ gap: g.id })}>
            {g.name}
          </button>
        ))}
      </div>
    </>
  );
}
