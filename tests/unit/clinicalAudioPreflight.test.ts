import { describe, it, expect } from "vitest";
import { clinicalAudioPreflight } from "@/lib/clinical-audio/preflight";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
const env = { NODE_ENV: "production", CLINICAL_AUDIO_ENABLED: "true", RECORDING_STORAGE_PROVIDER: "s3", RECORDING_S3_ENDPOINT: "https://storage.example.test", RECORDING_S3_REGION: "test-region", RECORDING_S3_BUCKET: "synthetic-private", RECORDING_S3_ACCESS_KEY_ID: "synthetic", RECORDING_S3_SECRET_ACCESS_KEY: "synthetic", RECORDING_AUDIO_RETENTION_DAYS: "7", TRANSCRIPTION_PRIMARY_PROVIDER: "sarvam", SARVAM_API_SUBSCRIPTION_KEY: "synthetic", SARVAM_TRANSCRIPTION_MODEL: "saaras:v4", TRANSCRIPTION_AUTO_FALLBACK: "false", TRANSCRIPTION_FALLBACK_PROVIDER: "gemini", CLINICAL_AUDIO_WORKER_MODE: "scheduled-once", SARVAM_WEBHOOK_SECRET: "synthetic-secret-at-least-thirty-two-characters", CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL: "https://callback.example.test" };
describe("production recording gates", () => {
  it("requires real private storage and explicit retention", () => expect(getClinicalAudioConfig(env)).not.toBeNull());
  it.each(["", "0", "-1", "3651", "garbage"]) ("rejects retention %s", value => expect(getClinicalAudioConfig({ ...env, RECORDING_AUDIO_RETENTION_DAYS: value })).toBeNull());
  it("requires worker supervision", () => expect(getClinicalAudioConfig({ ...env, CLINICAL_AUDIO_WORKER_MODE: "" })).toBeNull());
  it("requires primary processor config", () => expect(getClinicalAudioConfig({ ...env, SARVAM_API_SUBSCRIPTION_KEY: "" })).toBeNull());
  it("missing Gemini does not break primary recording", () => expect(getClinicalAudioConfig(env)).not.toBeNull());
  it("missing Gemini unavailable when no tenant opted in", () => expect(clinicalAudioPreflight(env).checks.find(c => c.name === "Gemini fallback configuration")?.result).toBe("UNAVAILABLE"));
  it("requires Gemini when approved tenants opted in", () => expect(clinicalAudioPreflight(env, true).checks.find(c => c.name === "Gemini fallback configuration")?.result).toBe("FAIL"));
  it("disabled status does not claim production readiness", () => expect(clinicalAudioPreflight({ CLINICAL_AUDIO_ENABLED: "false" }).state).toBe("CONFIGURED BUT DISABLED"));
  it("never returns credential values", () => expect(JSON.stringify(clinicalAudioPreflight(env))).not.toContain("synthetic-secret"));
});
