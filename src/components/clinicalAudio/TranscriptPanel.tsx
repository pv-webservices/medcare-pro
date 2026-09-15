"use client";
import { useCallback, useEffect, useState } from "react";
import { audioRequest } from "./useClinicalRecorder";

type Run = { id: string; provider: string; status: string; failureCode: string | null; transcriptId: string | null };
type Derived = { status: string; isPartial: boolean; segments: { sourceSegmentId: string; text: string; status: string }[] };
type Correction = { id: string; correctedText: string; supersedesCorrectionId: string | null; createdAt: string };
type Segment = { id: string; ordinal: number; speakerLabel: string; startMs: number; endMs: number; text: string; corrections: Correction[] };
type Transcript = { id: string; version: number; sourceText: string; sourceHash: string; reviewedAt: string | null; speakers: { id: string; speakerLabel: string; speakerType: string; confirmedAt: string | null }[]; segments: Segment[] };
const active = new Set(["QUEUED", "PREPARING", "SUBMITTED", "PROCESSING"]);
const button = "min-h-11 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40";
function effectiveText(segment: Segment) {
  const superseded = new Set(segment.corrections.map((entry) => entry.supersedesCorrectionId));
  return segment.corrections.find((entry) => !superseded.has(entry.id))?.correctedText ?? segment.text;
}
export default function TranscriptPanel({ recordingId, onSeek, audioRetained = true }: { recordingId: string; onSeek: (milliseconds: number) => Promise<void>; audioRetained?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<{ available: boolean; reason: string | null }>({ available: false, reason: null });
  const [confirmFallback, setConfirmFallback] = useState(false);
  const [romanized, setRomanized] = useState(false);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [segmentPage, setSegmentPage] = useState(0);
  const base = `/api/clinical-ai/recordings/${recordingId}/transcriptions`;
  const transcriptId = transcript?.id;
  const refresh = useCallback(async () => {
    const latest = await audioRequest<Run | null>(`${base}/latest`);
    setRun(latest);
    setTranscript(latest?.transcriptId ? await audioRequest<Transcript>(`/api/clinical-ai/transcripts/${latest.transcriptId}`) : null);
  }, [base]);
  useEffect(() => {
    let live = true;
    void audioRequest<Run | null>(`${base}/latest`).then(async (latest) => {
      const source = latest?.transcriptId ? await audioRequest<Transcript>(`/api/clinical-ai/transcripts/${latest.transcriptId}`) : null;
      if (live) { setRun(latest); setTranscript(source); }
    }).catch(() => { if (live) setError("Transcript access is unavailable."); });
    return () => { live = false; };
  }, [base]);
  useEffect(() => {
    let live = true;
    void audioRequest<{ available: boolean; reason: string | null }>(`${base}/fallback`).then(r => { if (live) setFallback(r); }).catch(() => { if (live) setFallback({ available: false, reason: null }); });
    return () => { live = false; };
  }, [base, run?.id, run?.status]);
  useEffect(() => {
    if (!transcriptId || !romanized) return;
    let live = true;
    const load = () => { void audioRequest<Derived | null>(`/api/clinical-ai/transcripts/${transcriptId}/romanized`).then(r => { if (live) setDerived(r); }).catch(() => { if (live) setError("Romanized view is unavailable."); }); };
    load();
    const timer = setInterval(load, 7500);
    return () => { live = false; clearInterval(timer); };
  }, [transcriptId, romanized]);
  useEffect(() => {
    if (!run || !active.has(run.status)) return;
    const timer = setInterval(() => { void refresh().catch(() => setError("Status could not be refreshed.")); }, 7500);
    return () => clearInterval(timer);
  }, [run, refresh]);
  async function save(url: string, body: unknown) {
    setBusy(true); setError("");
    try { await audioRequest(url, body); await refresh(); setDrafts({}); }
    catch { setError("Unable to save. Check permissions and reload if the transcript changed."); }
    finally { setBusy(false); }
  }
  const reviewReady = transcript && transcript.speakers.every((speaker) => speaker.speakerType !== "UNKNOWN" && speaker.confirmedAt) && transcript.speakers.filter((speaker) => speaker.speakerType === "DOCTOR").length === 1 && transcript.speakers.some((speaker) => speaker.speakerType === "PATIENT");
  return <section aria-label="Consultation transcript" className="mt-4 min-w-0 space-y-4 border-t border-line pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Transcript · {run?.provider === "GEMINI" ? "Gemini 3.5 Transcribe" : "Saaras v4"}</h4><span role="status" className="text-sm text-muted">{run?.status ?? "Not generated"}</span></div>
    {audioRetained && (!run || ["FAILED", "TIMED_OUT", "CANCELLED"].includes(run.status)) && <button disabled={busy} className={button} onClick={() => void save(base, {})}>{run ? "Retry with Sarvam" : "Generate transcript"}</button>}
    {run?.failureCode && <p className="text-sm">Transcription could not finish ({run.failureCode}). No transcript has been marked complete.</p>}
    {fallback.reason === "DURATION_LIMIT" && <p>Gemini fallback is unavailable for this recording length. Retry transcription with Sarvam.</p>}
    {audioRetained && fallback.available && <div className="space-y-2"><p>Backup provider available: Gemini</p><button className={button} disabled={busy} onClick={() => setConfirmFallback(true)}>Try Gemini</button></div>}
    {confirmFallback && audioRetained && fallback.available && <div role="dialog" aria-label="Confirm Gemini fallback" className="space-y-3 rounded border border-line p-4"><p>This will send this consultation recording to the configured backup transcription provider. Continue?</p><button className={button} disabled={busy} onClick={() => { setConfirmFallback(false); void save(`${base}/fallback`, { confirmed: true }); }}>Continue with Gemini</button><button className={button} onClick={() => setConfirmFallback(false)}>Cancel</button></div>}
    {run && active.has(run.status) && <p className="text-sm text-muted">Processing continues on the server. You may close this page.</p>}
    {error && <p role="alert" className="break-words">{error}</p>}
    {transcript && <>
      <div className="flex flex-wrap gap-2"><button className={button} aria-pressed={!romanized} onClick={() => setRomanized(false)}>Original</button><button className={button} aria-pressed={romanized} onClick={() => { setRomanized(true); void audioRequest(`/api/clinical-ai/transcripts/${transcript.id}/romanized`, {}).catch(() => setError("Unable to generate Romanized view.")); }}>Romanized</button></div>
      {romanized && <p>Romanized view — derived from the source transcript</p>}
      {romanized && derived?.isPartial && <p>Romanized view is partially available. Some source-language segments are shown in their original script.</p>}
      {romanized && derived?.status !== "COMPLETED" && <p role="status">Romanized view: {derived?.status ?? "QUEUED"}</p>}
      <p className="text-sm">{transcript.reviewedAt ? "Clinician reviewed" : "Awaiting clinician review"} · Corrections never overwrite source evidence.</p>
      <div className="space-y-3"><h5 className="font-medium">Confirm speakers by listening</h5>{transcript.speakers.map((speaker) => <div key={speaker.id} className="min-w-0 space-y-2 rounded-lg border border-line p-3">
        <label className="flex flex-wrap items-center gap-3"><span className="break-all">{speaker.speakerLabel}</span><select aria-label={`Role for ${speaker.speakerLabel}`} className="min-h-11 max-w-full rounded border border-line bg-canvas px-2" disabled={busy} value={speaker.speakerType} onChange={(event) => void save(`/api/clinical-ai/transcripts/${transcript.id}/speakers/${speaker.id}/confirm`, { speakerType: event.target.value, expectedVersion: transcript.version })}>{["UNKNOWN", "DOCTOR", "PATIENT", "CAREGIVER", "OTHER"].map((role) => <option key={role}>{role}</option>)}</select></label>
        <p className="break-words text-sm text-muted">{transcript.segments.filter((segment) => segment.speakerLabel === speaker.speakerLabel).slice(0, 2).map((segment) => segment.text).join(" · ")}</p>
      </div>)}</div>
      <ol className="space-y-3" start={segmentPage * 50 + 1}>{transcript.segments.slice(segmentPage * 50, segmentPage * 50 + 50).map((segment) => <li key={segment.id} className="min-w-0 space-y-2 rounded-lg border border-line p-3">
        <button className={button} onClick={() => { if (!audioRetained) setError("Audio no longer retained"); else void onSeek(segment.startMs).catch(() => setError("Audio is unavailable or no longer retained.")); }}>Listen at {(segment.startMs / 1000).toFixed(1)}s · {transcript.speakers.find((speaker) => speaker.speakerLabel === segment.speakerLabel)?.speakerType ?? "UNKNOWN"}</button>
        <p className="whitespace-pre-wrap break-words">{romanized ? derived?.segments.find(s => s.sourceSegmentId === segment.id)?.text ?? segment.text : effectiveText(segment)}</p>
        <details><summary className="cursor-pointer text-sm text-muted">Original evidence and correction history</summary><p className="whitespace-pre-wrap break-words">{segment.text}</p>{segment.corrections.map((correction) => <p key={correction.id} className="whitespace-pre-wrap break-words text-sm">{correction.createdAt} · {correction.correctedText}</p>)}</details>
        <label className="block text-sm">Clinician correction<textarea aria-label={`Correction for segment ${segment.ordinal + 1}`} maxLength={16000} className="mt-1 w-full rounded border border-line bg-canvas p-2" value={drafts[segment.id] ?? effectiveText(segment)} onChange={(event) => setDrafts((prior) => ({ ...prior, [segment.id]: event.target.value }))} /></label>
        <button disabled={busy || drafts[segment.id] === undefined || !drafts[segment.id]?.trim()} className={button} onClick={() => void save(`/api/clinical-ai/transcript-segments/${segment.id}/corrections`, { correctedText: drafts[segment.id], expectedVersion: transcript.version })}>Save correction</button>
      </li>)}</ol>
      {transcript.segments.length > 50 && <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={segmentPage === 0} onClick={() => setSegmentPage((page) => page - 1)}>Previous transcript segments</button><span className="text-sm">Segments {segmentPage * 50 + 1}–{Math.min(segmentPage * 50 + 50, transcript.segments.length)} of {transcript.segments.length}</span><button className={button} disabled={(segmentPage + 1) * 50 >= transcript.segments.length} onClick={() => setSegmentPage((page) => page + 1)}>Next transcript segments</button></div>}
      <details><summary className="cursor-pointer text-sm">Full immutable provider source</summary><p className="whitespace-pre-wrap break-words">{transcript.sourceText}</p><p className="break-all text-xs text-muted">SHA-256 integrity checksum (not a digital signature): {transcript.sourceHash}</p></details>
      <p className="text-sm text-muted">Confirm all speakers, including Doctor and Patient. Review records your documentation check, not a guarantee of transcription accuracy.</p>
      <button disabled={busy || !reviewReady || !!transcript.reviewedAt} className={button} onClick={() => void save(`/api/clinical-ai/transcripts/${transcript.id}/review`, { attested: true, expectedVersion: transcript.version })}>I have reviewed this transcript for clinical documentation</button>
    </>}
  </section>;
}
