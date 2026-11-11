// Salvamento automático com espera (debounce), nova tentativa em caso de falha e gravação imediata ao sair da tela.

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Junta várias alterações seguidas numa gravação só (depois de `delay` ms sem mexer).
 * Se falhar, mantém o último estado pendente e tenta de novo sozinho.
 */
export function createAutosaver<T>(save: (value: T) => Promise<void>, onStatus: (status: SaveStatus, error?: unknown) => void, delay = 1000, retryDelay = 5000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;

  const run = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending) {
        const job = pending;
        pending = null;
        onStatus("saving");
        try {
          await save(job.value);
          onStatus(pending ? "dirty" : "saved");
        } catch (error) {
          if (!pending) pending = job;
          onStatus("error", error);
          if (!timer) timer = setTimeout(() => { timer = null; void run(); }, retryDelay);
          break;
        }
      }
    })().finally(() => { running = null; });
    return running;
  };

  return {
    schedule(value: T) {
      pending = { value };
      onStatus("dirty");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void run(); }, delay);
    },
    flush(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = null; }
      return run();
    },
    hasPending: () => pending !== null || running !== null,
    dispose() { if (timer) clearTimeout(timer); timer = null; },
  };
}
