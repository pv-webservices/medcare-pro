import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
/** Default private secret file in the hosting account's home directory. The
 * same file the cron job reads, so the secret never appears in a command,
 * crontab listing or hosting API response. */
export const DEFAULT_CRON_SECRET_FILE = ".clinical-audio-cron-secret";

/** Env value first; otherwise the private secret file. Read per request so a
 * rotated file takes effect without a restart. */
export function resolveClinicalAudioCronSecret(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.CLINICAL_AUDIO_CRON_SECRET) return env.CLINICAL_AUDIO_CRON_SECRET;
  const path =
    env.CLINICAL_AUDIO_CRON_SECRET_FILE ||
    join(homedir(), DEFAULT_CRON_SECRET_FILE);
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export type ClinicalAudioCronAuth =
  | "authorized"
  | "unauthorized"
  | "unconfigured";

function fixedDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Authenticate machine triggers without parsing a URL or request body. */
export function authenticateClinicalAudioCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): ClinicalAudioCronAuth {
  const expected = resolveClinicalAudioCronSecret(env);
  if (
    !expected ||
    expected.length < MIN_SECRET_LENGTH ||
    expected.length > MAX_SECRET_LENGTH
  )
    return "unconfigured";

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const supplied = match?.[1];
  if (!supplied || supplied.length > MAX_SECRET_LENGTH) return "unauthorized";

  return timingSafeEqual(fixedDigest(expected), fixedDigest(supplied))
    ? "authorized"
    : "unauthorized";
}

export function clinicalAudioCronEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AI_ENABLED === "true" && env.CLINICAL_AUDIO_ENABLED === "true";
}
