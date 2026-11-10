"use client";

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  deleteMediaFile,
  extFromFile,
  formatTime,
  loadPos,
  loadRate,
  mediaErrorMessage,
  moveBlock,
  pauseOthers,
  savePos,
  saveRate,
  uploadMedia,
} from "@/lib/media";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Player de áudio nativo (<audio>) com controles próprios: tocar/pausar, ±10 s, barra de posição e velocidade.
// Lembra onde você parou e a velocidade preferida neste aparelho.
export default function AudioView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  const title = String(node.attrs.title ?? "");
  const description = String(node.attrs.description ?? "");
  const storedDuration = Number(node.attrs.duration) || 0;
  const editable = editor.isEditable;

  const audioRef = useRef<HTMLAudioElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const lastSaved = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  // Áudios gravados no navegador às vezes informam duração infinita; nesse caso vale a duração guardada na gravação.
  const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : storedDuration;

  useEffect(() => {
    setRate(loadRate());
  }, []);

  useEffect(() => {
    setTime(loadPos(url));
    setPlaying(false);
    setError(null);
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) savePos(url, audio.ended ? 0 : audio.currentTime);
    },
    [url]
  );

  function onLoaded() {
    const audio = audioRef.current;
    if (!audio) return;
    setMediaDuration(audio.duration);
    audio.playbackRate = rate;
    const saved = loadPos(url);
    if (saved > 0 && (!Number.isFinite(audio.duration) || saved < audio.duration - 2)) {
      audio.currentTime = saved;
      setTime(saved);
    }
  }

  function onTime() {
    const audio = audioRef.current;
    if (!audio) return;
    setTime(audio.currentTime);
    const now = Date.now();
    if (now - lastSaved.current > 2000) {
      lastSaved.current = now;
      savePos(url, audio.currentTime);
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      pauseOthers(audio);
      audio.playbackRate = rate;
      audio.play().catch(() => setError("Não foi possível reproduzir este áudio."));
    } else {
      audio.pause();
    }
  }

  function seek(target: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = duration > 0 ? duration : Math.max(target, 0);
    const next = Math.max(0, Math.min(max, target));
    audio.currentTime = next;
    setTime(next);
    savePos(url, next);
  }

  function changeRate(next: number) {
    setRate(next);
    saveRate(next);
  }

  function move(dir: -1 | 1) {
    const pos = getPos();
    if (typeof pos === "number") moveBlock(editor, pos, dir);
  }

  async function replaceFile(file: File | undefined) {
    if (!file) return;
    setBusy("Enviando o novo arquivo…");
    setError(null);
    try {
      const next = await uploadMedia(file, extFromFile(file));
      const old = url;
      updateAttributes({ url: next, recorded: false, duration: 0 });
      savePos(old, 0);
      void deleteMediaFile(old);
      setMenu(false);
    } catch (cause) {
      setError(mediaErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Excluir este áudio? O arquivo também será apagado do armazenamento.")) return;
    setBusy("Excluindo…");
    savePos(url, 0);
    await deleteMediaFile(url);
    deleteNode();
  }

  const sliderMax = duration > 0 ? duration : Math.max(time, 1);

  return (
    <NodeViewWrapper className="mm-block mm-audio" contentEditable={false} data-media="audio">
      <div className="mm-head">
        <span className="mm-icon" aria-hidden="true">🎧</span>
        {editable ? (
          <input
            className="mm-title"
            value={title}
            placeholder="Título do áudio"
            aria-label="Título do áudio"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
        ) : (
          <strong className="mm-title-text">{title || "Áudio"}</strong>
        )}
        {editable && (
          <div className="mm-actions">
            <button type="button" className="mm-btn" aria-label="Mover para cima" onClick={() => move(-1)}>↑</button>
            <button type="button" className="mm-btn" aria-label="Mover para baixo" onClick={() => move(1)}>↓</button>
            <button type="button" className={menu ? "mm-btn on" : "mm-btn"} aria-label="Mais opções" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>⋯</button>
          </div>
        )}
      </div>

      {editable && menu && (
        <div className="mm-menu">
          <button type="button" className="mm-btn" onClick={() => replaceInput.current?.click()}>Substituir arquivo</button>
          <a className="mm-btn" href={url} target="_blank" rel="noopener noreferrer">Abrir / baixar ↗</a>
          <button type="button" className="mm-btn danger" onClick={() => void remove()}>Excluir</button>
        </div>
      )}

      {editable ? (
        <textarea
          className="mm-desc"
          rows={1}
          value={description}
          placeholder="Descrição ou o que você quer lembrar ao ouvir (opcional)"
          aria-label="Descrição do áudio"
          onChange={(e) => updateAttributes({ description: e.target.value })}
        />
      ) : description ? (
        <p className="mm-desc-text">{description}</p>
      ) : null}

      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (audio) setMediaDuration(audio.duration);
        }}
        onTimeUpdate={onTime}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          const audio = audioRef.current;
          if (audio) savePos(url, audio.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
          savePos(url, 0);
        }}
        onError={() => setError("Não foi possível carregar este áudio. O arquivo pode ter sido apagado ou o formato não é aceito neste navegador.")}
      />

      <div className="mm-player">
        <button type="button" className="mm-play" aria-label={playing ? "Pausar" : "Reproduzir"} onClick={toggle}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" className="mm-btn" aria-label="Voltar 10 segundos" onClick={() => seek(time - 10)}>−10 s</button>
        <button type="button" className="mm-btn" aria-label="Avançar 10 segundos" onClick={() => seek(time + 10)}>+10 s</button>
        <select className="mm-rate" aria-label="Velocidade de reprodução" value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>{r}×</option>
          ))}
        </select>
      </div>
      <div className="mm-seek">
        <span className="mm-time">{formatTime(time)}</span>
        <input
          type="range"
          className="mm-range"
          min={0}
          max={sliderMax}
          step={0.1}
          value={Math.min(time, sliderMax)}
          aria-label="Posição do áudio"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="mm-time">{duration > 0 ? formatTime(duration) : "--:--"}</span>
      </div>

      {busy && <p className="mm-note">{busy}</p>}
      {error && <p className="mm-error">{error}</p>}
      <input
        ref={replaceInput}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.opus,.flac,.webm"
        hidden
        onChange={(e) => {
          void replaceFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </NodeViewWrapper>
  );
}
