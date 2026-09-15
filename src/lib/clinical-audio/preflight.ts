import { getClinicalAudioConfig } from "./config";
import { getSarvamBatchConfig } from "@/lib/transcription/batchConfig";
import { getGeminiTranscriptionConfig } from "@/lib/transcription/providers/gemini";
export function clinicalAudioPreflight(env: Record<string, string | undefined> = process.env, fallbackRequired = false) {
  const check = (name: string, valid: boolean) => ({ name, result: valid ? "PASS" : "FAIL" });
  const enabled = env.CLINICAL_AUDIO_ENABLED === "true";
  const production = { ...env, NODE_ENV: "production", CLINICAL_AUDIO_ENABLED: "true" };
  let sarvam = false; try { getSarvamBatchConfig(production); sarvam = true; } catch {}
  let gemini = false; try { getGeminiTranscriptionConfig(production); gemini = true; } catch {}
  let callback = false; try { const u = new URL(env.CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL || ""); callback = u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/"; } catch {}
  return { state: enabled ? "ENABLED" : "CONFIGURED BUT DISABLED", checks: [
    check("CLINICAL_AUDIO_ENABLED", ["true", "false"].includes(env.CLINICAL_AUDIO_ENABLED ?? "")),
    check("private real storage provider", env.RECORDING_STORAGE_PROVIDER === "s3"),
    check("storage configuration completeness", !!getClinicalAudioConfig(production)),
    check("storage TLS", /^https:\/\//.test(env.RECORDING_S3_ENDPOINT ?? "")),
    check("explicit retention 1–3650 days", /^\d+$/.test(env.RECORDING_AUDIO_RETENTION_DAYS ?? "") && Number(env.RECORDING_AUDIO_RETENTION_DAYS) >= 1 && Number(env.RECORDING_AUDIO_RETENTION_DAYS) <= 3650),
    check("Sarvam key present", !!env.SARVAM_API_SUBSCRIPTION_KEY?.trim()),
    check("Sarvam model and polling configuration", sarvam),
    check("Sarvam webhook secret", (env.SARVAM_WEBHOOK_SECRET?.length ?? 0) >= 32),
    check("public callback HTTPS origin", callback),
    check("explicit Gemini fallback policy", env.TRANSCRIPTION_FALLBACK_PROVIDER === "gemini" && env.TRANSCRIPTION_AUTO_FALLBACK === "false"),
    { name: "Gemini key present", result: (env.GEMINI_TRANSCRIPTION_API_KEY || env.GEMINI_API_KEY)?.trim() ? "PASS" : fallbackRequired ? "FAIL" : "UNAVAILABLE" },
    { name: "Gemini fallback configuration", result: gemini ? "PASS" : fallbackRequired ? "FAIL" : "UNAVAILABLE" },
    check("worker supervision declared", ["persistent", "scheduled-once", "external"].includes(env.CLINICAL_AUDIO_WORKER_MODE ?? "")),
  ] };
}
