"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const MAX_AUDIO_BYTES = 4_000_000;

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export default function MeetingNotesPage() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    "Organize as anotações como material de estudo, destacando conceitos, exemplos, decisões e dúvidas."
  );
  const [consent, setConsent] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!recording) return;

    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function clearAudio() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setSeconds(0);
  }

  async function startRecording() {
    if (!consent || recording || processing) return;

    setError(null);
    setTranscript("");
    setSummary("");
    clearAudio();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Seu navegador não permite gravação de áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const supportedType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));

      const recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (!blob.size) {
          setError("Nenhum áudio foi capturado. Verifique o microfone.");
          return;
        }

        if (blob.size > MAX_AUDIO_BYTES) {
          setError("A gravação passou de 4 MB. Faça gravações menores.");
          return;
        }

        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setRecording(true);
    } catch {
      setError(
        "Não foi possível acessar o microfone. Permita o acesso nas configurações do navegador."
      );
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }

    setRecording(false);
  }

  async function processMeeting() {
    if (!audioBlob || processing) return;

    setProcessing(true);
    setError(null);
    setTranscript("");
    setSummary("");
    setStatus("Enviando áudio para transcrição…");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Sua sessão expirou. Entre novamente.");
      }

      const form = new FormData();
      const extension = audioBlob.type.includes("mp4")
        ? "m4a"
        : audioBlob.type.includes("ogg")
          ? "ogg"
          : "webm";

      form.append("audio", audioBlob, `reuniao.${extension}`);
      form.append("prompt", prompt);

      setStatus("Transcrevendo e organizando suas anotações com IA…");

      const response = await fetch("/api/meeting/process", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: form,
      });

      const result = (await response.json()) as { error?: string; transcript?: string; summary?: string };

      if (!response.ok) {
        throw new Error(result.error || "Não foi possível processar.");
      }

      setTranscript(result.transcript ?? "");
      setSummary(result.summary ?? "");
      setStatus("Transcrição e resumo concluídos!");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ocorreu um erro. Tente novamente.");
      setStatus("");
    } finally {
      setProcessing(false);
    }
  }

  async function copyResult() {
    const text =
      "TRANSCRIÇÃO\n\n" +
      transcript +
      "\n\nANOTAÇÕES IA\n\n" +
      summary;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente.");
    }
  }

  function downloadResult() {
    const content =
      "# Transcrição da reunião\n\n" +
      transcript +
      "\n\n# Anotações IA\n\n" +
      summary;

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "anotacoes-reuniao.md";
    anchor.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="meeting-page">
      <nav className="crumbs" aria-label="Caminho">
        <Link href="/">Início</Link>
        <span className="sep">/</span>
        <span>Anotações IA</span>
      </nav>

      <header className="meeting-heading">
        <span className="meeting-eyebrow">MEDNOTES · INTELIGÊNCIA ARTIFICIAL</span>
        <h1 className="display">Anotações IA para reuniões</h1>
        <p>
          Grave uma aula ou reunião e transforme a conversa em transcrição e
          anotações organizadas.
        </p>
      </header>

      <section className="meeting-card">
        <div className="meeting-card-heading">
          <div>
            <span className="meeting-step">ETAPA 1</span>
            <h2>Gravação de áudio</h2>
            <p>
              Grave usando o microfone do dispositivo. Você poderá ouvir o áudio
              antes de processá-lo.
            </p>
          </div>

          <span className={recording ? "meeting-live" : "meeting-ready"}>
            <i />
            {recording ? "Gravando" : "Pronto"}
          </span>
        </div>

        <div className={recording ? "meeting-recorder is-recording" : "meeting-recorder"}>
          <div className="meeting-wave">
            {Array.from({ length: 30 }, (_, index) => (
              <span key={index} style={{ animationDelay: `${index * 0.055}s` }} />
            ))}
          </div>

          <strong className="meeting-timer">{formatTime(seconds)}</strong>

          <p>
            {recording
              ? "Microfone ativo. Fale normalmente."
              : audioBlob
                ? "Gravação pronta para transcrição."
                : "Aguardando início da gravação."}
          </p>

          {recording ? (
            <button type="button" className="meeting-stop" onClick={stopRecording}>
              ■ Encerrar gravação
            </button>
          ) : (
            <button
              type="button"
              className="primary meeting-start"
              onClick={startRecording}
              disabled={!consent || processing}
            >
              ● Iniciar gravação
            </button>
          )}
        </div>

        <label className="meeting-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={recording || processing}
          />
          <span>
            Confirmo que tenho autorização das pessoas envolvidas para gravar e
            processar este áudio.
          </span>
        </label>

        {!consent && (
          <p className="meeting-hint">Confirme a autorização para habilitar a gravação.</p>
        )}

        {audioUrl && (
          <div className="meeting-audio-preview">
            <label htmlFor="meeting-audio">Ouvir gravação</label>
            <audio id="meeting-audio" controls src={audioUrl} />
            <button type="button" className="secondary" onClick={clearAudio}>
              Descartar áudio
            </button>
          </div>
        )}
      </section>

      <section className="meeting-card">
        <span className="meeting-step">ETAPA 2</span>
        <h2>Como organizar o conteúdo?</h2>
        <p>Personalize o foco do resumo que será gerado pela IA.</p>

        <label className="meeting-prompt-label" htmlFor="meeting-prompt">
          Instrução personalizada
        </label>

        <textarea
          id="meeting-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={3000}
          rows={4}
          disabled={processing}
          placeholder="Ex.: destaque conceitos, exemplos clínicos, decisões e tarefas…"
        />

        <button
          type="button"
          className="primary meeting-process"
          onClick={processMeeting}
          disabled={!audioBlob || processing}
        >
          {processing ? "Processando…" : "Transcrever e gerar anotações"}
        </button>

        {processing && (
          <p className="meeting-status" role="status">
            <span className="meeting-spinner" />
            {status}
          </p>
        )}

        {!processing && status && (
          <p className="meeting-status" role="status">
            {status}
          </p>
        )}

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}

        <p className="meeting-hint">
          Limite inicial: 4 MB por gravação. Para reuniões longas, grave em trechos
          menores.
        </p>
      </section>

      {(transcript || summary) && (
        <section className="meeting-card meeting-results">
          <div className="meeting-results-heading">
            <div>
              <span className="meeting-step">ETAPA 3</span>
              <h2>Resultado da reunião</h2>
            </div>

            <div className="row">
              <button type="button" className="secondary" onClick={copyResult}>
                {copied ? "Copiado!" : "Copiar tudo"}
              </button>

              <button type="button" className="secondary" onClick={downloadResult}>
                Baixar .md
              </button>
            </div>
          </div>

          {summary && (
            <article className="meeting-summary">
              <h3>Anotações organizadas pela IA</h3>
              <div className="meeting-output">{summary}</div>
            </article>
          )}

          {transcript && (
            <details className="meeting-transcript" open>
              <summary>Transcrição completa</summary>
              <div className="meeting-output">{transcript}</div>
            </details>
          )}

          <p className="meeting-hint">
            Revise nomes, números e decisões importantes antes de utilizar as
            anotações como registro oficial.
          </p>
        </section>
      )}

      <p className="meeting-privacy">
        Privacidade: o áudio é enviado à OpenAI para transcrição e o texto à
        Anthropic para organização. O aplicativo não salva automaticamente o áudio
        nem o resultado no banco de dados.
      </p>
    </div>
  );
}
