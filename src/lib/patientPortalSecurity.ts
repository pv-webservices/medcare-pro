import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export const PORTAL_COOKIE = "medcare_patient_session";
export const SESSION_TTL = 12 * 60 * 60 * 1000;
export const ACTIVATION_TTL = 24 * 60 * 60 * 1000;
export const OTP_TTL = 10 * 60 * 1000;
export const OTP_ATTEMPTS = 5;
export const PORTAL_LOGIN_MESSAGE =
  "If an active Patient Portal account exists for this number, a verification code has been sent.";
export class PatientPortalError extends Error {
  constructor(
    public readonly status: number,
    message = "Patient Portal is unavailable. Please contact your clinic.",
  ) {
    super(message);
  }
}
export function normalizePatientMobile(input: string): string {
  const compact = input.trim().replace(/[ ()-]/g, "");
  const digits = compact.replace(/^(\+91|0091|91)(?=[6-9]\d{9}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits))
    throw new PatientPortalError(400, "Enter a valid Indian mobile number.");
  return `+91${digits}`;
}
export const maskPatientMobile = (mobile: string) =>
  `******${mobile.slice(-4)}`;
export const portalToken = () => randomBytes(32).toString("base64url");
export const hashPortalToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const portalCode = () =>
  randomInt(0, 1_000_000).toString().padStart(6, "0");
export function portalPepper(): string {
  const secret = process.env.PATIENT_PORTAL_OTP_SECRET ?? "";
  if (secret.length < 32) throw new PatientPortalError(503);
  return secret;
}
export function portalCodeDigest(
  id: string,
  code: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`patient-portal:${id}:${code}`)
    .digest("hex");
}
export function portalCodeMatches(
  id: string,
  code: string,
  digest: string,
  secret: string,
): boolean {
  const expected = Buffer.from(portalCodeDigest(id, code, secret), "hex");
  const actual = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}
export function portalRecordLive(
  record: {
    expiresAt: Date;
    revokedAt?: Date | null;
    consumedAt?: Date | null;
  },
  now: Date,
): boolean {
  return !record.revokedAt && !record.consumedAt && record.expiresAt > now;
}
export function portalChallengeLive(
  record: {
    expiresAt: Date;
    consumedAt: Date | null;
    attemptCount: number;
    maxAttempts: number;
  },
  now: Date,
): boolean {
  return (
    portalRecordLive(record, now) &&
    record.attemptCount < Math.min(record.maxAttempts, OTP_ATTEMPTS)
  );
}
export const portalLoginSchema = z.strictObject({
  mobile: z.string().max(30).transform(normalizePatientMobile),
});
export const portalVerifySchema = z.strictObject({
  mobile: z.string().max(30).transform(normalizePatientMobile),
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});
export const portalActivationRequestSchema = z.strictObject({
  token: z.string().regex(/^[\w-]{43}$/),
});
export const portalActivationVerifySchema =
  portalActivationRequestSchema.extend({
    code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
  });
export const portalStaffActivationSchema = z.strictObject({
  identityVerified: z.literal(true, {
    error: "Confirm patient identity and mobile number.",
  }),
});
export const portalEmptySchema = z.strictObject({});
export const portalPageSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export function portalOrigin(): string {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!raw) throw new PatientPortalError(503);
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new PatientPortalError(503);
  return url.origin;
}
export function assertPortalOrigin(request: Request): void {
  if (
    request.headers.get("origin") !== portalOrigin() ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new PatientPortalError(403, "This request could not be accepted.");
}
