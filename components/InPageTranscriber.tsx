"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type ChunkState = { index: number; status: "enviando" | "concluído" | "falha" };
type Props = {
  pageTitle: string;
  pageContext: string;
  onInsert: (markdown: string) => void;
};

const SEGMENT_MS = 45_000;
const MAX_RECORDING_SECONDS = 4 * 60 * 60;
const DEFAULT_PROMPT = "Organize como material de estudo. Priorize resumo geral, conceitos fundamentais, explicações detalhadas, exemplos do professor, classificações e diferenças, pontos para memorizar e dúvidas para revisar.";

function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${rest}`;
}

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

export default function InPageTranscriber({ pageTitle, pageContext, onInsert }: Props) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [panelOpen, setPanelOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkState[]>([]);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partsRef = useRef<Blob[]>([]);
  const segmentTimerRef = useRef<number | null>(null);
  const recordingWantedRef = useRef(false);
  const segmentIndexRef = useRef(0);
  const transcriptPartsRef = useRef<Map<number, string>>(new Map());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const stopResolverRef = useRef<(() => void) | null>(null);
  const failedRef = useRef<number[]>([]);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value + 1 >= MAX_RECORDING_SECONDS) {
          window.clearInterval(timer);
          void stopAndProcess();
          return value + 1;
        }
        return value + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // stopAndProcess reads refs and state only after the user-visible limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, paused]);

  useEffect(() => () => {
    if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
    recordingWantedRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente.");
    return session.access_token;
  }

  async function sendChunk(index: number, blob: Blob) {
    const next = (state: ChunkState[]) => {
      const found = state.some((item) => item.index === index);
      return found
        ? state.map((item) => item.index === index ? { ...item, status: "enviando" as const } : item)
        : [...state, { index, status: "enviando" as const }];
    };
    setChunks(next);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const token = await getAccessToken();
        const form = new FormData();
        form.append("audio", blob, `aula-${index}.${extensionFor(blob.type)}`);
        const response = await fetch("/api/meeting/chunk", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
          cache: "no-store",
        });
        const result = await response.json() as { error?: string; transcript?: string };
        if (!response.ok) {
          const failure = new Error(result.error || "Falha ao transcrever um bloco.");
          if (response.status < 500 && response.status !== 429) throw failure;
          throw failure;
        }
        if (!result.transcript?.trim()) throw new Error("Nenhuma fala foi identificada neste bloco.");
        transcriptPartsRef.current.set(index, result.transcript.trim());
        setChunks((state) => state.map((item) => item.index === index ? { ...item, status: "concluído" } : item));
        return;
      } catch (cause) {
        lastError = cause instanceof Error ? cause : new Error("Falha na conexão.");
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 600 * 2 ** attempt));
      }
    }

    failedRef.current = [...failedRef.current, index];
    setChunks((state) => state.map((item) => item.index === index ? { ...item, status: "falha" } : item));
    throw lastError ?? new Error("Não foi possível enviar o bloco.");
  }

  function enqueueChunk(index: number, blob: Blob) {
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(() => sendChunk(index, blob))
      .catch(() => undefined);
  }

  function startSegment(stream: MediaStream) {
    if (!recordingWantedRef.current) return;
    const supportedType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
    partsRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) partsRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
      const blob = new Blob(partsRef.current, { type: recorder.mimeType || "audio/webm" });
      partsRef.current = [];
      if (blob.size) {
        const index = ++segmentIndexRef.current;
        enqueueChunk(index, blob);
      }

      if (recordingWantedRef.current) {
        // Rotate to a new self-contained media file without asking the user to restart.
        startSegment(stream);
      } else {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        stopResolverRef.current?.();
        stopResolverRef.current = null;
      }
    };
    recorder.start();
    segmentTimerRef.current = window.setTimeout(() => {
      if (recordingWantedRef.current && recorder.state === "recording") recorder.stop();
    }, SEGMENT_MS);
  }

  async function startRecording() {
    if (!consent || recording || processing) return;
    setError(null);
    setStatus("");
    setTranscript("");
    setSummary("");
    setChunks([]);
    setSeconds(0);
    segmentIndexRef.current = 0;
    transcriptPartsRef.current = new Map();
    failedRef.current = [];
    queueRef.current = Promise.resolve();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não permite gravação de áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingWantedRef.current = true;
      startSegment(stream);
      setRecording(true);
      setPaused(false);
      setPanelOpen(true);
    } catch {
      setError("Não foi possível acessar o microfone. Permita o acesso nas configurações do navegador.");
    }
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setPaused(false);
    }
  }

  async function stopAndProcess() {
    if (!recording || processing) return;
    setRecording(false);
    setPaused(false);
    setProcessing(true);
    setError(null);
    recordingWantedRef.current = false;
    setStatus("Finalizando o último bloco…");
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        stopResolverRef.current = resolve;
        recorder.stop();
      });
    } else {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setStatus("Transcrevendo os blocos em ordem…");
    await queueRef.current;
    if (failedRef.current.length) {
      setProcessing(false);
      setError(`Não foi possível processar os blocos ${failedRef.current.join(", ")}. Use “Tentar novamente” antes de gerar as anotações.`);
      setStatus("");
      return;
    }

    const fullTranscript = Array.from(transcriptPartsRef.current.entries())
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join("\n\n");
    if (!fullTranscript) {
      setProcessing(false);
      setError("Nenhuma fala foi identificada. Tente gravar novamente.");
      setStatus("");
      return;
    }
    setTranscript(fullTranscript);
    setStatus("Organizando as anotações com Claude…");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/meeting/organize", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: fullTranscript, prompt, pageTitle, pageContext }),
        cache: "no-store",
      });
      const result = await response.json() as { error?: string; summary?: string };
      if (!response.ok || !result.summary) throw new Error(result.error || "Não foi possível organizar as anotações.");
      setSummary(result.summary);
      setStatus("Transcrição e anotações prontas para revisão.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ocorreu um erro ao organizar as anotações.");
      setStatus("");
    } finally {
      setProcessing(false);
    }
  }

  async function retryFailed() {
    const failed = [...failedRef.current];
    if (!failed.length || processing) return;
    setProcessing(true);
    setError(null);
    failedRef.current = [];
    setStatus("Tentando reenviar os blocos que falharam…");
    // Audio is intentionally not persisted by the app. A failed chunk cannot be retried
    // after its in-memory request has ended; let the user know rather than pretending.
    failedRef.current = failed;
    setProcessing(false);
    setError("Por privacidade, o áudio do bloco é descartado após a tentativa. Para reenviar, grave novamente; nenhum áudio foi salvo no Mednotes.");
    setStatus("");
  }

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar automaticamente.");
    }
  }

  function downloadMarkdown() {
    const content = `# ${pageTitle || "Anotações da aula"}\n\n${summary}\n\n## Transcrição\n\n${transcript}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "anotacoes-aula.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadPdf() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setError("O navegador bloqueou a janela de impressão. Permita pop-ups para baixar em PDF.");
      return;
    }
    const escaped = summary.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
    printWindow.document.write(`<html lang="pt-BR"><head><title>Anotações</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:40px auto;white-space:pre-wrap}</style></head><body><h1>${pageTitle || "Anotações da aula"}</h1><main>${escaped}</main><script>window.print();</script></body></html>`);
    printWindow.document.close();
  }

  const completeCount = chunks.filter((item) => item.status === "concluído").length;

  return (
    <section className="inpage-ai" aria-label="Assistente e transcrição IA">
      <div className="inpage-ai-bar">
        <button type="button" className="inpage-ai-search" aria-label="Abrir opções de IA" onClick={() => setPanelOpen((open) => !open)}>⌕</button>
        <span className="inpage-ai-spark" aria-hidden="true">✦</span>
        <input
          aria-label="Instrução para a inteligência artificial"
          placeholder="Peça à IA"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onFocus={() => setPanelOpen(true)}
          disabled={processing || recording}
        />
        <button type="button" className={recording ? "inpage-ai-mic is-recording" : "inpage-ai-mic"} aria-label={recording ? "Gravando aula" : "Iniciar transcrição da aula"} onClick={() => recording ? void stopAndProcess() : void startRecording()} disabled={processing || (!consent && !recording)}>
          {recording ? "■" : "🎙"}
        </button>
      </div>
      <div className="inpage-ai-caption">
        <span>IA nesta página</span>
        <button type="button" onClick={() => setPanelOpen((open) => !open)}>{panelOpen ? "Fechar" : "Transcrever aula"}</button>
      </div>

      {panelOpen && <div className="inpage-ai-panel">
        <div className="inpage-ai-panel-head">
          <div><strong>Transcrição da aula</strong><p>As anotações serão preparadas para a página “{pageTitle || "Sem título"}”.</p></div>
          <span className={recording ? "meeting-live" : "meeting-ready"}><i />{recording ? (paused ? "Pausada" : "Gravando") : processing ? "Processando" : "Pronto"}</span>
        </div>
        <label className="meeting-consent inpage-ai-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={recording || processing} />
          <span>Tenho autorização para gravar e processar as pessoas envolvidas.</span>
        </label>
        <div className={recording ? "inpage-ai-recorder is-recording" : "inpage-ai-recorder"}>
          <strong className="meeting-timer">{formatTime(seconds)}</strong>
          <span>{recording ? (paused ? "Gravação pausada" : "Gravando continuamente em blocos de até 45 s") : "A gravação não é armazenada no Mednotes."}</span>
          {recording && <div className="row">
            <button type="button" className="secondary" onClick={togglePause}>{paused ? "Continuar" : "Pausar"}</button>
            <button type="button" className="meeting-stop" onClick={() => void stopAndProcess()}>Encerrar e transcrever</button>
          </div>}
          {!recording && !processing && <button type="button" className="primary" disabled={!consent} onClick={() => void startRecording()}>Iniciar gravação</button>}
        </div>
        {(recording || processing || chunks.length > 0) && <div className="inpage-ai-progress" role="status">
          <span>{processing ? status : `${completeCount} bloco(s) transcrito(s)${recording ? " · novos blocos serão enviados automaticamente" : ""}`}</span>
          {chunks.map((chunk) => <span className={`inpage-ai-chunk ${chunk.status}`} key={chunk.index}>Bloco {chunk.index}: {chunk.status === "concluído" ? "concluído" : chunk.status === "falha" ? "falhou" : "enviando"}</span>)}
        </div>}
        {failedRef.current.length > 0 && <button type="button" className="secondary" onClick={() => void retryFailed()}>Tentar novamente</button>}
        {error && <p className="notice" role="alert">{error}</p>}
        <p className="meeting-privacy">Privacidade: os blocos de áudio são enviados à API da OpenAI para transcrição e descartados após o processamento; o texto é enviado à Anthropic/Claude para organização. Não armazenamos o áudio no banco nem criamos uma biblioteca de gravações. O processamento por terceiros segue suas próprias políticas de retenção.</p>
      </div>}

      {summary && <div className="inpage-ai-preview">
        <div className="inpage-ai-panel-head"><strong>Prévia das anotações</strong><span>{status}</span></div>
        <div className="meeting-output">{summary}</div>
        <details className="meeting-transcript"><summary>Revisar transcrição completa ({chunks.length} blocos)</summary><div className="meeting-output">{transcript}</div></details>
        <div className="row inpage-ai-actions">
          <button type="button" className="primary" onClick={() => onInsert(summary)}>Inserir no final da página</button>
          <button type="button" className="secondary" onClick={() => void copyNotes()}>{copied ? "Copiado!" : "Copiar anotações"}</button>
          <button type="button" className="secondary" onClick={downloadMarkdown}>Baixar Markdown</button>
          <button type="button" className="secondary" onClick={downloadPdf}>Baixar PDF</button>
        </div>
        <p className="meeting-hint">A inserção acrescenta as anotações ao conteúdo existente; a página e o caderno não são recriados.</p>
      </div>}
    </section>
  );
}
