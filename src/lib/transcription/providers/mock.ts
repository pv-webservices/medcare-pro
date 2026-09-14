import type { NormalizedTranscript, TranscriptionProvider } from "../types";

export class MockSarvamTranscriptionProvider implements TranscriptionProvider {
  readonly name = "SARVAM" as const;
  readonly model = "saaras:v4";
  async submit() { return { providerJobId: "mock-sarvam-job" }; }
  parseResult(): NormalizedTranscript { return { sourceText: "Aapko problem kab se hai? Doctor mujhe three days se fever hai. Chest pain nahi hai.", languageCode: "hi-IN", segments: [{ ordinal: 0, speakerLabel: "speaker_0", startMs: 0, endMs: 1800, text: "Aapko problem kab se hai?" }, { ordinal: 1, speakerLabel: "speaker_1", startMs: 1800, endMs: 4800, text: "Doctor mujhe three days se fever hai. Chest pain nahi hai." }] }; }
}

export class MockGeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "GEMINI" as const;
  readonly model = "gemini-3.5-transcribe";
  async submit() { return { providerJobId: "mock-gemini-job" }; }
  parseResult(): NormalizedTranscript { return new MockSarvamTranscriptionProvider().parseResult(); }
}
