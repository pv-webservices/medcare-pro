import { z } from "zod";
import type { SarvamBatchConfig } from "../batchConfig";
import { TranscriptionFailure } from "../errors";
import { readBoundedProviderJson } from "../normalize";

const id = z.string().min(1).max(255).regex(/^[a-zA-Z0-9_-]+$/);
const state = z.enum(["Accepted", "Pending", "Running", "Completed", "Failed"]);
const file = z.object({ file_name: z.string().min(1).max(255), file_id: z.string().max(255).optional() });
export const sarvamStatusSchema = z.object({
  job_id: id, job_state: state,
  total_files: z.number().int().nonnegative(), successful_files_count: z.number().int().nonnegative(), failed_files_count: z.number().int().nonnegative(),
  job_details: z.array(z.object({ inputs: z.array(file).max(20), outputs: z.array(file).max(20), state: z.string().max(64) })).max(20),
});
export type SarvamJobStatus = z.infer<typeof sarvamStatusSchema>;
const links = (field: "upload_urls" | "download_urls") => z.object({ job_id: id, [field]: z.record(z.string(), z.object({ file_url: z.string().max(8192) })) });

/** Provider-issued destinations only; prevent redirects/SSRF and SAS leakage. */
export function sarvamBlobUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TranscriptionFailure("INVALID_RESPONSE"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname)) throw new TranscriptionFailure("INVALID_RESPONSE");
  return url;
}

// Conservative sustained throughput to the provider blob store. The worker
// lease heartbeat keeps the claim alive for the whole upload.
const MIN_UPLOAD_BYTES_PER_SECOND = 256 * 1024;
const MAX_UPLOAD_TIMEOUT_MS = 60 * 60_000;

/** A recording may be up to CLINICAL_RECORDING_MAX_BYTES, far beyond what the
 * JSON request timeout can carry, so the audio PUT gets a size-scaled deadline. */
export function sarvamUploadTimeoutMs(bytes: number, requestTimeoutMs: number): number {
  const scaled = Math.ceil(bytes / MIN_UPLOAD_BYTES_PER_SECOND) * 1000;
  return Math.min(MAX_UPLOAD_TIMEOUT_MS, Math.max(requestTimeoutMs, scaled));
}

/** Checkpoints are deliberately separate so the worker can durably persist job IDs. */
export class SarvamBatchClient {
  constructor(private readonly config: SarvamBatchConfig, private readonly transport: typeof fetch = fetch) {}

  private async request(url: string | URL, init: RequestInit, signal?: AbortSignal, timeoutMs = this.config.requestTimeoutMs): Promise<Response> {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await this.transport(url, { ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) {
        // Read only the bounded error code, never retain/log error.message/body.
        let code: unknown;
        try { const parsed = z.object({ error: z.object({ code: z.string().max(100) }) }).safeParse(await readBoundedProviderJson(response, 16_384)); if (parsed.success) code = parsed.data.error.code; } catch { /* Status classification remains safe. */ }
        if (code === "insufficient_quota_error") throw new TranscriptionFailure("QUOTA");
        if (response.status === 401 || response.status === 403 || code === "invalid_api_key_error" || code === "authentication_error") throw new TranscriptionFailure("AUTH");
        if (response.status === 429) throw new TranscriptionFailure("RATE_LIMIT", true);
        if (response.status >= 500) throw new TranscriptionFailure("PROVIDER_FAILURE", true);
        if (response.status === 422) throw new TranscriptionFailure("UNSUPPORTED_AUDIO");
        throw new TranscriptionFailure("PROVIDER_FAILURE");
      }
      return response;
    } catch (error) {
      if (error instanceof TranscriptionFailure) throw error;
      if (signal?.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) throw new TranscriptionFailure("TIMEOUT", true);
      throw new TranscriptionFailure("NETWORK", true);
    }
  }

  private async api(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(`https://api.sarvam.ai/speech-to-text/job/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { "api-subscription-key": this.config.apiKey, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, signal);
    return readBoundedProviderJson(response, 256 * 1024);
  }

  async createJob(signal?: AbortSignal): Promise<string> {
    const parsed = z.object({ job_id: id, job_state: state }).safeParse(await this.api("", { job_parameters: { model: "saaras:v4", mode: "verbatim", language_code: "unknown", with_diarization: true, num_speakers: 2, with_timestamps: true, keyterms: this.config.keyterms }, ...(this.config.callback ? { callback: this.config.callback } : {}) }, signal));
    if (!parsed.success) throw new TranscriptionFailure("INVALID_RESPONSE");
    return parsed.data.job_id;
  }

  async upload(jobId: string, filename: string, stream: ReadableStream<Uint8Array>, bytes: number, contentType: string, signal?: AbortSignal) {
    try {
      if (!id.safeParse(jobId).success || !/^[a-zA-Z0-9_-]+\.(webm|ogg|mp4)$/.test(filename) || !Number.isSafeInteger(bytes) || bytes <= 0) throw new TranscriptionFailure("CONFIGURATION");
      const parsed = links("upload_urls").safeParse(await this.api("/upload-files", { job_id: jobId, files: [filename] }, signal));
      if (!parsed.success || parsed.data.job_id !== jobId) throw new TranscriptionFailure("INVALID_RESPONSE");
      const destinations = parsed.data.upload_urls as Record<string, { file_url: string }>;
      const destination = destinations[filename];
      if (!destination) throw new TranscriptionFailure("INVALID_RESPONSE");
      const init: RequestInit & { duplex: "half" } = { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Length": String(bytes), "Content-Type": contentType }, body: stream, duplex: "half" };
      const response = await this.request(sarvamBlobUrl(destination.file_url), init, signal, sarvamUploadTimeoutMs(bytes, this.config.requestTimeoutMs));
      await response.body?.cancel();
    } finally { if (!stream.locked) await stream.cancel().catch(() => undefined); }
  }

  async start(jobId: string, signal?: AbortSignal) {
    return this.parseStatus(await this.api(`/${encodeURIComponent(jobId)}/start`, {}, signal), jobId);
  }
  async status(jobId: string, signal?: AbortSignal) {
    return this.parseStatus(await this.api(`/${encodeURIComponent(jobId)}/status`, undefined, signal), jobId);
  }
  private parseStatus(payload: unknown, jobId: string) {
    const parsed = sarvamStatusSchema.safeParse(payload);
    if (!parsed.success || parsed.data.job_id !== jobId) throw new TranscriptionFailure("INVALID_RESPONSE");
    return parsed.data;
  }
  async result(status: SarvamJobStatus, expectedInputFilename: string, signal?: AbortSignal): Promise<unknown> {
    if (status.job_state !== "Completed" || status.total_files !== 1 || status.successful_files_count !== 1 || status.failed_files_count !== 0 || status.job_details.length !== 1) throw new TranscriptionFailure("INVALID_RESPONSE");
    const detail = status.job_details[0];
    if (detail.state !== "Success" || detail.inputs.length !== 1 || detail.inputs[0].file_name !== expectedInputFilename || detail.outputs.length !== 1 || !/^[a-zA-Z0-9_.-]+\.json$/.test(detail.outputs[0].file_name)) throw new TranscriptionFailure("INVALID_RESPONSE");
    const filename = detail.outputs[0].file_name;
    const parsed = links("download_urls").safeParse(await this.api("/download-files", { job_id: status.job_id, files: [filename] }, signal));
    if (!parsed.success || parsed.data.job_id !== status.job_id) throw new TranscriptionFailure("INVALID_RESPONSE");
    const destinations = parsed.data.download_urls as Record<string, { file_url: string }>;
    const destination = destinations[filename];
    if (!destination) throw new TranscriptionFailure("INVALID_RESPONSE");
    return readBoundedProviderJson(await this.request(sarvamBlobUrl(destination.file_url), { method: "GET" }, signal));
  }
}
