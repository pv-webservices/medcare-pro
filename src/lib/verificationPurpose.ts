/**
 * What a verification token is for — Stage 3.
 *
 * `verification_tokens.purpose` was added in Stage 1 with a schema note that
 * spells out why it has to exist:
 *
 *   At signup the Tenant's address and the applicant User's address are THE
 *   SAME STRING. `VerificationToken.identifier` holds an email, so without a
 *   discriminator a token minted to verify the organisation could be redeemed
 *   to verify the individual, or the reverse. Consumption therefore requires
 *   the expected purpose, and a mismatch is treated as an invalid token.
 *
 * Pure data: no Prisma, no imports. The column is a String rather than an enum
 * so the Stage 1 default backfilled every pre-existing row correctly; the
 * accepted values are pinned here instead.
 */

export const VERIFICATION_PURPOSES = {
  /** Verifies the organisation's address — sets `Tenant.emailVerifiedAt`. */
  TENANT_EMAIL: "TENANT_EMAIL",
  /** Verifies one individual's address — sets `User.emailVerifiedAt`. */
  USER_EMAIL: "USER_EMAIL",
  /**
   * Authorises ONE password change for the address in `identifier` — the
   * "Forgot password?" flow in src/lib/passwordReset.ts.
   *
   * It is a third purpose on the same table rather than a table of its own
   * precisely because the column is a String with a default: adding a value
   * needs no schema change and no migration, and every rule this token has to
   * obey — single use, hashed at rest, expiring — is already implemented once
   * in src/lib/verification.ts.
   *
   * THE DISCRIMINATOR IS DOING REAL WORK HERE, more than for the two above. A
   * signup mints a TENANT_EMAIL token for the same address a reset token is
   * later minted for; without the purpose check, a verification link out of an
   * old inbox would be redeemable as a password reset. `purposeMatches` refuses
   * that in both directions.
   */
  PASSWORD_RESET: "PASSWORD_RESET",
} as const;

export type VerificationPurpose =
  (typeof VERIFICATION_PURPOSES)[keyof typeof VERIFICATION_PURPOSES];

/** The value the Stage 1 column default writes, and what a legacy row holds. */
export const DEFAULT_VERIFICATION_PURPOSE: VerificationPurpose =
  VERIFICATION_PURPOSES.TENANT_EMAIL;

export function isVerificationPurpose(
  value: string | null | undefined,
): value is VerificationPurpose {
  return (
    value === VERIFICATION_PURPOSES.TENANT_EMAIL ||
    value === VERIFICATION_PURPOSES.USER_EMAIL ||
    value === VERIFICATION_PURPOSES.PASSWORD_RESET
  );
}

/**
 * Does a stored row satisfy what the caller asked for?
 *
 * A row written before Stage 1's column existed reads as TENANT_EMAIL, which is
 * exactly what it was: every token issued up to that point came from the signup
 * flow. So a legacy row still redeems against the tenant flow and is refused by
 * the user flow — which is the correct answer in both directions.
 *
 * An unrecognised value matches NOTHING. A row whose purpose we cannot read is
 * a row whose meaning we do not know, and guessing would defeat the point.
 */
export function purposeMatches(
  stored: string | null | undefined,
  expected: VerificationPurpose,
): boolean {
  const normalised = stored ?? DEFAULT_VERIFICATION_PURPOSE;
  if (!isVerificationPurpose(normalised)) {
    return false;
  }
  return normalised === expected;
}
