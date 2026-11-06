export type StoredTranscriptionChunk = {
  sessionId: string;
  index: number;
  audio: Blob | null;
  transcript: string | null;
  createdAt: number;
};

const DB_NAME = "mednotes-transcription-temp";
const STORE = "chunks";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Armazenamento temporário indisponível neste navegador."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento temporário."));
  });
}

function keyOf(sessionId: string, index: number) { return `${sessionId}:${index}`; }

export async function saveAudioChunk(sessionId: string, index: number, audio: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key: keyOf(sessionId, index), sessionId, index, audio, transcript: null, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Não foi possível guardar temporariamente o bloco."));
    tx.onabort = () => reject(tx.error ?? new Error("O armazenamento temporário foi interrompido."));
  }).finally(() => db.close());
}

export async function saveChunkTranscript(sessionId: string, index: number, transcript: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(keyOf(sessionId, index));
    request.onsuccess = () => {
      const previous = request.result as (StoredTranscriptionChunk & { key: string }) | undefined;
      store.put({ key: keyOf(sessionId, index), sessionId, index, audio: null, transcript, createdAt: previous?.createdAt ?? Date.now() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Não foi possível salvar temporariamente a transcrição."));
  }).finally(() => db.close());
}

export async function listSessionChunks(sessionId: string): Promise<StoredTranscriptionChunk[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as Array<StoredTranscriptionChunk & { key: string }>)
      .filter((record) => record.sessionId === sessionId)
      .map(({ sessionId: id, index, audio, transcript, createdAt }) => ({ sessionId: id, index, audio, transcript, createdAt }))
      .sort((a, b) => a.index - b.index));
    request.onerror = () => reject(request.error ?? new Error("Não foi possível recuperar os blocos pendentes."));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteSessionChunks(sessionId: string): Promise<void> {
  const records = await listSessionChunks(sessionId);
  if (!records.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    records.forEach((record) => store.delete(keyOf(sessionId, record.index)));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Não foi possível limpar os dados temporários."));
  }).finally(() => db.close());
}
