import { createHash } from "node:crypto";

type SegmentInput = {
  id: string;
  ordinal: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
};
type CorrectionInput = {
  id: string;
  segmentId: string | null;
  correctedText: string;
  supersedesCorrectionId: string | null;
};
type SpeakerInput = { speakerLabel: string; speakerType: string };

export type EffectiveTranscriptSegment = {
  segmentId: string;
  ordinal: number;
  speakerLabel: string;
  speakerType: string;
  startMs: number;
  endMs: number;
  /** Latest correction if any, otherwise the immutable provider text. */
  text: string;
  correctionId: string | null;
};

/**
 * The transcript exactly as a clinician sees and reviews it: immutable
 * provider segments, each replaced by the head of its correction chain, with
 * confirmed speaker roles. AI-3 evidence must reference this state.
 */
export function effectiveTranscriptSegments(transcript: {
  segments: SegmentInput[];
  corrections: CorrectionInput[];
  speakerMappings: SpeakerInput[];
}): EffectiveTranscriptSegment[] {
  const roles = new Map(
    transcript.speakerMappings.map((m) => [m.speakerLabel, m.speakerType]),
  );
  const superseded = new Set(
    transcript.corrections.map((c) => c.supersedesCorrectionId),
  );
  const latest = new Map<string, CorrectionInput>();
  for (const correction of transcript.corrections)
    if (correction.segmentId && !superseded.has(correction.id))
      latest.set(correction.segmentId, correction);
  return [...transcript.segments]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((segment) => {
      const correction = latest.get(segment.id);
      return {
        segmentId: segment.id,
        ordinal: segment.ordinal,
        speakerLabel: segment.speakerLabel,
        speakerType: roles.get(segment.speakerLabel) ?? "UNKNOWN",
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: correction?.correctedText ?? segment.text,
        correctionId: correction?.id ?? null,
      };
    });
}

/** SHA-256 over a canonical, order-fixed tuple encoding. JSON string escaping
 * keeps field boundaries unambiguous. */
export function effectiveTranscriptHash(
  segments: EffectiveTranscriptSegment[],
): string {
  const canonical = JSON.stringify(
    segments.map((s) => [
      s.segmentId,
      s.ordinal,
      s.speakerLabel,
      s.speakerType,
      s.startMs,
      s.endMs,
      s.text,
      s.correctionId,
    ]),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
