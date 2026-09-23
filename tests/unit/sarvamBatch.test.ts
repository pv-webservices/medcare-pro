import { describe, expect, it, vi } from "vitest";
import { getSarvamBatchConfig } from "@/lib/transcription/batchConfig";
import { normalizeSarvamResult, readBoundedProviderJson, transcriptSourceHash } from "@/lib/transcription/normalize";
import { SarvamBatchClient, sarvamBlobUrl, sarvamUploadTimeoutMs } from "@/lib/transcription/providers/sarvam";

const env = { TRANSCRIPTION_PRIMARY_PROVIDER: "sarvam", SARVAM_API_SUBSCRIPTION_KEY: "synthetic-key-never-live" };
const result = () => ({ request_id: "synthetic-request", transcript: "Metformin 500 mg once daily. No chest pain.", language_code: "en-IN", diarized_transcript: { entries: [{ transcript: "Metformin 500 mg once daily.", start_time_seconds: 0.0006, end_time_seconds: 18, speaker_id: "speaker_0" }, { transcript: "No chest pain.", start_time_seconds: 17, end_time_seconds: 20, speaker_id: "speaker_1" }] } });
describe("Sarvam Batch strict configuration", () => {
  it("pins server provider/model and auto language", () => expect(getSarvamBatchConfig(env).model).toBe("saaras:v4"));
  it.each([{ SARVAM_API_SUBSCRIPTION_KEY: "" }, { TRANSCRIPTION_PRIMARY_PROVIDER: "gemini" }, { SARVAM_TRANSCRIPTION_MODEL: "saaras:v3" }, { TRANSCRIPTION_AUTO_FALLBACK: "true" }, { SARVAM_TRANSCRIPTION_KEYTERMS_JSON: "not json" }, { SARVAM_TRANSCRIPTION_KEYTERMS_JSON: '["  "]' }, { SARVAM_TRANSCRIPTION_KEYTERMS_JSON: '["term"," term "]' }, { SARVAM_TRANSCRIPTION_KEYTERMS_JSON: JSON.stringify(["a".repeat(65)]) }, { SARVAM_TRANSCRIPTION_KEYTERMS_JSON: JSON.stringify(Array.from({ length: 51 }, (_, i) => `${i}`)) }, { SARVAM_POLL_INTERVAL_SECONDS: "0" }, { CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL: "https://example.test" }])("fails closed for invalid config %j", (override) => expect(() => getSarvamBatchConfig({ ...env, ...override })).toThrow("CONFIGURATION"));
  it("trims keyterms and builds authenticated HTTPS callback", () => {
    const config = getSarvamBatchConfig({ ...env, SARVAM_TRANSCRIPTION_KEYTERMS_JSON: '[" Metformin "]', CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL: "https://example.test", SARVAM_WEBHOOK_SECRET: "s".repeat(32) });
    expect(config.keyterms).toEqual(["Metformin"]);
    expect(config.callback?.url).toBe("https://example.test/api/clinical-ai/transcription/webhooks/sarvam");
  });
});
describe("Sarvam bounded evidence normalization", () => {
  it("preserves source, overlap, speaker identities and rounds milliseconds", () => {
    const normalized = normalizeSarvamResult(result(), 20_000);
    expect(normalized.sourceText).toBe(result().transcript);
    expect(normalized.segments[0].startMs).toBe(1);
    expect(normalized.segments[1].startMs).toBe(17_000);
    expect(normalized.segments[0].speakerLabel).toBe("speaker_0");
  });
  it.each([NaN, Infinity, -1])("rejects invalid timestamps %s", (start) => { const payload = result(); payload.diarized_transcript.entries[0].start_time_seconds = start; expect(() => normalizeSarvamResult(payload, 20_000)).toThrow("INVALID_RESPONSE"); });
  it("rejects reversed times, missing diarization, blank text and duration overflow", () => {
    for (const payload of [{ ...result(), diarized_transcript: { entries: [] } }, { ...result(), transcript: " " }, { ...result(), diarized_transcript: { entries: [{ transcript: "word", start_time_seconds: 3, end_time_seconds: 2, speaker_id: "s" }] } }]) expect(() => normalizeSarvamResult(payload, 20_000)).toThrow("INVALID_RESPONSE");
    expect(() => normalizeSarvamResult(result(), 1_000)).toThrow("INVALID_RESPONSE");
  });
  it("hash includes source text, ordered segments, identities and times", () => {
    const source = normalizeSarvamResult(result(), 20_000);
    expect(transcriptSourceHash(source)).toMatch(/^[a-f0-9]{64}$/);
    expect(transcriptSourceHash(source)).toBe(transcriptSourceHash(structuredClone(source)));
    for (const key of ["speakerLabel", "text", "startMs"] as const) {
      const changed = structuredClone(source);
      if (key === "startMs") changed.segments[0][key]++;
      else changed.segments[0][key] += "changed";
      expect(transcriptSourceHash(changed)).not.toBe(transcriptSourceHash(source));
    }
  });
  it("bounds speakers and entries while allowing fewer speakers than requested", () => {
    const payload = result();
    payload.diarized_transcript.entries = [{ transcript: "single speaker", start_time_seconds: 0, end_time_seconds: 1, speaker_id: "s0" }];
    expect(normalizeSarvamResult(payload, 20000).segments.length).toBe(1);
    payload.diarized_transcript.entries = Array.from({ length: 17 }, (_, index) => ({ transcript: "word", start_time_seconds: 0, end_time_seconds: 1, speaker_id: `s${index}` }));
    expect(() => normalizeSarvamResult(payload, 20000)).toThrow("INVALID_RESPONSE");
    payload.diarized_transcript.entries = Array.from({ length: 20001 }, () => ({ transcript: "word", start_time_seconds: 0, end_time_seconds: 1, speaker_id: "s0" }));
    expect(() => normalizeSarvamResult(payload, 20000)).toThrow("INVALID_RESPONSE");
  });
  it("rejects malformed, oversized declared and chunked results", async () => {
    await expect(readBoundedProviderJson(new Response("not json"))).rejects.toThrow("INVALID_RESPONSE");
    await expect(readBoundedProviderJson(new Response("{}", { headers: { "content-length": "999" } }), 5)).rejects.toThrow("INVALID_RESPONSE");
    await expect(readBoundedProviderJson(new Response("123456"), 5)).rejects.toThrow("INVALID_RESPONSE");
  });
});
describe("Sarvam direct REST transport", () => {
  it.each(["http://account.blob.core.windows.net/file", "https://127.0.0.1/private", "https://account.blob.core.windows.net.evil.test/file", "https://user:pass@account.blob.core.windows.net/file", "https://account.blob.core.windows.net:8443/file"]) ("rejects unsafe destination %s", (url) => expect(() => sarvamBlobUrl(url)).toThrow("INVALID_RESPONSE"));
  it("creates exact verbatim v4 job using server credentials", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ job_id: "synthetic-job", job_state: "Accepted" }), { status: 202 }));
    await expect(new SarvamBatchClient(getSarvamBatchConfig(env), transport).createJob()).resolves.toBe("synthetic-job");
    const init = transport.mock.calls[0][1]!;
    expect(JSON.parse(init.body as string).job_parameters).toEqual({ model: "saaras:v4", mode: "verbatim", language_code: "unknown", with_diarization: true, num_speakers: 2, with_timestamps: true, keyterms: [] });
    expect(init.redirect).toBe("error");
  });
  it.each([[401, "AUTH"], [429, "RATE_LIMIT"], [500, "PROVIDER_FAILURE"], [422, "UNSUPPORTED_AUDIO"]])("sanitizes HTTP %s", async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret raw body', { status: status as number }));
    await expect(new SarvamBatchClient(getSarvamBatchConfig(env), transport).createJob()).rejects.toThrow(code as string);
  });
  it("downloads filename from authoritative status without sending API key to blob", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "job", download_urls: { "output-7.json": { file_url: "https://account.blob.core.windows.net/results/output-7.json?sig=synthetic" } } }))).mockResolvedValueOnce(new Response(JSON.stringify(result())));
    await new SarvamBatchClient(getSarvamBatchConfig(env), transport).result({ job_id: "job", job_state: "Completed", total_files: 1, successful_files_count: 1, failed_files_count: 0, job_details: [{ state: "Success", inputs: [{ file_name: "recording.webm" }], outputs: [{ file_name: "output-7.json" }] }] }, "recording.webm");
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string).files).toEqual(["output-7.json"]);
    expect(transport.mock.calls[1][1]!.headers).toBeUndefined();
  });
  it("rejects completed status with missing, failed or unexpected input files before download", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new SarvamBatchClient(getSarvamBatchConfig(env), transport);
    const base = { job_id: "job", job_state: "Completed" as const, total_files: 1, successful_files_count: 1, failed_files_count: 0, job_details: [{ state: "Success", inputs: [{ file_name: "recording.webm" }], outputs: [{ file_name: "output.json" }] }] };
    for (const status of [{ ...base, successful_files_count: 0 }, { ...base, failed_files_count: 1 }, { ...base, job_details: [] }, { ...base, job_details: [{ ...base.job_details[0], outputs: [] }] }, { ...base, job_details: [{ ...base.job_details[0], inputs: [{ file_name: "wrong.webm" }] }] }]) await expect(client.result(status, "recording.webm")).rejects.toThrow("INVALID_RESPONSE");
    expect(transport).not.toHaveBeenCalled();
  });
  it("classifies quota and network/timeout errors without their messages", async () => {
    const quota = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: "insufficient_quota_error", message: "private account information" } }), { status: 429 }));
    await expect(new SarvamBatchClient(getSarvamBatchConfig(env), quota).createJob()).rejects.toMatchObject({ code: "QUOTA", retryable: false });
    for (const [error, code] of [[new TypeError("private connection details"), "NETWORK"], [new DOMException("private timeout details", "TimeoutError"), "TIMEOUT"]] as const) {
      const transport = vi.fn<typeof fetch>().mockRejectedValue(error);
      await expect(new SarvamBatchClient(getSarvamBatchConfig(env), transport).status("job")).rejects.toMatchObject({ message: code, retryable: true });
    }
  });
  it("streams opaque audio to Azure without exposing API key", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "job", upload_urls: { "recording.webm": { file_url: "https://account.blob.core.windows.net/audio/recording.webm?sig=synthetic" } } }))).mockImplementationOnce(async (_url, init) => {
      expect(init?.body).toBeInstanceOf(ReadableStream);
      expect(init?.headers).toEqual({ "x-ms-blob-type": "BlockBlob", "Content-Length": "4", "Content-Type": "audio/webm" });
      const stream = init!.body as ReadableStream<Uint8Array>; const reader = stream.getReader(); expect((await reader.read()).value?.length).toBe(4); expect((await reader.read()).done).toBe(true); reader.releaseLock();
      return new Response(null, { status: 201 });
    });
    await new SarvamBatchClient(getSarvamBatchConfig(env), transport).upload("job", "recording.webm", new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.close(); } }), 4, "audio/webm");
    expect(transport.mock.calls[1][1]?.redirect).toBe("error");
  });
});
describe("Sarvam audio upload deadline", () => {
  const MiB = 1024 * 1024;
  it("keeps the request timeout for small recordings", () => expect(sarvamUploadTimeoutMs(4, 30_000)).toBe(30_000));
  it("scales with size so a maximum-size recording is not cut off at the JSON request timeout", () => expect(sarvamUploadTimeoutMs(512 * MiB, 30_000)).toBe(2_048_000));
  it("is capped so a stalled upload cannot hold a worker indefinitely", () => expect(sarvamUploadTimeoutMs(4096 * MiB, 30_000)).toBe(3_600_000));
  it("applies the scaled deadline to the blob PUT only", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "job", upload_urls: { "recording.webm": { file_url: "https://account.blob.core.windows.net/audio/recording.webm?sig=synthetic" } } }))).mockResolvedValueOnce(new Response(null, { status: 201 }));
    const bytes = 100 * MiB;
    await new SarvamBatchClient(getSarvamBatchConfig(env), transport).upload("job", "recording.webm", new ReadableStream({ start(controller) { controller.close(); } }), bytes, "audio/webm");
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30_000, sarvamUploadTimeoutMs(bytes, 30_000)]);
    timeout.mockRestore();
  });
});
