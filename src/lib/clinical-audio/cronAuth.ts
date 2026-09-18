import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;

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
  const expected = env.CLINICAL_AUDIO_CRON_SECRET;
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
