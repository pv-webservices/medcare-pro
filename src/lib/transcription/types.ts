export type TranscriptionProviderName = "SARVAM" | "GEMINI";
export type TranscriptSegment = { ordinal: number; speakerLabel: string; startMs: number; endMs: number; text: string };
export type NormalizedTranscript = { sourceText: string; languageCode?: string; segments: TranscriptSegment[] };

export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName;
  readonly model: string;
  submit(input: { storageKey: string; mode: "verbatim"; diarization: boolean; expectedSpeakers: number; keyterms: string[] }): Promise<{ providerJobId: string }>;
  parseResult(payload: unknown): NormalizedTranscript;
}
