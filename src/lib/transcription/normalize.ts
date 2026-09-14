import { createHash } from "node:crypto";
import { z } from "zod";
import type { NormalizedTranscript } from "./types";
import { TranscriptionFailure } from "./errors";

export const TRANSCRIPT_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, entries: 20_000, speakers: 16, segmentCharacters: 16_000, sourceCharacters: 2_000_000, durationToleranceMs: 2_000 });
const text = (maximum: number) => z.string().min(1).max(maximum).refine((value) => value.trim().length > 0);
const resultSchema = z.object({
  request_id: z.string().min(1).max(255),
  transcript: text(TRANSCRIPT_LIMITS.sourceCharacters),
  language_code: z.string().min(1).max(32),
  diarized_transcript: z.object({ entries: z.array(z.object({
    transcript: text(TRANSCRIPT_LIMITS.segmentCharacters),
    start_time_seconds: z.number().finite().nonnegative(),
    end_time_seconds: z.number().finite().nonnegative(),
    speaker_id: text(64),
  })).min(1).max(TRANSCRIPT_LIMITS.entries) }),
});

/** Preserve provider order and text exactly; overlapping speech is valid. */
export function normalizeSarvamResult(payload: unknown, durationMs: number): NormalizedTranscript {
  const parsed = resultSchema.safeParse(payload);
  if (!parsed.success || !Number.isSafeInteger(durationMs) || durationMs <= 0) throw new TranscriptionFailure("INVALID_RESPONSE");
  const speakers = new Set<string>();
  const segments = parsed.data.diarized_transcript.entries.map((entry, ordinal) => {
    speakers.add(entry.speaker_id);
    if (entry.end_time_seconds < entry.start_time_seconds || entry.end_time_seconds * 1_000 > durationMs + TRANSCRIPT_LIMITS.durationToleranceMs) throw new TranscriptionFailure("INVALID_RESPONSE");
    // Nearest integer millisecond, not truncation. Validate before rounding.
    return { ordinal, speakerLabel: entry.speaker_id, startMs: Math.round(entry.start_time_seconds * 1_000), endMs: Math.round(entry.end_time_seconds * 1_000), text: entry.transcript };
  });
  if (speakers.size > TRANSCRIPT_LIMITS.speakers || segments.reduce((sum, segment) => sum + segment.text.length, 0) > TRANSCRIPT_LIMITS.sourceCharacters) throw new TranscriptionFailure("INVALID_RESPONSE");
  return { sourceText: parsed.data.transcript, languageCode: parsed.data.language_code, providerRequestId: parsed.data.request_id, segments };
}

/** Stable evidence integrity checksum; this is NOT a digital signature. */
export function transcriptSourceHash(source: NormalizedTranscript): string {
  const canonical = JSON.stringify({ version: 1, sourceText: source.sourceText, segments: source.segments.map((segment) => [segment.ordinal, segment.speakerLabel, segment.startMs, segment.endMs, segment.text]) });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Bound the stream before decoding/JSON parsing; do not use response.json(). */
export async function readBoundedProviderJson(response: Response, maximum = TRANSCRIPT_LIMITS.bytes): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel();
    throw new TranscriptionFailure("INVALID_RESPONSE");
  }
  if (!response.body) throw new TranscriptionFailure("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new TranscriptionFailure("INVALID_RESPONSE");
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TranscriptionFailure) throw error;
    throw new TranscriptionFailure("INVALID_RESPONSE");
  } finally { reader.releaseLock(); }
}
