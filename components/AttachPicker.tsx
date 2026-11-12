"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { ATTACH_ACCEPT, type Attachment, extensionLabel, humanSize, isDuplicate, prepareAttachment } from "@/lib/attachments";
import { DRIVE_MIME, DRIVE_NOT_CONFIGURED, DriveError, type DriveProgress, driveConfig, pickFromDrive } from "@/lib/google-drive";

type Busy = { id: string; name: string; label: string };

/**
 * Anexar arquivos de estudo (PDF, Word, PowerPoint, Excel, texto e imagens), do aparelho ou do Google Drive.
 * Mostra cada arquivo com nome, formato e tamanho, o andamento do envio e permite remover antes de gerar.
 */
export default function AttachPicker({
  items,
  setItems,
  max = 10,
  disabled = false,
  onBusyChange,
  hint,
}: {
  items: Attachment[];
  setItems: Dispatch<SetStateAction<Attachment[]>>;
  max?: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  hint?: string;
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const deviceInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const driveAbort = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const working = busy.length > 0 || driveStatus !== null;
  useEffect(() => onBusyChange?.(working), [working, onBusyChange]);

  // fecha o menu ao tocar fora dele ou apertar Esc
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const addProblem = (message: string) => setProblems((current) => [...current.filter((m) => m !== message), message].slice(-5));

  async function addFiles(files: File[], origin: "device" | "drive") {
    setDone(null);
    let ok = 0;
    const known = [...itemsRef.current];
    let room = max - known.length - busy.length;
    const queue: File[] = [];
    for (const file of files) {
      if (isDuplicate(known, file) || queue.some((q) => q.name === file.name && q.size === file.size)) {
        addProblem(`“${file.name}” já está anexado.`);
      } else if (room <= 0) {
        addProblem(`“${file.name}” ficou de fora: o limite é de ${max} arquivos por geração.`);
      } else {
        queue.push(file);
        room -= 1;
      }
    }
    const marks = queue.map((file) => ({ id: crypto.randomUUID(), name: file.name, label: "Enviando…" }));
    setBusy((current) => [...current, ...marks]);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= queue.length) return;
        const file = queue[index];
        const mark = marks[index];
        try {
          const attachment = await prepareAttachment(file, origin);
          setItems((current) => (isDuplicate(current, attachment) ? current : [...current, attachment]));
          ok += 1;
        } catch (cause) {
          addProblem(cause instanceof Error ? cause.message : `Não consegui enviar “${file.name}”.`);
        } finally {
          setBusy((current) => current.filter((b) => b.id !== mark.id));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    if (ok) setDone(ok === 1 ? "1 arquivo pronto." : `${ok} arquivos prontos.`);
  }

  async function chooseDevice(picked: File[]) {
    setMenu(false);
    if (!picked.length) return;
    setProblems([]);
    await addFiles(picked, "device");
  }

  async function chooseDrive() {
    setMenu(false);
    setProblems([]);
    setDone(null);
    if (!driveConfig()) return addProblem(DRIVE_NOT_CONFIGURED);
    const controller = new AbortController();
    driveAbort.current = controller;
    setDriveStatus("Conectando ao Google Drive…");
    try {
      const result = await pickFromDrive({
        mimeTypes: [...DRIVE_MIME.study],
        signal: controller.signal,
        onProgress: (p: DriveProgress) => {
          const pct = p.total > 0 ? ` ${Math.min(100, Math.round((p.done / p.total) * 100))}%` : "";
          setDriveStatus(`Baixando do Drive (${p.fileIndex + 1} de ${p.fileCount}): ${p.name}${pct}`);
        },
      });
      setDriveStatus(null);
      for (const failure of result.failures) addProblem(failure.message);
      if (result.files.length) await addFiles(result.files, "drive");
    } catch (cause) {
      setDriveStatus(null);
      if (cause instanceof DriveError && cause.kind === "cancelled") return;
      addProblem(cause instanceof Error ? cause.message : "Não consegui acessar o Google Drive agora.");
    } finally {
      driveAbort.current = null;
      setDriveStatus(null);
    }
  }

  const full = items.length + busy.length >= max;

  return (
    <div className="ap-root" ref={rootRef}>
      <div className="ap-bar">
        <button type="button" className="ap-add" aria-haspopup="menu" aria-expanded={menu} disabled={disabled || full || driveStatus !== null} onClick={() => setMenu((open) => !open)}>
          ＋ Adicionar arquivos
        </button>
        <span className="ap-count">{items.length ? `${items.length} anexado${items.length > 1 ? "s" : ""}` : `até ${max} arquivos`}</span>
        {menu && (
          <div className="ap-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => deviceInput.current?.click()}>
              <b>📱 Deste dispositivo</b>
              <small>PDF, Word, PowerPoint, Excel, texto ou imagem</small>
            </button>
            <button type="button" role="menuitem" onClick={() => void chooseDrive()}>
              <b>☁️ Google Drive</b>
              <small>Navegue pelas pastas e escolha vários arquivos</small>
            </button>
          </div>
        )}
        <input ref={deviceInput} type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void chooseDevice(picked); }} />
      </div>

      {hint && <p className="ap-hint">{hint}</p>}

      {driveStatus && (
        <div className="ap-status" role="status">
          <span className="ap-spin" aria-hidden="true" />
          <span>{driveStatus}</span>
          <button type="button" className="ap-link" onClick={() => driveAbort.current?.abort()}>cancelar</button>
        </div>
      )}

      {(items.length > 0 || busy.length > 0) && (
        <ul className="ap-list" aria-label="Arquivos anexados">
          {items.map((item) => (
            <li key={item.id} className="ap-item">
              <span className={`ap-badge ${item.kind}`}>{extensionLabel(item.name)}</span>
              <span className="ap-name" title={item.name}>{item.name}</span>
              <span className="ap-meta">
                {[humanSize(item.size), item.origin === "drive" ? "Drive" : ""].filter(Boolean).join(" · ")}
                <span className="ap-ok" aria-label="pronto"> ✓</span>
              </span>
              <button type="button" className="ap-remove" aria-label={`Remover ${item.name}`} disabled={disabled} onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))}>✕</button>
            </li>
          ))}
          {busy.map((item) => (
            <li key={item.id} className="ap-item busy">
              <span className="ap-spin" aria-hidden="true" />
              <span className="ap-name" title={item.name}>{item.name}</span>
              <span className="ap-meta">{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {done && !working && <p className="ap-done">✓ {done}</p>}
        {problems.map((message) => (
          <p key={message} className="ap-problem" role="alert">{message}</p>
        ))}
      </div>
    </div>
  );
}
