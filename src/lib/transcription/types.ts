export type TranscriptionProviderName = "SARVAM" | "GEMINI";
export const ACTIVE_TRANSCRIPTION_STATUSES = ["QUEUED", "PREPARING", "SUBMITTED", "PROCESSING"] as const;
export type TranscriptSegment = { ordinal: number; speakerLabel: string; startMs: number; endMs: number; text: string };
export type NormalizedTranscript = { sourceText: string; languageCode?: string; providerRequestId?: string; segments: TranscriptSegment[] };

export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName;
  readonly model: string;
  submit(input: { storageKey: string; mode: "verbatim"; diarization: boolean; expectedSpeakers: number; keyterms: string[] }): Promise<{ providerJobId: string }>;
  parseResult(payload: unknown): NormalizedTranscript;
}
