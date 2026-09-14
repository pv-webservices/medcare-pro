import type { TranscriptionProvider } from "./types";
import { MockGeminiTranscriptionProvider, MockSarvamTranscriptionProvider } from "./providers/mock";

export function getTranscriptionProvider(name: "SARVAM" | "GEMINI"): TranscriptionProvider {
  if (process.env.NODE_ENV === "test") return name === "SARVAM" ? new MockSarvamTranscriptionProvider() : new MockGeminiTranscriptionProvider();
  throw new Error("LIVE_TRANSCRIPTION_PROVIDER_NOT_CONFIGURED");
}
