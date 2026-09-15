import { z } from "zod";
const schema = z.object({
  primary: z.enum(["sarvam", "gemini"]),
  fallback: z.enum(["sarvam", "gemini"]),
  autoFallback: z.boolean(),
  sarvamModel: z.string().default("saaras:v4"),
  geminiModel: z.string().default("gemini-3.5-transcribe"),
  keyterms: z.array(z.string().min(1).max(100)).max(50),
});
export function getTranscriptionConfig(env: Record<string, string | undefined> = process.env) {
  let keyterms: unknown = [];
  try { keyterms = JSON.parse(env.SARVAM_TRANSCRIPTION_KEYTERMS_JSON || "[]"); } catch { return null; }
  const parsed = schema.safeParse({ primary: env.TRANSCRIPTION_PRIMARY_PROVIDER, fallback: env.TRANSCRIPTION_FALLBACK_PROVIDER, autoFallback: env.TRANSCRIPTION_AUTO_FALLBACK === "true", sarvamModel: env.SARVAM_TRANSCRIPTION_MODEL || "saaras:v4", geminiModel: env.GEMINI_TRANSCRIPTION_MODEL || "gemini-3.5-transcribe", keyterms });
  return parsed.success ? parsed.data : null;
}
