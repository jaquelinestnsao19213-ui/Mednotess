"use client";

import { useEffect, useRef, useState } from "react";
import { extFromMime, formatTime, pickRecorderMime } from "@/lib/media";

type Phase = "idle" | "recording" | "paused" | "review" | "saving";

export type RecordingData = { blob: Blob; ext: string; title: string; description: string; duration: number };

// Gravador de voz usando o microfone do aparelho (MediaRecorder nativo do navegador). Nada é enviado
// para a IA: a gravação só vai para o seu armazenamento depois que você toca em Salvar.
export default function AudioRecorder({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: RecordingData) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Ao fechar o gravador: solta o microfone e libera a memória da prévia.
  useEffect(
    () => () => {
      stopTimer();
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          // já parado
        }
      }
      stopStream();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não permite gravar áudio direto no app. Grave no gravador do celular e use “Áudio (arquivo)”.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = () => {
        stopTimer();
        stopStream();
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
          setError("A gravação saiu vazia. Tente de novo.");
          setPhase("idle");
          return;
        }
        blobRef.current = blob;
        const objectUrl = URL.createObjectURL(blob);
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = objectUrl;
        setPreviewUrl(objectUrl);
        setPhase("review");
      };
      rec.onerror = () => setError("A gravação foi interrompida por um erro do navegador.");
      recRef.current = rec;
      elapsedRef.current = 0;
      setElapsed(0);
      rec.start(1000);
      timerRef.current = setInterval(() => {
        if (rec.state === "recording") {
          elapsedRef.current += 0.25;
          setElapsed(elapsedRef.current);
        }
      }, 250);
      setPhase("recording");
    } catch (cause) {
      stopStream();
      const name = cause instanceof DOMException ? cause.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("O navegador não liberou o microfone. Permita o acesso ao microfone nas configurações do site e tente de novo.");
      } else if (name === "NotFoundError") {
        setError("Nenhum microfone foi encontrado neste aparelho.");
      } else {
        setError("Não foi possível iniciar a gravação.");
      }
    }
  }

  function pause() {
    const rec = recRef.current;
    if (rec && rec.state === "recording") {
      rec.pause();
      setPhase("paused");
    }
  }

  function resume() {
    const rec = recRef.current;
    if (rec && rec.state === "paused") {
      rec.resume();
      setPhase("recording");
    }
  }

  function stop() {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function redo() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    blobRef.current = null;
    setPreviewUrl(null);
    elapsedRef.current = 0;
    setElapsed(0);
    setError(null);
    setPhase("idle");
  }

  async function save() {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase("saving");
    setError(null);
    try {
      await onSave({
        blob,
        ext: extFromMime(blob.type) || "webm",
        title: title.trim(),
        description: description.trim(),
        duration: Math.round(elapsedRef.current),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a gravação.");
      setPhase("review");
    }
  }

  function requestClose() {
    if (phase === "saving") return;
    if ((phase === "recording" || phase === "paused") && !window.confirm("Descartar a gravação em andamento?")) return;
    if (phase === "review" && !window.confirm("Descartar esta gravação sem salvar?")) return;
    onClose();
  }

  const live = phase === "recording" || phase === "paused";

  return (
    <div className="mm-modal" role="dialog" aria-modal="true" aria-label="Gravar áudio" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mm-modal-card">
        <div className="mm-modal-head">
          <strong>Gravar áudio</strong>
          <button type="button" className="mm-btn" aria-label="Fechar" onClick={requestClose}>✕</button>
        </div>

        {phase === "idle" && (
          <p className="mm-note">Toque em Gravar e explique o assunto com as suas palavras. Depois você ouve, dá um título e salva na página.</p>
        )}

        <div className={live ? "mm-rec-time live" : "mm-rec-time"} aria-live="off">
          {phase === "recording" && <span className="mm-dot" aria-hidden="true" />}
          {formatTime(elapsed)}
          {phase === "paused" && <span className="mm-note"> pausado</span>}
        </div>

        {phase === "idle" && (
          <div className="mm-rec-actions">
            <button type="button" className="mm-play wide" onClick={() => void start()}>● Gravar</button>
          </div>
        )}

        {live && (
          <div className="mm-rec-actions">
            {phase === "recording" ? (
              <button type="button" className="mm-btn" onClick={pause}>Pausar</button>
            ) : (
              <button type="button" className="mm-btn" onClick={resume}>Continuar</button>
            )}
            <button type="button" className="mm-play wide" onClick={stop}>■ Parar</button>
          </div>
        )}

        {(phase === "review" || phase === "saving") && previewUrl && (
          <>
            <audio className="mm-preview" src={previewUrl} controls preload="metadata" />
            <input
              className="mm-title boxed"
              value={title}
              placeholder="Título (ex.: Mecanismo da amoxicilina)"
              aria-label="Título da gravação"
              disabled={phase === "saving"}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="mm-desc boxed"
              rows={2}
              value={description}
              placeholder="Descrição (opcional)"
              aria-label="Descrição da gravação"
              disabled={phase === "saving"}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="mm-rec-actions">
              <button type="button" className="mm-btn" disabled={phase === "saving"} onClick={redo}>Regravar</button>
              <button type="button" className="mm-play wide" disabled={phase === "saving"} onClick={() => void save()}>
                {phase === "saving" ? "Salvando…" : "Salvar na página"}
              </button>
            </div>
            <a className="mm-note" href={previewUrl} download={`gravacao.${extFromMime(blobRef.current?.type) || "webm"}`}>
              Baixar uma cópia da gravação
            </a>
          </>
        )}

        {error && <p className="mm-error">{error}</p>}
      </div>
    </div>
  );
}
