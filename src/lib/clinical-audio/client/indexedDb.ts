export type RecordingSession = {
  recordingId: string;
  registrationId: string;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  state: "recording" | "paused" | "stopped" | "uploading" | "withdrawn";
  nextSequence: number;
  elapsedMs: number;
};
export type RecordingChunk = {
  recordingId: string;
  sequence: number;
  blob: Blob;
  size: number;
  createdAt: number;
};
const DB = "medcare-clinical-audio";
function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("sessions", { keyPath: "recordingId" });
      const chunks = db.createObjectStore("chunks", {
        keyPath: ["recordingId", "sequence"],
      });
      chunks.createIndex("recordingId", "recordingId");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(new Error("Local recording storage is unavailable."));
  });
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, done: (v: T) => void) => void,
): Promise<T> {
  const db = await connect();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error("Could not save the local recording."));
    };
    try {
      work(tx, (v) => {
        result = v;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export async function saveSession(s: RecordingSession) {
  return transaction<void>(["sessions"], "readwrite", (tx, done) => {
    tx.objectStore("sessions").put(s);
    done();
  });
}
export async function saveChunk(c: RecordingChunk, elapsedMs: number) {
  return transaction<void>(["sessions", "chunks"], "readwrite", (tx, done) => {
    tx.objectStore("chunks").add(c);
    const r = tx.objectStore("sessions").get(c.recordingId);
    r.onsuccess = () => {
      const s = r.result as RecordingSession | undefined;
      if (!s) {
        tx.abort();
        return;
      }
      if (c.sequence !== s.nextSequence) {
        tx.abort();
        return;
      }
      tx.objectStore("sessions").put({
        ...s,
        nextSequence: c.sequence + 1,
        elapsedMs,
        updatedAt: Date.now(),
      });
      done();
    };
  });
}
export async function updateSession(
  id: string,
  data: Partial<Pick<RecordingSession, "state" | "elapsedMs">>,
) {
  return transaction<void>(["sessions"], "readwrite", (tx, done) => {
    const r = tx.objectStore("sessions").get(id);
    r.onsuccess = () => {
      if (r.result)
        tx.objectStore("sessions").put({
          ...r.result,
          ...data,
          updatedAt: Date.now(),
        });
      done();
    };
  });
}
export async function unfinishedSessions(registrationId: string) {
  return transaction<RecordingSession[]>(
    ["sessions"],
    "readonly",
    (tx, done) => {
      const r = tx.objectStore("sessions").getAll();
      r.onsuccess = () =>
        done(
          (r.result as RecordingSession[]).filter(
            (s) => s.registrationId === registrationId,
          ),
        );
    },
  );
}
export async function readChunks(id: string) {
  return transaction<RecordingChunk[]>(["chunks"], "readonly", (tx, done) => {
    const r = tx.objectStore("chunks").index("recordingId").getAll(id);
    r.onsuccess = () =>
      done(
        (r.result as RecordingChunk[]).sort((a, b) => a.sequence - b.sequence),
      );
  });
}
export async function reconstructRecording(id: string, mimeType: string) {
  const chunks = await readChunks(id);
  if (
    !chunks.length ||
    chunks.some((c, i) => c.sequence !== i || c.size !== c.blob.size)
  )
    throw new Error(
      "The local recording is incomplete. Discard it and record again.",
    );
  const blob = new Blob(
    chunks.map((c) => c.blob),
    { type: mimeType },
  );
  if (blob.size < 1024)
    throw new Error(
      "The recording is empty or incomplete. Discard it and record again.",
    );
  return blob;
}
export async function deleteRecording(id: string) {
  return transaction<void>(["sessions", "chunks"], "readwrite", (tx, done) => {
    tx.objectStore("sessions").delete(id);
    const r = tx
      .objectStore("chunks")
      .index("recordingId")
      .openKeyCursor(IDBKeyRange.only(id));
    r.onsuccess = () => {
      const c = r.result;
      if (c) {
        tx.objectStore("chunks").delete(c.primaryKey);
        c.continue();
      } else done();
    };
  });
}
export async function deleteRecordingChunks(id: string) {
  return transaction<void>(["chunks"], "readwrite", (tx, done) => {
    const r = tx
      .objectStore("chunks")
      .index("recordingId")
      .openKeyCursor(IDBKeyRange.only(id));
    r.onsuccess = () => {
      const c = r.result;
      if (c) {
        tx.objectStore("chunks").delete(c.primaryKey);
        c.continue();
      } else done();
    };
  });
}
