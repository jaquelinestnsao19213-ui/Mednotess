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
  parseVideoLink,
  pauseOthers,
  savePos,
  saveRate,
  uploadMedia,
  vimeoInfo,
  youtubeInfo,
} from "@/lib/media";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Vídeo dentro da página: arquivo seu (player nativo) ou YouTube/Vimeo incorporado, sem sair do app.
export default function VideoView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const kind = String(node.attrs.kind ?? "file");
  const url = String(node.attrs.url ?? "");
  const title = String(node.attrs.title ?? "");
  const subject = String(node.attrs.subject ?? "");
  const description = String(node.attrs.description ?? "");
  const editable = editor.isEditable;

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const lastSaved = useRef(0);
  const [rate, setRate] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const yt = kind === "youtube" ? youtubeInfo(url) : null;
  const vm = kind === "vimeo" ? vimeoInfo(url) : null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedSrc = yt
    ? `https://www.youtube-nocookie.com/embed/${yt.id}?rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(origin)}${yt.start ? `&start=${yt.start}` : ""}`
    : vm
      ? `https://player.vimeo.com/video/${vm.id}${vm.hash ? `?h=${vm.hash}` : ""}`
      : "";
  const isFile = kind === "file";

  useEffect(() => {
    if (isFile) setRate(loadRate());
  }, [isFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
  }, [rate]);

  useEffect(
    () => () => {
      const video = videoRef.current;
      if (video) savePos(url, video.ended ? 0 : video.currentTime);
    },
    [url]
  );

  function onLoaded() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    video.playbackRate = rate;
    const saved = loadPos(url);
    if (saved > 0 && Number.isFinite(video.duration) && saved < video.duration - 2) {
      video.currentTime = saved;
      setTime(saved);
    }
  }

  function onTime() {
    const video = videoRef.current;
    if (!video) return;
    setTime(video.currentTime);
    const now = Date.now();
    if (now - lastSaved.current > 2000) {
      lastSaved.current = now;
      savePos(url, video.currentTime);
    }
  }

  function skip(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : video.currentTime + delta;
    video.currentTime = Math.max(0, Math.min(max, video.currentTime + delta));
  }

  function changeRate(next: number) {
    setRate(next);
    if (isFile) {
      saveRate(next);
      return;
    }
    // YouTube aceita o comando de velocidade por mensagem (o iframe usa enablejsapi=1).
    try {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setPlaybackRate", args: [next] }), "*");
    } catch {
      // se o navegador bloquear, a velocidade pode ser ajustada no próprio player
    }
  }

  function move(dir: -1 | 1) {
    const pos = getPos();
    if (typeof pos === "number") moveBlock(editor, pos, dir);
  }

  async function replaceFile(file: File | undefined) {
    if (!file) return;
    setBusy("Enviando o novo vídeo… arquivos grandes podem demorar um pouco.");
    setError(null);
    try {
      const next = await uploadMedia(file, extFromFile(file));
      const old = url;
      const wasFile = isFile;
      updateAttributes({ kind: "file", url: next });
      savePos(old, 0);
      if (wasFile) void deleteMediaFile(old);
      setMenu(false);
    } catch (cause) {
      setError(mediaErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function changeLink() {
    const raw = window.prompt("Cole o novo link do vídeo (YouTube, Vimeo ou arquivo .mp4):", url);
    if (raw === null) return;
    const parsed = parseVideoLink(raw);
    if (!parsed) {
      setError("Esse link não parece ser de um vídeo do YouTube, do Vimeo ou de um arquivo de vídeo.");
      return;
    }
    const old = url;
    const wasFile = isFile;
    updateAttributes({ kind: parsed.kind, url: parsed.url });
    if (wasFile && parsed.url !== old) {
      savePos(old, 0);
      void deleteMediaFile(old);
    }
    setError(null);
    setMenu(false);
  }

  async function remove() {
    const text = isFile
      ? "Excluir este vídeo? Se ele foi enviado por você, o arquivo também será apagado do armazenamento."
      : "Remover este vídeo da página?";
    if (!window.confirm(text)) return;
    setBusy("Excluindo…");
    savePos(url, 0);
    if (isFile) await deleteMediaFile(url);
    deleteNode();
  }

  const openUrl = yt ? `https://www.youtube.com/watch?v=${yt.id}${yt.start ? `&t=${yt.start}` : ""}` : url;
  const invalid = !isFile && !embedSrc;

  return (
    <NodeViewWrapper className="mm-block mm-video-block" contentEditable={false} data-media="video">
      <div className="mm-head">
        <span className="mm-icon" aria-hidden="true">🎬</span>
        {editable ? (
          <input
            className="mm-title"
            value={title}
            placeholder="Título do vídeo"
            aria-label="Título do vídeo"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
        ) : (
          <strong className="mm-title-text">{title || "Vídeo"}</strong>
        )}
        {editable && (
          <div className="mm-actions">
            <button type="button" className="mm-btn" aria-label="Mover para cima" onClick={() => move(-1)}>↑</button>
            <button type="button" className="mm-btn" aria-label="Mover para baixo" onClick={() => move(1)}>↓</button>
            <button type="button" className={menu ? "mm-btn on" : "mm-btn"} aria-label="Mais opções" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>⋯</button>
          </div>
        )}
      </div>

      {editable ? (
        <input
          className="mm-subject"
          value={subject}
          placeholder="Assunto (ex.: Farmacocinética)"
          aria-label="Assunto do vídeo"
          onChange={(e) => updateAttributes({ subject: e.target.value })}
        />
      ) : subject ? (
        <p className="mm-subject-text">{subject}</p>
      ) : null}

      {editable && menu && (
        <div className="mm-menu">
          <button type="button" className="mm-btn" onClick={() => replaceInput.current?.click()}>Substituir por arquivo</button>
          <button type="button" className="mm-btn" onClick={changeLink}>Trocar link</button>
          <a className="mm-btn" href={openUrl} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
          <button type="button" className="mm-btn danger" onClick={() => void remove()}>Excluir</button>
        </div>
      )}

      {editable ? (
        <textarea
          className="mm-desc"
          rows={1}
          value={description}
          placeholder="Descrição ou o que observar neste vídeo (opcional)"
          aria-label="Descrição do vídeo"
          onChange={(e) => updateAttributes({ description: e.target.value })}
        />
      ) : description ? (
        <p className="mm-desc-text">{description}</p>
      ) : null}

      {invalid ? (
        <p className="mm-error">
          Não consegui entender este link de vídeo. <a href={url} target="_blank" rel="noopener noreferrer">Abrir o link</a>
        </p>
      ) : isFile ? (
        <>
          <video
            ref={videoRef}
            className="mm-video"
            src={url}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTime}
            onPlay={() => {
              const video = videoRef.current;
              if (video) {
                pauseOthers(video);
                video.playbackRate = rate;
              }
            }}
            onPause={() => {
              const video = videoRef.current;
              if (video) savePos(url, video.currentTime);
            }}
            onEnded={() => savePos(url, 0)}
            onError={() => setError("Não foi possível carregar este vídeo. O arquivo pode ter sido apagado ou o formato não é aceito neste navegador (prefira .mp4).")}
          />
          <div className="mm-player">
            <button type="button" className="mm-btn" aria-label="Voltar 10 segundos" onClick={() => skip(-10)}>−10 s</button>
            <button type="button" className="mm-btn" aria-label="Avançar 10 segundos" onClick={() => skip(10)}>+10 s</button>
            <select className="mm-rate" aria-label="Velocidade de reprodução" value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>{r}×</option>
              ))}
            </select>
            <span className="mm-time">{formatTime(time)}{duration > 0 && Number.isFinite(duration) ? ` / ${formatTime(duration)}` : ""}</span>
          </div>
        </>
      ) : (
        <>
          <div className="mm-frame">
            <iframe
              ref={frameRef}
              src={embedSrc}
              title={title || "Vídeo"}
              data-yt={yt ? "1" : undefined}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="mm-player">
            {yt && (
              <select className="mm-rate" aria-label="Velocidade de reprodução" value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
                {RATES.map((r) => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </select>
            )}
            <a className="mm-btn" href={openUrl} target="_blank" rel="noopener noreferrer">Abrir no {yt ? "YouTube" : "Vimeo"} ↗</a>
          </div>
        </>
      )}

      {busy && <p className="mm-note">{busy}</p>}
      {error && <p className="mm-error">{error}</p>}
      <input
        ref={replaceInput}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm"
        hidden
        onChange={(e) => {
          void replaceFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </NodeViewWrapper>
  );
}
