"use client";

export const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#475569", "#b45309"];
export const ICONS = ["📚", "🩺", "💊", "🧬", "🧠", "❤️", "🔬", "📝"];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="sheet-row" role="radiogroup" aria-label="Cor da disciplina">
      {COLORS.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={`Cor ${c}`}
          className={value === c ? "swatch picked" : "swatch"}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function IconPicker({ value, onChange }: { value: string; onChange: (i: string) => void }) {
  return (
    <div className="sheet-row" role="radiogroup" aria-label="Ícone da disciplina">
      {ICONS.map((i) => (
        <button
          type="button"
          key={i}
          role="radio"
          aria-checked={value === i}
          className={value === i ? "chip on" : "chip"}
          onClick={() => onChange(i)}
        >
          {i}
        </button>
      ))}
      <input
        className="icon-input"
        value={ICONS.includes(value) ? "" : value}
        placeholder="Outro"
        maxLength={4}
        aria-label="Outro emoji"
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </div>
  );
}
