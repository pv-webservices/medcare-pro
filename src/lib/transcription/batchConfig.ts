import { z } from "zod";
import { TranscriptionFailure } from "./errors";

const keytermsSchema = z.array(z.string().trim().min(1).max(64)).max(50).refine((terms) => new Set(terms).size === terms.length);
const integer = (value: string | undefined, fallback: number, maximum: number, minimum = 1) => {
  const parsed = z.coerce.number().int().min(minimum).max(maximum).safeParse(value?.trim() || fallback);
  if (!parsed.success) throw new TranscriptionFailure("CONFIGURATION");
  return parsed.data;
};

/** Server-only Batch configuration. Gemini/automatic fallback is not supported. */
export function getSarvamBatchConfig(env: Record<string, string | undefined> = process.env) {
  if (env.TRANSCRIPTION_PRIMARY_PROVIDER !== "sarvam" || (env.SARVAM_TRANSCRIPTION_MODEL && env.SARVAM_TRANSCRIPTION_MODEL !== "saaras:v4") || (env.TRANSCRIPTION_AUTO_FALLBACK && env.TRANSCRIPTION_AUTO_FALLBACK !== "false") || !env.SARVAM_API_SUBSCRIPTION_KEY?.trim()) throw new TranscriptionFailure("CONFIGURATION");
  let terms: unknown;
  try { terms = JSON.parse(env.SARVAM_TRANSCRIPTION_KEYTERMS_JSON || "[]"); } catch { throw new TranscriptionFailure("CONFIGURATION"); }
  const keyterms = keytermsSchema.safeParse(terms);
  if (!keyterms.success) throw new TranscriptionFailure("CONFIGURATION");
  let callback: { url: string; auth_token: string } | undefined;
  if (env.CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL || env.SARVAM_WEBHOOK_SECRET) {
    if (!env.CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL || !env.SARVAM_WEBHOOK_SECRET || env.SARVAM_WEBHOOK_SECRET.length < 32 || env.SARVAM_WEBHOOK_SECRET.length > 512) throw new TranscriptionFailure("CONFIGURATION");
    let base: URL;
    try { base = new URL(env.CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL); } catch { throw new TranscriptionFailure("CONFIGURATION"); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) throw new TranscriptionFailure("CONFIGURATION");
    callback = { url: new URL("/api/clinical-ai/transcription/webhooks/sarvam", base).toString(), auth_token: env.SARVAM_WEBHOOK_SECRET };
  }
  return {
    apiKey: env.SARVAM_API_SUBSCRIPTION_KEY.trim(),
    model: "saaras:v4" as const,
    keyterms: keyterms.data,
    callback,
    requestTimeoutMs: integer(env.SARVAM_TIMEOUT_MS, 30000, 120000, 1000),
    pollAfterSeconds: integer(env.SARVAM_POLL_AFTER_SECONDS, 30, 3600),
    pollIntervalSeconds: integer(env.SARVAM_POLL_INTERVAL_SECONDS, 30, 3600),
    jobTimeoutMinutes: integer(env.SARVAM_JOB_TIMEOUT_MINUTES, 180, 1440),
  };
}
export type SarvamBatchConfig = ReturnType<typeof getSarvamBatchConfig>;
