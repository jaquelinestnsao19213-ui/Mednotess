"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor as TipEditor } from "@tiptap/core";

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = "mednotes:listen-rate";

// Divide o texto em pedaços curtos: o navegador corta falas muito longas e assim dá para pausar e retomar.
function chunk(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const clean = para.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const sentences = clean.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [clean];
    let buf = "";
    for (const s of sentences) {
      if (buf && (buf + s).length > 220) {
        out.push(buf.trim());
        buf = "";
      }
      buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === "pt-br") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("pt")) ??
    null
  );
}

// Lê a página em voz alta com a voz do próprio aparelho (grátis, sem gastar a API).
// Se houver texto selecionado, lê só a seleção; senão, a página inteira.
export default function ListenPage({ editor }: { editor: TipEditor }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [rate, setRate] = useState(1);
  const [progress, setProgress] = useState("");

  const chunks = useRef<string[]>([]);
  const index = useRef(0);
  const run = useRef(0); // identifica a leitura atual; leituras antigas são ignoradas
  const rateRef = useRef(1);
  rateRef.current = rate;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    try {
      const saved = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(saved)) setRate(saved);
    } catch {
      // sem acesso ao armazenamento: fica na velocidade normal
    }
    return () => {
      run.current += 1;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function speakCurrent() {
    const id = ++run.current;
    const synth = window.speechSynthesis;
    synth.cancel();
    const text = chunks.current[index.current];
    if (text === undefined) {
      setState("idle");
      setProgress("");
      return;
    }
    setProgress(`${index.current + 1}/${chunks.current.length}`);
    // o Chrome ignora um speak() logo depois de cancel(); a pequena espera evita isso
    window.setTimeout(() => {
      if (id !== run.current) return;
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      u.lang = voice?.lang ?? "pt-BR";
      if (voice) u.voice = voice;
      u.rate = rateRef.current;
      u.onend = () => {
        if (id !== run.current) return;
        index.current += 1;
        speakCurrent();
      };
      u.onerror = (ev) => {
        if (id !== run.current || ev.error === "canceled" || ev.error === "interrupted") return;
        setState("idle");
        setProgress("");
      };
      synth.speak(u);
    }, 60);
  }

  function start() {
    const { from, to, empty } = editor.state.selection;
    const text = empty
      ? editor.getText({ blockSeparator: "\n" })
      : editor.state.doc.textBetween(from, to, "\n");
    const parts = chunk(text);
    if (!parts.length) {
      setProgress("Nada escrito para ouvir.");
      window.setTimeout(() => setProgress(""), 2500);
      return;
    }
    chunks.current = parts;
    index.current = 0;
    setState("playing");
    speakCurrent();
  }

  function pause() {
    run.current += 1; // para o pedaço atual; ao continuar ele recomeça do início
    window.speechSynthesis.cancel();
    setState("paused");
  }

  function resume() {
    setState("playing");
    speakCurrent();
  }

  function stop() {
    run.current += 1;
    window.speechSynthesis.cancel();
    setState("idle");
    setProgress("");
  }

  function changeRate(next: number) {
    setRate(next);
    rateRef.current = next;
    try {
      localStorage.setItem(RATE_KEY, String(next));
    } catch {
      // ignora
    }
    if (state === "playing") speakCurrent();
  }

  if (!supported) return null;

  return (
    <div className="mm-listen" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: "0 0 8px" }}>
      {state === "idle" && (
        <button type="button" className="chip" onClick={start}>🔊 Ouvir a página</button>
      )}
      {state === "playing" && (
        <button type="button" className="chip on" onClick={pause}>❚❚ Pausar</button>
      )}
      {state === "paused" && (
        <button type="button" className="chip on" onClick={resume}>▶ Continuar</button>
      )}
      {state !== "idle" && (
        <button type="button" className="chip" onClick={stop}>■ Parar</button>
      )}
      <select
        className="chip"
        aria-label="Velocidade da leitura"
        value={rate}
        onChange={(e) => changeRate(Number(e.target.value))}
      >
        {RATES.map((r) => (
          <option key={r} value={r}>{r}×</option>
        ))}
      </select>
      {progress && <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{progress}</span>}
    </div>
  );
}
