/**
 * Transactional email — FR-1.2 (signup verification).
 *
 * ============================================================================
 * STUB — PROVIDER NOT YET SELECTED (PRD §10 Assumptions).
 *
 * The signatures below are final: `api/auth/signup` and `api/auth/verify-email`
 * are written against them, so implementing this file means filling in the
 * bodies only, without touching a call site.
 *
 * Every function throws rather than silently no-opping. A signup that appears
 * to succeed while sending no verification email would strand the account in an
 * unverifiable state, which is worse than failing loudly.
 *
 * To implement: pick a provider (Resend, SendGrid, …), add its SDK, and read
 * EMAIL_API_KEY / EMAIL_FROM_ADDRESS / EMAIL_API_BASE_URL from .env.
 * ============================================================================
 */

const NOT_IMPLEMENTED = "Not implemented — pending provider selection";

export interface SendVerificationEmailParams {
  /** Address collected at signup — the Tenant's contact email. */
  to: string;
  /** Business name, for the greeting. */
  businessName: string;
  /** Fully-qualified link to /verify-email carrying the token. */
  verificationUrl: string;
}

/**
 * Sends the FR-1.2 verification link. Called by `api/auth/signup` after the
 * Tenant/User rows and the VerificationToken are written.
 */
export async function sendVerificationEmail(
  _params: SendVerificationEmailParams,
): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Re-sends the verification link — FR-1.5's "resend" option on the login page
 * when an unverified account attempts to sign in.
 */
export async function resendVerificationEmail(
  _params: SendVerificationEmailParams,
): Promise<void> {
  throw new Error(NOT_IMPLEMENTED);
}
