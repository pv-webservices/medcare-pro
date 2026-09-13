import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
export const PORTAL_COOKIE = "medcare_patient_session";
export const SESSION_TTL = 12 * 60 * 60 * 1000;
export const ACTIVATION_TTL = 15 * 60 * 1000;
export const RESET_TTL = ACTIVATION_TTL;
export const EMAIL_VERIFICATION_TTL = 24 * 60 * 60 * 1000;
export const PORTAL_RESET_MESSAGE =
  "If the details match an active Patient Portal account with a verified recovery email, we've sent a password-reset link.";
export class PatientPortalError extends Error {
  constructor(
    public readonly status: number,
    message = "Patient Portal is unavailable. Please contact your clinic.",
  ) {
    super(message);
    this.name = "PatientPortalError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export const portalToken = () => randomBytes(32).toString("base64url");
export const hashPortalToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
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
export const portalOrgSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const portalPatientCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(100);
export const portalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();
export const portalPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.");
export const portalIdentitySchema = z.strictObject({
  organization: portalOrgSchema,
  patientCode: portalPatientCodeSchema,
});
export const portalLoginSchema = portalIdentitySchema.extend({
  password: z.string().min(1).max(128),
});
export const portalTokenSchema = z.string().regex(/^[\w-]{43}$/);
export const portalActivationSchema = z.strictObject({
  token: portalTokenSchema,
  password: portalPasswordSchema,
  email: portalEmailSchema.optional(),
});
export const portalResetRequestSchema = portalIdentitySchema.extend({
  email: portalEmailSchema,
});
export const portalResetSchema = z.strictObject({
  token: portalTokenSchema,
  password: portalPasswordSchema,
});
export const portalEmailChangeSchema = z.strictObject({
  password: z.string().min(1).max(128),
  email: portalEmailSchema,
});
export const portalStaffActivationSchema = z.strictObject({
  identityVerified: z.literal(true, {
    error: "Confirm patient identity in person.",
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
