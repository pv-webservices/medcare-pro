import { describe, expect, it } from "vitest";
import {
  effectiveTranscriptHash,
  effectiveTranscriptSegments,
} from "@/lib/transcription/effectiveTranscript";

const at = (n: number) => new Date(Date.UTC(2026, 8, 23, 10, 0, n));
const transcript = () => ({
  segments: [
    { id: "seg-b", ordinal: 1, speakerLabel: "speaker_1", startMs: 17000, endMs: 20000, text: "No chest pain." },
    { id: "seg-a", ordinal: 0, speakerLabel: "speaker_0", startMs: 0, endMs: 18000, text: "Metformin 500 mg once daily." },
  ],
  speakerMappings: [
    { speakerLabel: "speaker_0", speakerType: "DOCTOR" },
    { speakerLabel: "speaker_1", speakerType: "PATIENT" },
  ],
  corrections: [] as { id: string; segmentId: string | null; correctedText: string; supersedesCorrectionId: string | null; createdAt: Date }[],
});

describe("effective transcript (what the doctor actually reviewed)", () => {
  it("orders segments by ordinal and carries speaker roles", () => {
    const segments = effectiveTranscriptSegments(transcript());
    expect(segments.map((s) => s.segmentId)).toEqual(["seg-a", "seg-b"]);
    expect(segments.map((s) => s.speakerType)).toEqual(["DOCTOR", "PATIENT"]);
    expect(segments[1]).toMatchObject({ text: "No chest pain.", correctionId: null });
  });

  it("uses the latest correction in each supersession chain", () => {
    const t = transcript();
    t.corrections.push(
      { id: "c1", segmentId: "seg-b", correctedText: "No chest pain for three days.", supersedesCorrectionId: null, createdAt: at(1) },
      { id: "c2", segmentId: "seg-b", correctedText: "No chest pain for 3 days.", supersedesCorrectionId: "c1", createdAt: at(2) },
    );
    const segment = effectiveTranscriptSegments(t)[1];
    expect(segment).toMatchObject({ text: "No chest pain for 3 days.", correctionId: "c2" });
  });

  it("ignores corrections without a segment and unknown speaker labels become UNKNOWN", () => {
    const t = transcript();
    t.corrections.push({ id: "c0", segmentId: null, correctedText: "free-text note", supersedesCorrectionId: null, createdAt: at(1) });
    t.speakerMappings.pop();
    const segments = effectiveTranscriptSegments(t);
    expect(segments.every((s) => s.correctionId === null)).toBe(true);
    expect(segments[1].speakerType).toBe("UNKNOWN");
  });

  it("hash is deterministic and independent of input ordering", () => {
    const a = effectiveTranscriptHash(effectiveTranscriptSegments(transcript()));
    const reversed = transcript();
    reversed.segments.reverse();
    reversed.speakerMappings.reverse();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(effectiveTranscriptHash(effectiveTranscriptSegments(reversed))).toBe(a);
  });

  it("hash changes with every reviewed attribute", () => {
    const base = effectiveTranscriptHash(effectiveTranscriptSegments(transcript()));
    const variants = [
      (t: ReturnType<typeof transcript>) => { t.corrections.push({ id: "c1", segmentId: "seg-b", correctedText: "Chest pain.", supersedesCorrectionId: null, createdAt: at(1) }); },
      (t: ReturnType<typeof transcript>) => { t.speakerMappings[1].speakerType = "CAREGIVER"; },
      (t: ReturnType<typeof transcript>) => { t.segments[0].startMs = 17001; },
      (t: ReturnType<typeof transcript>) => { t.segments[0].endMs = 20001; },
      (t: ReturnType<typeof transcript>) => { t.segments[0].speakerLabel = "speaker_0"; },
      (t: ReturnType<typeof transcript>) => { t.segments[1].text = "Metformin 50 mg once daily."; },
    ];
    for (const change of variants) {
      const t = transcript();
      change(t);
      expect(effectiveTranscriptHash(effectiveTranscriptSegments(t))).not.toBe(base);
    }
  });

  it("text boundaries cannot collide across segments", () => {
    const one = transcript();
    one.segments[1].text = "a";
    one.segments[0].text = "bc";
    const two = transcript();
    two.segments[1].text = "ab";
    two.segments[0].text = "c";
    expect(effectiveTranscriptHash(effectiveTranscriptSegments(one))).not.toBe(
      effectiveTranscriptHash(effectiveTranscriptSegments(two)),
    );
  });
});
