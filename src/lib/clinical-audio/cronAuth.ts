import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
/** Default private secret file in the hosting account's home directory. The
 * same file the cron job reads, so the secret never appears in a command,
 * crontab listing or hosting API response. */
export const DEFAULT_CRON_SECRET_FILE = ".clinical-audio-cron-secret";

type SecretLocations = {
  cwd: string;
  home: string | undefined;
  userHome: string | undefined;
};

function accountHome(): string | undefined {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}

function currentLocations(): SecretLocations {
  return { cwd: process.cwd(), home: homedir(), userHome: accountHome() };
}

/**
 * Where to look for the secret file. The hosting process may run with a HOME
 * that is not the account home the cron shell uses, so check the account's
 * passwd home, then HOME, then every directory above the app (the app is
 * deployed beneath the account home). An explicit path is never second-guessed.
 */
export function cronSecretFileCandidates(
  env: Record<string, string | undefined>,
  locations: SecretLocations = currentLocations(),
): string[] {
  if (env.CLINICAL_AUDIO_CRON_SECRET_FILE)
    return [env.CLINICAL_AUDIO_CRON_SECRET_FILE];
  const directories = [locations.userHome, locations.home];
  for (let dir = resolve(locations.cwd); ; dir = dirname(dir)) {
    directories.push(dir);
    if (dirname(dir) === dir) break;
  }
  return [
    ...new Set(
      directories
        .filter((dir): dir is string => !!dir)
        .map((dir) => join(dir, DEFAULT_CRON_SECRET_FILE)),
    ),
  ];
}

/** Env value first; otherwise the first non-empty private secret file. Read
 * per request so a rotated file takes effect without a restart. */
export function resolveClinicalAudioCronSecret(
  env: Record<string, string | undefined> = process.env,
  locations?: SecretLocations,
): string | undefined {
  if (env.CLINICAL_AUDIO_CRON_SECRET) return env.CLINICAL_AUDIO_CRON_SECRET;
  for (const path of cronSecretFileCandidates(env, locations)) {
    try {
      // Runtime-only path: keep bundlers from tracing the whole project.
      const value = readFileSync(/*turbopackIgnore: true*/ path, "utf8").trim();
      if (value) return value;
    } catch {
      // Absent or unreadable here; try the next location.
    }
  }
  return undefined;
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
