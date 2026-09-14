export const MIME_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];
export function selectRecordingMime(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported">,
) {
  return MIME_PREFERENCE.find((t) => recorder.isTypeSupported(t)) ?? null;
}
export class RecordingClock {
  private start = 0;
  private total = 0;
  private running = false;
  constructor(private now = () => performance.now()) {}
  resume() {
    if (!this.running) {
      this.start = this.now();
      this.running = true;
    }
  }
  pause() {
    if (this.running) {
      this.total += this.now() - this.start;
      this.running = false;
    }
  }
  elapsed() {
    return Math.max(
      0,
      Math.floor(this.total + (this.running ? this.now() - this.start : 0)),
    );
  }
}
export function microphoneMessage(name: string) {
  return (
    {
      NotAllowedError:
        "Microphone access is blocked. Allow microphone access in your browser and try again.",
      NotFoundError:
        "No microphone was found. Connect a microphone and try again.",
      NotReadableError:
        "The microphone is in use or unavailable. Check your device and try again.",
      AbortError: "The microphone check was interrupted. Try again.",
      SecurityError: "Microphone access requires a secure browser connection.",
    }[name] ??
    "The microphone is unavailable. Check your browser and device settings."
  );
}
