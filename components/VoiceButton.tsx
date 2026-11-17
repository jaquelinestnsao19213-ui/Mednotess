"use client";

import { useEffect, useRef, useState } from "react";

// Ditado por voz (reconhecimento de fala do navegador, em português). Funciona no Chrome/Edge e no Safari.
type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { results: ArrayLike<SpeechResultLike> };
type SpeechErrorLike = { error: string };
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognizerCtor = new () => Recognizer;

function getCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "O navegador bloqueou o microfone. Toque no cadeado ao lado do endereço do site e permita o microfone.",
  "service-not-allowed": "O navegador bloqueou o microfone. Toque no cadeado ao lado do endereço do site e permita o microfone.",
  "audio-capture": "Não encontrei um microfone neste aparelho.",
  network: "Sem conexão para reconhecer a voz. Confira a internet e tente de novo.",
  "no-speech": "Não ouvi nada. Toque no microfone e fale de novo.",
};

/**
 * Botão de microfone: toque para falar, toque de novo para parar.
 * O que você fala aparece no campo de texto (value) em tempo real, depois do que já estava escrito.
 */
export default function VoiceButton({
  value,
  onChange,
  disabled = false,
  onStatus,
  className = "pa-icon",
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  onStatus?: (message: string | null) => void;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognizer | null>(null);
  const wantRef = useRef(false); // a pessoa ainda quer ditar (não tocou em parar)
  const gotRef = useRef(false); // já chegou fala nesta rodada
  const errorRef = useRef(false);
  const baseRef = useRef("");
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => {
      wantRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  function stop() {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }

  // enviar a mensagem (ou a assistente responder) encerra o ditado
  useEffect(() => {
    if (disabled && wantRef.current) stop();
  }, [disabled]);

  function begin() {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false; // reinicia sozinho enquanto a pessoa continua falando (mais estável no celular e no tablet)
    rec.maxAlternatives = 1;
    baseRef.current = valueRef.current;
    gotRef.current = false;

    rec.onresult = (event) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) spoken += event.results[i][0].transcript;
      spoken = spoken.trim();
      if (!spoken) return;
      gotRef.current = true;
      const base = baseRef.current;
      onChangeRef.current(`${base}${base && !/\s$/.test(base) ? " " : ""}${spoken}`);
    };
    rec.onerror = (event) => {
      if (event.error === "aborted") return;
      errorRef.current = true;
      onStatusRef.current?.(ERRORS[event.error] ?? "Não consegui usar o microfone agora. Tente de novo.");
    };
    rec.onend = () => {
      if (wantRef.current && gotRef.current && !errorRef.current) {
        // houve fala e ela não parou: continua ouvindo, a partir do que já está escrito
        try {
          begin();
          return;
        } catch {
          /* cai no encerramento abaixo */
        }
      }
      wantRef.current = false;
      setListening(false);
    };

    try {
      rec.start();
    } catch {
      wantRef.current = false;
      setListening(false);
    }
  }

  function toggle() {
    if (listening) {
      stop();
      return;
    }
    errorRef.current = false;
    onStatusRef.current?.(null);
    wantRef.current = true;
    setListening(true);
    begin();
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`${className}${listening ? " rec" : ""}`}
      aria-label={listening ? "Parar de ouvir" : "Falar com a Maria (ditar por voz)"}
      aria-pressed={listening}
      title={listening ? "Parar de ouvir" : "Falar (ditar por voz)"}
      disabled={disabled}
      onClick={toggle}
    >
      {listening ? "⏹" : "🎤"}
    </button>
  );
}
