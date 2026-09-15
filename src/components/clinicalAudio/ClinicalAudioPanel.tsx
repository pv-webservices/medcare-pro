"use client";
import { useRef, useState } from "react";
import TranscriptPanel from "./TranscriptPanel";
import { useClinicalRecorder, audioRequest } from "./useClinicalRecorder";
function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
export default function ClinicalAudioPanel({
  registrationId,
  maxMinutes = 120,
  inPerson = true,
}: {
  registrationId: string;
  maxMinutes?: number;
  inPerson?: boolean;
}) {
  const r = useClinicalRecorder(registrationId, maxMinutes);
  const player = useRef<HTMLAudioElement | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [attested, setAttested] = useState(false),
    [method, setMethod] = useState("VERBAL"),
    [consenter, setConsenter] = useState("PATIENT"),
    [playback, setPlayback] = useState<{ id: string; url: string; expiresAt: number } | null>(
      null,
    ),
    [playError, setPlayError] = useState("");
  const button =
    "min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium disabled:opacity-40";
  async function seekRecording(id: string, milliseconds: number) {
    if (playback?.id === id && playback.expiresAt > Date.now() && player.current?.readyState) {
      player.current.currentTime = milliseconds / 1000;
      return;
    }
    pendingSeek.current = milliseconds / 1000;
    const result = await audioRequest<{ url: string; expiresIn: number }>(`/api/clinical-ai/recordings/${id}/audio-url`);
    setPlayback({ id, url: result.url, expiresAt: Date.now() + Math.max(1, result.expiresIn - 5) * 1000 });
  }
  return (
    <section
      aria-label="Recording & Transcript"
      className="min-w-0 space-y-4 rounded-2xl border border-line bg-canvas p-5"
    >
      <h2 className="text-lg font-semibold">Recording &amp; Transcript</h2>
      <p className="text-sm text-muted">
        Consultation Recording · Face-to-face audio only
      </p>
      {!inPerson && (
        <p role="alert">
          Select IN PERSON consultation mode to record in this room.
        </p>
      )}
      {r.error && (
        <p role="alert" className="break-words text-alert-ink">
          {r.error}
        </p>
      )}
      {r.recovery
        .filter((s) => s.recordingId !== r.id)
        .map((s) => (
          <div
            key={s.recordingId}
            className="space-y-2 rounded-xl border border-line p-3"
          >
            <p>An unfinished consultation recording was found.</p>
            <p>Recorded locally: {duration(s.elapsedMs)}</p>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={s.state === "withdrawn"}
                className={button}
                onClick={() => void r.upload(s)}
              >
                Recover recording
              </button>
              <button
                className={button}
                onClick={() =>
                  void r.discard(s.recordingId, s.state === "withdrawn")
                }
              >
                Discard recording
              </button>
            </div>
          </div>
        ))}
      {r.state === "idle" && (
        <div className="space-y-3">
          <h3 className="font-medium">Patient consent required</h3>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-1"
            />
            <span>
              I have informed the patient/representative that this consultation
              will be audio recorded and processed for clinical documentation,
              and consent has been obtained.
            </span>
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              Consent method
              <select
                aria-label="Consent method"
                className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-canvas px-3"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {["VERBAL", "WRITTEN", "DIGITAL"].map((v) => (
                  <option key={v} value={v}>
                    {v[0] + v.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Consent provided by
              <select
                aria-label="Consent provided by"
                className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-canvas px-3"
                value={consenter}
                onChange={(e) => setConsenter(e.target.value)}
              >
                <option value="PATIENT">Patient</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="AUTHORIZED_REPRESENTATIVE">
                  Authorized representative
                </option>
              </select>
            </label>
          </div>
          <button
            className={button}
            disabled={!attested || !inPerson || r.recovery.length > 0}
            onClick={() =>
              void r
                .consent({
                  attested: true,
                  method,
                  consenterType: consenter,
                })
                .then(() => setAttested(false))
            }
          >
            Record patient consent
          </button>
        </div>
      )}
      <div className="space-y-2">
        <p>Consent: {r.id ? "Recorded" : "Not recorded"}</p>
        <p>
          Microphone: {r.mic}
          {r.micReady ? " · Ready" : ""}
        </p>
        {r.micReady && (
          <meter
            aria-label="Microphone audio level"
            min={0}
            max={100}
            value={r.level}
            className="h-4 w-full max-w-xs"
          />
        )}
      </div>
      <p role="status" aria-live="polite" className="font-semibold">
        {r.state === "recording"
          ? "● Recording"
          : r.state === "paused"
            ? "Paused"
            : r.state === "uploading"
              ? "Uploading " + r.progress + "%"
              : r.state === "stopped"
                ? "Stopped — saved on this device"
                : r.state === "consented"
                  ? "Consent recorded"
                  : r.state === "idle"
                    ? "Ready for consent"
                    : r.state}{" "}
        <span aria-label="Recording elapsed time">{duration(r.elapsed)}</span>
      </p>
      {r.state === "recording" && r.elapsed >= (maxMinutes - 5) * 60000 && (
        <p>Recording will stop automatically within five minutes.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {["idle", "consented"].includes(r.state) && (
          <>
            <button className={button} onClick={() => void r.checkMicrophone()}>
              Check microphone
            </button>
            <button
              className={button}
              disabled={r.state !== "consented" || !r.micReady || !inPerson}
              onClick={() => void r.start()}
            >
              Start recording
            </button>
          </>
        )}
        {r.state === "recording" && (
          <button className={button} onClick={() => void r.pause()}>
            Pause recording
          </button>
        )}
        {r.state === "paused" && (
          <button className={button} onClick={() => void r.resume()}>
            Resume recording
          </button>
        )}
        {["recording", "paused"].includes(r.state) && (
          <>
            <button className={button} onClick={() => void r.stop()}>
              Stop recording
            </button>
            <button
              className={button}
              onClick={() => void r.discard(undefined, true)}
            >
              Stop — patient withdrew consent
            </button>
          </>
        )}
        {r.state === "stopped" && (
          <>
            {r.withdrawalPending ? (
              <button
                className={button}
                onClick={() => void r.discard(undefined, true)}
              >
                Retry consent withdrawal
              </button>
            ) : (
              <button className={button} onClick={() => void r.upload()}>
                Upload / Resume upload
              </button>
            )}
            <button className={button} onClick={() => void r.discard()}>
              Discard recording
            </button>
          </>
        )}
        {r.state === "consented" && (
          <button className={button} onClick={() => void r.discard()}>
            Discard recording
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Transcript becomes available after transcription processing.
      </p>
      {r.history.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium">Recording history</h3>
          {r.history.map((recording, i) => (
            <div
              key={recording.id}
              className="min-w-0 rounded-xl border border-line p-3"
            >
              <p>
                Recording {r.history.length - i} ·{" "}
                {duration(recording.durationMs ?? 0)} · {recording.status}
              </p>
              {recording.audioDeletedAt ? (
                <p>Audio no longer retained</p>
              ) : (
                recording.status === "READY" && (
                  <button
                    className={button}
                    onClick={() => {
                      setPlayError("");
                      void audioRequest<{ url: string; expiresIn: number }>(
                        "/api/clinical-ai/recordings/" +
                          recording.id +
                          "/audio-url",
                      )
                        .then((v) =>
                          setPlayback({ id: recording.id, url: v.url, expiresAt: Date.now() + Math.max(1, v.expiresIn - 5) * 1000 }),
                        )
                        .catch((e) => setPlayError(e.message));
                    }}
                  >
                    Play recording
                  </button>
                )
              )}
              {playback?.id === recording.id && (
                <audio
                  ref={player}
                  onLoadedMetadata={() => { if (player.current && pendingSeek.current !== null) { player.current.currentTime = pendingSeek.current; pendingSeek.current = null; } }}
                  aria-label="Consultation recording playback"
                  controls
                  src={playback.url}
                  className="mt-3 w-full max-w-full"
                  onError={() =>
                    setPlayError(
                      "Playback is unavailable or the link expired. Select Play recording to refresh access.",
                    )
                  }
                />
              )}
              {recording.status === "READY" && <TranscriptPanel recordingId={recording.id} audioRetained={!recording.audioDeletedAt} onSeek={(milliseconds) => seekRecording(recording.id, milliseconds)} />}
            </div>
          ))}
        </div>
      )}
      {playError && <p role="alert">{playError}</p>}
    </section>
  );
}
