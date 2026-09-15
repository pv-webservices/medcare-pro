"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  RecordingClock,
  microphoneMessage,
  selectRecordingMime,
} from "@/lib/clinical-audio/client/recording";
import * as local from "@/lib/clinical-audio/client/indexedDb";
export type RecordingMetadata = {
  id: string;
  registrationId: string;
  status: string;
  durationMs: number | null;
  byteSize: number | null;
  audioDeletedAt: string | null;
  mimeType: string | null;
  createdAt: string;
};
export async function audioRequest<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const b = await r.json();
  if (!r.ok || !b.success)
    throw new Error(b.error || "Recording request failed.");
  return b.data as T;
}
export function useClinicalRecorder(
  registrationId: string,
  maxMinutes: number,
) {
  const [state, setState] = useState("idle"),
    [mic, setMic] = useState("Not checked"),
    [level, setLevel] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState(""),
    [id, setId] = useState<string | null>(null),
    [progress, setProgress] = useState(0),
    [recovery, setRecovery] = useState<local.RecordingSession[]>([]),
    [history, setHistory] = useState<RecordingMetadata[]>([]),
    [withdrawalPending, setWithdrawalPending] = useState(false);
  const stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    frame = useRef(0),
    recorder = useRef<MediaRecorder | null>(null),
    clock = useRef(new RecordingClock()),
    currentId = useRef<string | null>(null),
    sequence = useRef(0),
    pending = useRef<Promise<void>>(Promise.resolve()),
    capturing = useRef(false),
    busy = useRef(false),
    stopping = useRef<Promise<void> | null>(null),
    mime = useRef(""),
    localDuration = useRef(0),
    mounted = useRef(true);
  const stopAction = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    setHistory(
      await audioRequest<RecordingMetadata[]>(
        "/api/clinical-ai/recordings?registrationId=" +
          encodeURIComponent(registrationId),
      ),
    );
    setRecovery(await local.unfinishedSessions(registrationId));
  }, [registrationId]);
  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    stream.current = null;
    void context.current?.close();
    context.current = null;
    setMic("Not checked");
    setLevel(0);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve()
      .then(() => {
        if (
          !window.indexedDB ||
          !window.MediaRecorder ||
          !navigator.mediaDevices
        ) {
          setError(
            "This browser does not support consultation recording. Use a browser with microphone, MediaRecorder and IndexedDB support.",
          );
          return;
        }
        return refresh();
      })
      .catch(() => setError("Recording history is unavailable."));
    return () => {
      mounted.current = false;
      capturing.current = false;
      try {
        recorder.current?.stop();
      } catch {}
      cancelAnimationFrame(frame.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      void context.current?.close();
    };
  }, [refresh]);
  const protectedState = state !== "idle" || recovery.length > 0;
  useEffect(() => {
    if (!protectedState) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigation = (e: MouseEvent) => {
      const target = (e.target as Element).closest("a[href]");
      if (
        target &&
        !window.confirm(
          "A consultation recording is unfinished. Leave this page? Captured chunks remain on this device.",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigation, true);
    };
  }, [protectedState]);
  async function checkMicrophone() {
    setError("");
    if (busy.current || capturing.current) return;
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder || !window.indexedDB)
        throw new Error("unsupported");
      release();
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      stream.current = s;
      setMic(s.getAudioTracks()[0]?.label || "Microphone");
      const ac = new AudioContext();
      context.current = ac;
      await ac.resume();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const meter = () => {
        if (!mounted.current) return;
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(
          data.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            data.length,
        );
        setLevel(Math.min(100, Math.round(rms * 400)));
        frame.current = requestAnimationFrame(meter);
      };
      meter();
      s.getAudioTracks().forEach((t) => {
        t.onended = () => {
          setError("Microphone disconnected. Recording has stopped.");
          if (capturing.current) void stop();
          else release();
        };
        t.onmute = () =>
          setError("Microphone input is muted. Check the device.");
        t.onunmute = () => setError("");
      });
    } catch (e) {
      release();
      setError(
        microphoneMessage(e instanceof DOMException ? e.name : "unsupported"),
      );
    }
  }
  async function consent(input: {
    attested: true;
    method: string;
    consenterType: string;
  }) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      const r = await audioRequest<RecordingMetadata>(
        "/api/clinical-ai/recordings",
        { registrationId, ...input },
      );
      await refresh();
      setId(r.id);
      currentId.current = r.id;
      setState("consented");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  async function start() {
    if (!stream.current || !currentId.current || busy.current) return;
    busy.current = true;
    setError("");
    try {
      const selected = selectRecordingMime(MediaRecorder);
      if (!selected)
        throw new Error("No supported audio recording format is available.");
      mime.current = selected;
      clock.current = new RecordingClock();
      sequence.current = 0;
      pending.current = Promise.resolve();
      localDuration.current = 0;
      const recordingId = currentId.current;
      const mr = new MediaRecorder(stream.current, { mimeType: selected });
      recorder.current = mr;
      await local.saveSession({
        recordingId,
        registrationId,
        mimeType: selected,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        state: "recording",
        nextSequence: 0,
        elapsedMs: 0,
      });
      mr.ondataavailable = (e) => {
        if (!e.data.size) return;
        const chunk = {
          recordingId,
          sequence: sequence.current++,
          blob: e.data,
          size: e.data.size,
          createdAt: Date.now(),
        };
        const measured = clock.current.elapsed();
        pending.current = pending.current.then(() =>
          local.saveChunk(chunk, measured),
        );
        void pending.current.catch(() => {
          setError(
            "Local storage is full or unavailable. Recording has stopped; saved chunks remain for recovery.",
          );
          if (capturing.current) void stop();
        });
      };
      await audioRequest(
        "/api/clinical-ai/recordings/" + recordingId + "/start",
        { clientElapsedMs: 0, mimeType: selected },
      );
      clock.current.resume();
      mr.start(10000);
      capturing.current = true;
      setState("recording");
    } catch (e) {
      setError((e as Error).message);
      if (currentId.current) {
        await audioRequest(
          "/api/clinical-ai/recordings/" + currentId.current + "/upload/abort",
          {},
        ).catch(() => {});
        await local.deleteRecording(currentId.current).catch(() => {});
      }
      setState("idle");
      setId(null);
      currentId.current = null;
      release();
    } finally {
      busy.current = false;
    }
  }
  async function pause() {
    if (busy.current || recorder.current?.state !== "recording") return;
    busy.current = true;
    try {
      await audioRequest(
        "/api/clinical-ai/recordings/" + currentId.current + "/pause",
        { clientElapsedMs: clock.current.elapsed() },
      );
      recorder.current.pause();
      clock.current.pause();
      setState("paused");
      await local.updateSession(currentId.current!, {
        state: "paused",
        elapsedMs: clock.current.elapsed(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  async function resume() {
    if (busy.current || recorder.current?.state !== "paused") return;
    busy.current = true;
    try {
      await audioRequest(
        "/api/clinical-ai/recordings/" + currentId.current + "/resume",
        { clientElapsedMs: clock.current.elapsed() },
      );
      recorder.current.resume();
      clock.current.resume();
      setState("recording");
      await local.updateSession(currentId.current!, { state: "recording" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  async function finishCapture() {
    if (stopping.current) return stopping.current;
    const mr = recorder.current;
    if (!mr || mr.state === "inactive") return;
    capturing.current = false;
    clock.current.pause();
    localDuration.current = Math.min(
      clock.current.elapsed(),
      maxMinutes * 60000,
    );
    stopping.current = new Promise<void>((resolve, reject) => {
      mr.onstop = () => {
        void pending.current.then(resolve, reject);
      };
      mr.stop();
    }).finally(() => {
      stopping.current = null;
    });
    return stopping.current;
  }
  async function stop() {
    if (!currentId.current) return;
    setState("stopping");
    try {
      await finishCapture();
      const measured = localDuration.current;
      await local.updateSession(currentId.current, {
        state: "stopped",
        elapsedMs: measured,
      });
      await local.reconstructRecording(currentId.current, mime.current);
      await audioRequest(
        "/api/clinical-ai/recordings/" + currentId.current + "/stop",
        { clientElapsedMs: measured },
      );
      setElapsed(measured);
      setState("stopped");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setState("stopped");
    } finally {
      release();
    }
  }
  useEffect(() => {
    stopAction.current = stop;
  });
  useEffect(() => {
    if (state !== "recording" && state !== "paused") return;
    const timer = setInterval(() => {
      const ms = clock.current.elapsed();
      setElapsed(ms);
      if (currentId.current)
        void local
          .updateSession(currentId.current, {
            elapsedMs: Math.min(ms, maxMinutes * 60000),
          })
          .catch(() => {});
      if (ms >= maxMinutes * 60000 && capturing.current)
        void stopAction.current();
    }, 500);
    return () => clearInterval(timer);
  }, [state, maxMinutes]);
  async function upload(session?: local.RecordingSession) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    setProgress(0);
    setState("uploading");
    try {
      const recordingId = session?.recordingId ?? currentId.current;
      if (!recordingId) throw new Error("No captured recording was found.");
      currentId.current = recordingId;
      setId(recordingId);
      const sessions = await local.unfinishedSessions(registrationId);
      const s = session ?? sessions.find((s) => s.recordingId === recordingId);
      if (!s) throw new Error("The local recording is unavailable.");
      if (s.state === "withdrawn" || withdrawalPending)
        throw new Error(
          "Consent was withdrawn. Captured audio cannot be uploaded.",
        );
      // Re-check live registration, assigned Doctor and consent before touching recovered audio.
      const rows = await audioRequest<RecordingMetadata[]>(
        "/api/clinical-ai/recordings?registrationId=" +
          encodeURIComponent(registrationId),
      );
      const r = rows.find((r) => r.id === recordingId);
      if (!r) throw new Error("Recording is unavailable.");
      if (r.status === "READY") {
        await local.deleteRecording(recordingId);
        setState("idle");
        await refresh();
        return;
      }
      if (r.status === "ABORTED" || r.status === "FAILED")
        throw new Error(
          "Recording was discarded. Delete the local recovery data.",
        );
      const blob = await local.reconstructRecording(recordingId, s.mimeType);
      const duration = Math.min(s.elapsedMs, maxMinutes * 60000);
      if (["RECORDING", "PAUSED"].includes(r.status))
        await audioRequest(
          "/api/clinical-ai/recordings/" + recordingId + "/stop",
          { clientElapsedMs: duration },
        );
      const init = await audioRequest<{
        uploadId: string;
        partSize: number;
        partCount: number;
        recording: RecordingMetadata;
      }>("/api/clinical-ai/recordings/" + recordingId + "/upload/init", {
        mimeType: s.mimeType,
        byteSize: blob.size,
        durationMs: duration,
      });
      if (init.recording.status !== "READY") {
        await local.updateSession(recordingId, { state: "uploading" });
        const parts: { partNumber: number; etag: string }[] = [];
        for (let n = 1; n <= init.partCount; n++) {
          const part = blob.slice(
            (n - 1) * init.partSize,
            Math.min(n * init.partSize, blob.size),
          );
          let etag: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const signed = await audioRequest<{ url: string }>(
                "/api/clinical-ai/recordings/" + recordingId + "/upload/part",
                { uploadId: init.uploadId, partNumber: n },
              );
              const result = await fetch(signed.url, {
                method: "PUT",
                body: part,
              });
              if (!result.ok) throw new Error("Part failed");
              etag = result.headers.get("ETag");
              if (!etag) throw new Error("ETag missing");
              break;
            } catch {
              if (attempt === 2)
                throw new Error(
                  "Upload paused. Recording is saved on this device. Resume upload when your connection is available.",
                );
            }
          }
          parts.push({ partNumber: n, etag: etag! });
          setProgress(Math.round((n / init.partCount) * 100));
        }
        await audioRequest(
          "/api/clinical-ai/recordings/" + recordingId + "/upload/complete",
          { uploadId: init.uploadId, parts },
        );
      }
      await local.deleteRecording(recordingId);
      currentId.current = null;
      setId(null);
      setState("idle");
      setProgress(100);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setState("stopped");
      await refresh().catch(() => {});
    } finally {
      busy.current = false;
    }
  }
  async function discard(recordingId = currentId.current, withdraw = false) {
    if (!recordingId) return;
    if (
      !window.confirm(
        withdraw
          ? "The recording will stop and captured audio will be discarded. Continue?"
          : "Discard this unfinished recording and delete audio from this device?",
      )
    )
      return;
    busy.current = true;
    setState("discarding");
    setError("");
    try {
      await finishCapture().catch(() => {});
      release();
      if (withdraw) {
        setWithdrawalPending(true);
        await local.updateSession(recordingId, { state: "withdrawn" });
        await local.deleteRecordingChunks(recordingId);
      }
      // Withdrawal stops capture before network calls; failed requests keep a visible retry state.
      await audioRequest(
        "/api/clinical-ai/recordings/" +
          recordingId +
          (withdraw ? "/withdraw-consent" : "/upload/abort"),
        withdraw ? { clientElapsedMs: clock.current.elapsed() } : {},
      );
      await local.deleteRecording(recordingId);
      currentId.current = null;
      setId(null);
      setWithdrawalPending(false);
      setState("idle");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setState("stopped");
      if (withdraw)
        await local.deleteRecordingChunks(recordingId).catch(() => {});
    } finally {
      busy.current = false;
    }
  }
  return {
    state,
    mic,
    level,
    elapsed,
    error,
    id,
    progress,
    recovery,
    history,
    checkMicrophone,
    consent,
    start,
    pause,
    resume,
    stop,
    upload,
    discard,
    withdrawalPending,
    micReady: !!stream.current,
  };
}
