import { describe, it, expect, vi } from "vitest";
import { GeminiTranscriptionProvider, GEMINI_DIARIZED_MAX_DURATION_MS, getGeminiTranscriptionConfig, normalizeGeminiResult } from "@/lib/transcription/providers/gemini";
const payload = () => ({ id: "interactions/synthetic", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Hello, patient.", annotations: [
  { type: "word_info", text: "Hello", speaker: "spk_1", start_offset: "0.1s", end_offset: "0.2s" },
  { type: "word_info", text: ",", speaker: "spk_1", start_offset: "0.2s", end_offset: "0.2s" },
  { type: "word_info", text: "patient.", speaker: "spk_2", start_offset: "0.3s", end_offset: "0.5s" },
] }] }] });
const config = { apiKey: "synthetic-never-sent", model: "gemini-3.5-transcribe" as const };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe("Gemini evidence normalization", () => {
  it("uses the actual last word end for overlapping same-speaker words", () => {
    const p = payload(); p.steps[0].content[0].annotations[1].start_offset = "0.15s"; p.steps[0].content[0].annotations[1].end_offset = "0.15s";
    expect(normalizeGeminiResult(p, 60000).segments[0].endMs).toBe(150);
  });
  it("enforces eight distinct speakers across both supported label formats", () => {
    const p = payload(); p.steps[0].content[0].annotations = Array.from({ length: 9 }, (_, i) => ({ type: "word_info", text: "synthetic", speaker: i < 8 ? `spk_${i + 1}` : "spk:0", start_offset: "0.1s", end_offset: "0.2s" }));
    expect(() => normalizeGeminiResult(p, 60000)).toThrow("INVALID_RESPONSE");
  });
  it("accepts the observed store:false response without an ID and zero-based colon speakers", () => {
    const p = payload();
    const { id: _id, ...unstored } = p;
    expect(_id).toBeTruthy();
    unstored.steps[0].content[0].annotations.forEach((w, index) => { w.speaker = index < 2 ? "spk:0" : "spk:1"; });
    const result = normalizeGeminiResult(unstored, 60_000);
    expect(result.providerRequestId).toBeUndefined();
    expect(result.segments.map(s => s.speakerLabel)).toEqual(["spk:0", "spk:1"]);
  });
  it("groups consecutive speakers with punctuation and real timestamps", () => {
    const r = normalizeGeminiResult(payload(), 60_000); expect(r.sourceText).toBe("Hello, patient."); expect(r.segments).toEqual([{ ordinal: 0, speakerLabel: "spk_1", startMs: 100, endMs: 200, text: "Hello," }, { ordinal: 1, speakerLabel: "spk_2", startMs: 300, endMs: 500, text: "patient." }]);
  });
  it.each([29 * 60_000, GEMINI_DIARIZED_MAX_DURATION_MS])("accepts supported duration %i", d => expect(normalizeGeminiResult(payload(), d).segments).toHaveLength(2));
  it.each([GEMINI_DIARIZED_MAX_DURATION_MS + 1, 0, NaN, Infinity])("rejects duration %s", d => expect(() => normalizeGeminiResult(payload(), d)).toThrow("INVALID_RESPONSE"));
  it.each(["", "spk_9", "doctor", null])("rejects invalid speaker %s", speaker => { const p = payload(); Object.assign(p.steps[0].content[0].annotations[0], { speaker }); expect(() => normalizeGeminiResult(p, 60_000)).toThrow("INVALID_RESPONSE"); });
  it.each(["NaNs", "-1s", "Infinitys", "70s", "invalid"]) ("rejects offset %s", end_offset => { const p = payload(); p.steps[0].content[0].annotations[0].end_offset = end_offset; expect(() => normalizeGeminiResult(p, 60_000)).toThrow("INVALID_RESPONSE"); });
  it("rejects inverted timestamps", () => { const p = payload(); p.steps[0].content[0].annotations[0].end_offset = "0.01s"; expect(() => normalizeGeminiResult(p, 60_000)).toThrow("INVALID_RESPONSE"); });
  it("requires annotations and text", () => { const p = payload(); p.steps[0].content[0].annotations = []; expect(() => normalizeGeminiResult(p, 60_000)).toThrow(); expect(() => normalizeGeminiResult({}, 60_000)).toThrow(); });
});
describe("Gemini Files lifecycle", () => {
  function setup(failDelete = false, result: unknown = payload()) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=synthetic" } })).mockResolvedValueOnce(json({ file: { name: "files/synthetic", uri: "https://generativelanguage.googleapis.com/v1beta/files/synthetic", state: "ACTIVE" } })).mockResolvedValueOnce(json(result)).mockResolvedValueOnce(new Response(null, { status: failDelete ? 500 : 200 }));
    const artifact = vi.fn(async () => undefined);
    const input = { stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } }), bytes: 10, mime: "audio/webm", durationMs: 60_000, signal: new AbortController().signal, artifact };
    return { fetchMock, artifact, input, provider: new GeminiTranscriptionProvider(config, fetchMock) };
  }
  it("uses Files, verbatim, diarization, timestamps, automatic language and explicit deletion", async () => {
    const s = setup(); await s.provider.transcribe(s.input);
    const body = JSON.parse(s.fetchMock.mock.calls[2][1]!.body as string);
    expect(body).toMatchObject({ model: config.model, store: false, generation_config: { transcription_config: { language_codes: [], mode: { type: "verbatim", diarization_mode: "speaker", timestamp_granularities: ["word"] } } } });
    expect(body.generation_config.transcription_config.custom_vocabulary).toBeUndefined(); expect(s.artifact.mock.calls).toEqual([["files/synthetic", false], ["files/synthetic", true]]);
    expect(s.fetchMock.mock.calls[3][1]?.method).toBe("DELETE");
  });
  it("keeps pending cleanup metadata when deletion fails", async () => { const s = setup(true); await s.provider.transcribe(s.input); expect(s.artifact.mock.calls).toEqual([["files/synthetic", false]]); });
  it("deletes the file after malformed transcription", async () => { const s = setup(false, {}); await expect(s.provider.transcribe(s.input)).rejects.toThrow(); expect(s.fetchMock.mock.calls[3][1]?.method).toBe("DELETE"); });
  it.each([429, 500, 503])("sanitizes upload rejection %i", async status => { const f = vi.fn<typeof fetch>().mockResolvedValue(json({ secret: "must-not-escape" }, status)); const p = new GeminiTranscriptionProvider(config, f); await expect(p.transcribe(setup().input)).rejects.toMatchObject({ code: status === 429 ? "RATE_LIMIT" : "PROVIDER_FAILURE" }); });
  it("sanitizes transport timeout", async () => { const f = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("private request details", "TimeoutError")); await expect(new GeminiTranscriptionProvider(config, f).transcribe(setup().input)).rejects.toMatchObject({ code: "TIMEOUT" }); });
  it("rejects external upload destinations", async () => { const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { headers: { "x-goog-upload-url": "https://evil.invalid/upload" } })); await expect(new GeminiTranscriptionProvider(config, f).transcribe(setup().input)).rejects.toThrow("INVALID_RESPONSE"); expect(f).toHaveBeenCalledTimes(1); });
  it("treats provider file absence as successful deletion", async () => { await new GeminiTranscriptionProvider(config, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))).deleteFile("files/synthetic"); });
});
describe("isolated Gemini configuration", () => {
  const env = { TRANSCRIPTION_FALLBACK_PROVIDER: "gemini", TRANSCRIPTION_AUTO_FALLBACK: "false", GEMINI_TRANSCRIPTION_API_KEY: "synthetic-isolated", GEMINI_API_KEY: "synthetic-writing" };
  it("prefers isolated credential", () => expect(getGeminiTranscriptionConfig(env).apiKey).toBe("synthetic-isolated"));
  it("intentionally supports the writing credential compatibility fallback", () => expect(getGeminiTranscriptionConfig({ ...env, GEMINI_TRANSCRIPTION_API_KEY: "" }).apiKey).toBe("synthetic-writing"));
  it.each([{ TRANSCRIPTION_AUTO_FALLBACK: "true" }, { GEMINI_TRANSCRIPTION_MODEL: "other" }, { TRANSCRIPTION_FALLBACK_PROVIDER: "sarvam" }, { GEMINI_TRANSCRIPTION_API_KEY: "", GEMINI_API_KEY: "" }])("fails closed for invalid config %j", override => expect(() => getGeminiTranscriptionConfig({ ...env, ...override })).toThrow("CONFIGURATION"));
});
