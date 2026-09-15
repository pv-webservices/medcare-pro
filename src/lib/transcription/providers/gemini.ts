import { z } from "zod";
import type { NormalizedTranscript, TranscriptionProvider } from "../types";
import { TranscriptionFailure } from "../errors";
import { readBoundedProviderJson, TRANSCRIPT_LIMITS } from "../normalize";

export const GEMINI_DIARIZED_MAX_DURATION_MS = 30 * 60_000;
export const GEMINI_PROCESSING_TIMEOUT_MS = 5 * 60_000;
const base = "https://generativelanguage.googleapis.com";
export function getGeminiTranscriptionConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = (env.GEMINI_TRANSCRIPTION_API_KEY || env.GEMINI_API_KEY)?.trim();
  if (!apiKey || env.TRANSCRIPTION_FALLBACK_PROVIDER !== "gemini" || env.TRANSCRIPTION_AUTO_FALLBACK !== "false" || (env.GEMINI_TRANSCRIPTION_MODEL && env.GEMINI_TRANSCRIPTION_MODEL !== "gemini-3.5-transcribe")) throw new TranscriptionFailure("CONFIGURATION");
  return { apiKey, model: "gemini-3.5-transcribe" as const };
}
const word = z.object({ type: z.literal("word_info"), text: z.string().min(1).max(1000), speaker: z.string().regex(/^(?:spk_[1-8]|spk:[0-7])$/), start_offset: z.string().regex(/^\d+(?:\.\d+)?s$/), end_offset: z.string().regex(/^\d+(?:\.\d+)?s$/) });
const responseSchema = z.object({ id: z.string().min(1).max(255).optional(), status: z.literal("completed"), output_text: z.string().max(TRANSCRIPT_LIMITS.sourceCharacters).optional(), steps: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().max(TRANSCRIPT_LIMITS.sourceCharacters).optional(), annotations: z.array(z.unknown()).max(100_000).optional() })).max(20_000) })).max(100) });
const joinWord = (text: string, next: string) => !text ? next : /^[,.;:!?%)\]}]/u.test(next) || /[(\[{]$/u.test(text) ? text + next : text + " " + next;
export function normalizeGeminiResult(payload: unknown, durationMs: number): NormalizedTranscript {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > GEMINI_DIARIZED_MAX_DURATION_MS) throw new TranscriptionFailure("INVALID_RESPONSE");
  const contents = parsed.data.steps.filter(s => s.type === "model_output").flatMap(s => s.content).filter(c => c.type === "text");
  const sourceText = parsed.data.output_text ?? contents.map(c => c.text ?? "").join("");
  if (!sourceText.trim() || sourceText.length > TRANSCRIPT_LIMITS.sourceCharacters) throw new TranscriptionFailure("INVALID_RESPONSE");
  const annotations = contents.flatMap(c => c.annotations ?? []);
  if (!annotations.length || annotations.length > 100_000) throw new TranscriptionFailure("INVALID_RESPONSE");
  const segments: NormalizedTranscript["segments"] = [];
  const speakers = new Set<string>();
  for (const raw of annotations) {
    const w = word.safeParse(raw);
    if (!w.success) throw new TranscriptionFailure("INVALID_RESPONSE");
    speakers.add(w.data.speaker);
    if (speakers.size > 8) throw new TranscriptionFailure("INVALID_RESPONSE");
    const start = Number(w.data.start_offset.slice(0, -1)) * 1000;
    const end = Number(w.data.end_offset.slice(0, -1)) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > durationMs + TRANSCRIPT_LIMITS.durationToleranceMs) throw new TranscriptionFailure("INVALID_RESPONSE");
    const last = segments.at(-1);
    if (last?.speakerLabel === w.data.speaker && joinWord(last.text, w.data.text).length <= TRANSCRIPT_LIMITS.segmentCharacters) { last.text = joinWord(last.text, w.data.text); last.endMs = Math.round(end); if (last.endMs < last.startMs) throw new TranscriptionFailure("INVALID_RESPONSE"); }
    else segments.push({ ordinal: segments.length, speakerLabel: w.data.speaker, startMs: Math.round(start), endMs: Math.round(end), text: w.data.text });
    if (segments.length > TRANSCRIPT_LIMITS.entries) throw new TranscriptionFailure("INVALID_RESPONSE");
  }
  if (segments.reduce((sum, segment) => sum + segment.text.length, 0) > TRANSCRIPT_LIMITS.sourceCharacters) throw new TranscriptionFailure("INVALID_RESPONSE");
  return { sourceText, providerRequestId: parsed.data.id, segments };
}

/** Files + Interactions only; never routes through the writing assistant. */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "GEMINI";
  readonly model = "gemini-3.5-transcribe";
  constructor(readonly config = getGeminiTranscriptionConfig(), readonly transport: typeof fetch = fetch) {}
  async submit(): Promise<{ providerJobId: string }> { throw new TranscriptionFailure("CONFIGURATION"); }
  parseResult(payload: unknown, durationMs = 0) { return normalizeGeminiResult(payload, durationMs); }
  private async request(path: string, init: RequestInit, signal?: AbortSignal) {
    let response: Response;
    try { response = await this.transport(base + path, { ...init, redirect: "error", headers: { "x-goog-api-key": this.config.apiKey, ...init.headers }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) }); }
    catch (error) { throw new TranscriptionFailure(signal?.aborted || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" : "NETWORK", true); }
    if (!response.ok) { await response.body?.cancel(); throw new TranscriptionFailure(response.status === 429 ? "RATE_LIMIT" : response.status === 401 || response.status === 403 ? "AUTH" : "PROVIDER_FAILURE", response.status === 429 || response.status >= 500); }
    return response;
  }
  async deleteFile(name: string) {
    if (!/^files\/[a-zA-Z0-9_-]{1,200}$/.test(name)) throw new TranscriptionFailure("INVALID_RESPONSE");
    const response = await this.transport(`${base}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": this.config.apiKey }, redirect: "error", signal: AbortSignal.timeout(30_000) }).catch(() => { throw new TranscriptionFailure("NETWORK", true); });
    if (!response.ok && response.status !== 404) { await response.body?.cancel(); throw new TranscriptionFailure("PROVIDER_FAILURE", true); }
    await response.body?.cancel();
  }
  async transcribe(input: { stream: ReadableStream<Uint8Array>; bytes: number; mime: string; durationMs: number; artifact: (name: string, deleted: boolean) => Promise<void>; signal: AbortSignal }) {
    let fileName: string | undefined;
    const processingSignal = AbortSignal.any([input.signal, AbortSignal.timeout(GEMINI_PROCESSING_TIMEOUT_MS)]);
    try {
      if (input.durationMs > GEMINI_DIARIZED_MAX_DURATION_MS) throw new TranscriptionFailure("UNSUPPORTED_AUDIO");
      const start = await this.request("/upload/v1beta/files", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(input.bytes), "X-Goog-Upload-Header-Content-Type": input.mime }, body: JSON.stringify({ file: { display_name: "clinical-synthetic-or-authorized-recording" } }) }, processingSignal);
      const url = start.headers.get("x-goog-upload-url"); await start.body?.cancel();
      if (!url) throw new TranscriptionFailure("INVALID_RESPONSE");
      const upload = new URL(url);
      if (upload.origin !== base || !upload.pathname.startsWith("/upload/") || upload.username || upload.password) throw new TranscriptionFailure("INVALID_RESPONSE");
      const uploaded = await this.request(upload.pathname + upload.search, { method: "POST", headers: { "Content-Length": String(input.bytes), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: input.stream, duplex: "half" } as RequestInit, processingSignal);
      const file = z.object({ file: z.object({ name: z.string().regex(/^files\/[a-zA-Z0-9_-]{1,200}$/), uri: z.string(), state: z.enum(["ACTIVE", "PROCESSING", "FAILED"]).optional() }) }).parse(await readBoundedProviderJson(uploaded, 64 * 1024)).file;
      fileName = file.name;
      await input.artifact(fileName, false);
      const uri = new URL(file.uri);
      if (uri.origin !== base || uri.pathname !== `/v1beta/${fileName}` || uri.search || uri.hash) throw new TranscriptionFailure("INVALID_RESPONSE");
      let state = file.state;
      for (let attempt = 0; state === "PROCESSING" && attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const metadata = z.object({ state: z.enum(["ACTIVE", "PROCESSING", "FAILED"]) }).parse(await readBoundedProviderJson(await this.request(`/v1beta/${fileName}`, { method: "GET" }, processingSignal), 64 * 1024)); state = metadata.state;
      }
      if (state && state !== "ACTIVE") throw new TranscriptionFailure(state === "PROCESSING" ? "TIMEOUT" : "PROVIDER_FAILURE");
      const result = await this.request("/v1beta/interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, store: false, input: [{ type: "audio", uri: file.uri, mime_type: input.mime }], generation_config: { transcription_config: { language_codes: [], mode: { type: "verbatim", diarization_mode: "speaker", timestamp_granularities: ["word"] } } } }) }, processingSignal);
      return normalizeGeminiResult(await readBoundedProviderJson(result), input.durationMs);
    } finally {
      if (fileName) { try { await this.deleteFile(fileName); await input.artifact(fileName, true); } catch { /* Pending metadata remains durable for cleanup retry. */ } }
      await input.stream.cancel().catch(() => undefined);
    }
  }
}
