import { z } from "zod";

const E164_DIGITS = /^[1-9]\d{7,14}$/;
const E164_VALUE = /^\+[1-9]\d{7,14}$/;
const PHONE_MESSAGE = "Use an international number such as +14155550100.";

/** Canonicalizes configuration input. A country code must be explicit. */
export function normalizeConfiguredPhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!E164_VALUE.test(trimmed)) {
    throw new Error(PHONE_MESSAGE);
  }
  return trimmed;
}

/**
 * Canonicalizes the validated Plivo `To` value. Plivo documents the value as
 * country-coded, while examples vary on whether the leading plus is present.
 */
export function normalizePlivoDestinationNumber(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!E164_DIGITS.test(digits)) {
    throw new Error(PHONE_MESSAGE);
  }
  return `+${digits}`;
}

/** A provider caller number is accepted only when it already carries a country code. */
export function normalizePlivoCallerNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizePlivoDestinationNumber(value);
  } catch {
    return null;
  }
}

/**
 * Formats a canonical caller number for staff without guessing national formats.
 * Indian +91 numbers are shown in their exact ten-digit domestic form; every
 * other valid E.164 value remains canonical.
 */
export function formatCallerNumberForDisplay(canonical: string): string {
  return /^\+91[1-9]\d{9}$/.test(canonical) ? canonical.slice(3) : canonical;
}

/** India domestic voice routes require a canonical +91 ten-digit number. */
export function isCanonicalIndianPhoneNumber(value: string): boolean {
  return /^\+91[1-9]\d{9}$/.test(value);
}

/**
 * Patient.mobileNumber currently permits these two exact Indian forms. We do
 * not strip punctuation or guess a country for a local-looking caller value.
 */
export function patientMobileRepresentations(
  canonicalCallerNumber: string,
): readonly string[] {
  if (!/^\+91\d{10}$/.test(canonicalCallerNumber)) return [];
  return [canonicalCallerNumber, canonicalCallerNumber.slice(3)];
}

export const configuredPhoneNumberSchema = z
  .string()
  .trim()
  .regex(E164_VALUE, PHONE_MESSAGE)
  .transform(normalizeConfiguredPhoneNumber);

export const optionalConfiguredPhoneNumberSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? null : value,
  z.union([configuredPhoneNumberSchema, z.null()]),
);

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required.")
  .max(64)
  .refine(isValidIanaTimezone, "Use a valid IANA timezone.");
