"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";

type Point = { x: number; y: number };

/** Compact, movable control dock for handwriting conversion workflows. */
export default function InkConversionDock({
  autoConvert,
  onAutoConvertChange,
  onConvert,
  converting = false,
  fontName,
  fontOptions,
  onFontChange,
  onTextScale,
  onTextMove,
  onClose,
  status,
}: {
  autoConvert: boolean;
  onAutoConvertChange: (enabled: boolean) => void;
  onConvert: () => void;
  converting?: boolean;
  fontName: string;
  fontOptions: { name: string; sample?: ReactNode }[];
  onFontChange: (name: string) => void;
  /** Scale the converted text by a relative factor (e.g. 1.1 or 0.9). */
  onTextScale: (factor: number) => void;
  /** Move the converted text by screen-space pixels. */
  onTextMove: (dx: number, dy: number) => void;
  onClose?: () => void;
  status?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [position, setPosition] = useState<Point>({ x: 12, y: 120 });
  const drag = useRef<{ id: number; origin: Point; start: Point } | null>(null);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, origin: { x: event.clientX, y: event.clientY }, start: position };
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const maxX = Math.max(0, window.innerWidth - 72);
    const maxY = Math.max(0, window.innerHeight - 72);
    setPosition({
      x: Math.max(0, Math.min(maxX, current.start.x + event.clientX - current.origin.x)),
      y: Math.max(0, Math.min(maxY, current.start.y + event.clientY - current.origin.y)),
    });
  };
  const stopDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  const buttonStyle = (selected = false): React.CSSProperties => ({
    minHeight: 38,
    padding: "7px 11px",
    border: "1px solid #d9e2e8",
    borderRadius: 10,
    background: selected ? "#0f766e" : "#fff",
    color: selected ? "#fff" : "#172b36",
    font: "600 14px/1.2 system-ui, sans-serif",
    whiteSpace: "nowrap",
    touchAction: "manipulation",
  });

  return (
    <aside
      aria-label="Controles de escrita e conversão"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 80,
        width: expanded ? "min(360px, calc(100vw - 24px))" : "auto",
        maxHeight: "min(70vh, 560px)",
        overflowY: "auto",
        padding: 8,
        border: "1px solid rgba(148,163,184,.45)",
        borderRadius: 16,
        background: "rgba(255,255,255,.97)",
        boxShadow: "0 12px 32px rgba(15,23,42,.20)",
        backdropFilter: "blur(12px)",
        color: "#172b36",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          aria-label="Arraste para mover os controles"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          style={{ ...buttonStyle(), cursor: "grab", touchAction: "none", flex: 1, textAlign: "left" }}
        >
          ✍ <strong>Escrita inteligente</strong>
        </button>
        <button type="button" aria-label={expanded ? "Recolher controles" : "Expandir controles"} style={buttonStyle()} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "▾" : "▴"}
        </button>
        {onClose && <button type="button" aria-label="Fechar controles" style={buttonStyle()} onClick={onClose}>×</button>}
      </header>

      {expanded && (
        <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
          <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 14, fontWeight: 650 }}>
            <input type="checkbox" checked={autoConvert} onChange={(e) => onAutoConvertChange(e.target.checked)} />
            Converter ao pausar ou começar outra linha
          </label>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }} aria-label="Fonte do texto convertido">
            {fontOptions.map((font) => (
              <button key={font.name} type="button" aria-pressed={font.name === fontName} style={{ ...buttonStyle(font.name === fontName), fontFamily: font.name }} onClick={() => onFontChange(font.name)}>
                {font.sample ?? font.name}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" style={buttonStyle()} onClick={() => onTextScale(0.9)} aria-label="Diminuir texto convertido">A−</button>
            <button type="button" style={buttonStyle()} onClick={() => onTextScale(1.1)} aria-label="Aumentar texto convertido">A+</button>
            <button type="button" style={buttonStyle()} onClick={() => onTextMove(-12, 0)} aria-label="Mover texto para a esquerda">←</button>
            <button type="button" style={buttonStyle()} onClick={() => onTextMove(12, 0)} aria-label="Mover texto para a direita">→</button>
            <button type="button" style={buttonStyle()} onClick={() => onTextMove(0, -12)} aria-label="Mover texto para cima">↑</button>
            <button type="button" style={buttonStyle()} onClick={() => onTextMove(0, 12)} aria-label="Mover texto para baixo">↓</button>
          </div>
          <button type="button" disabled={converting} style={{ ...buttonStyle(true), opacity: converting ? 0.65 : 1, fontWeight: 750 }} onClick={onConvert}>
            {converting ? "Convertendo…" : "Converter escrita atual"}
          </button>
          {status && <p role="status" style={{ margin: 0, color: "#475569", fontSize: 13 }}>{status}</p>}
          <small style={{ color: "#64748b", lineHeight: 1.4 }}>
            Para mover ou ajustar um texto específico com a S Pen, selecione-o com o laço. Os controles A−/A+ e as setas ajustam o texto selecionado.
          </small>
        </div>
      )}
    </aside>
  );
}
