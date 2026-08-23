/**
 * The forgot-password / reset-password forms' decisions, extracted from their
 * rendering — same pattern, and same reasoning, as loginCodeState.ts.
 *
 * Every function here is pure: no clock, no `window`, no fetch, no React. This
 * repository runs Vitest in a Node environment with no DOM (see
 * vitest.config.ts), so logic that stays inside a component is logic that stays
 * untested.
 *
 * COPY IS CHOSEN BY HTTP STATUS ALONE. The response body is never consulted, so
 * no server string, proxy error page, or exception text can reach the screen.
 * The strings below mirror the ones in src/lib/passwordReset.ts, which is the
 * authority; the request endpoint currently returns only curated messages, but
 * "currently" is not a property worth depending on.
 */

/** Mirrors RESET_REQUESTED_MESSAGE in src/lib/passwordReset.ts. */
export const RESET_SENT_MESSAGE =
  "If that account can be reset, a link is on its way. Check your inbox.";

/** Mirrors RESET_UNKNOWN_ACCOUNT_MESSAGE in src/lib/passwordReset.ts. */
export const RESET_UNKNOWN_ACCOUNT_MESSAGE =
  "No account exists for that email address. Sign up to create one.";

/** Mirrors RESET_LINK_INVALID_MESSAGE in src/lib/passwordReset.ts. */
export const RESET_LINK_INVALID_MESSAGE =
  "That reset link is no longer valid. Request a new one.";

/** Mirrors RATE_LIMITED_MESSAGE in src/lib/rateLimit.ts. */
export const RESET_RATE_LIMITED_MESSAGE =
  "Too many attempts. Wait a few minutes and try again.";

export const RESET_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

export const RESET_REQUEST_FAILED_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

export const RESET_MISMATCH_MESSAGE =
  "Those passwords do not match. Check both fields and try again.";

export type ResetRequestKind =
  | "sent"
  | "unknown-account"
  | "invalid-email"
  | "rate-limited"
  | "failed";

export interface ResetRequestOutcome {
  kind: ResetRequestKind;
  message: string;
  /** Whether the form should switch to its "we've emailed you" confirmation. */
  sent: boolean;
  /**
   * Whether to offer a link to /signup alongside the message. True only for the
   * one branch where creating an account is the actual next step.
   */
  offerSignup: boolean;
}

/**
 * Turns the request endpoint's status into copy.
 *
 * 404 IS THE DISCLOSED BRANCH — it means the address is not registered, which
 * this product has chosen to say out loud. See the enumeration note at the top
 * of src/lib/passwordReset.ts. Every other status says nothing about any
 * account.
 */
export function describeResetRequest(status: number): ResetRequestOutcome {
  if (status === 200) {
    return { kind: "sent", message: RESET_SENT_MESSAGE, sent: true, offerSignup: false };
  }
  if (status === 404) {
    return {
      kind: "unknown-account",
      message: RESET_UNKNOWN_ACCOUNT_MESSAGE,
      sent: false,
      offerSignup: true,
    };
  }
  if (status === 429) {
    return {
      kind: "rate-limited",
      message: RESET_RATE_LIMITED_MESSAGE,
      sent: false,
      offerSignup: false,
    };
  }
  if (status === 400) {
    return {
      kind: "invalid-email",
      message: RESET_INVALID_EMAIL_MESSAGE,
      sent: false,
      offerSignup: false,
    };
  }
  return {
    kind: "failed",
    message: RESET_REQUEST_FAILED_MESSAGE,
    sent: false,
    offerSignup: false,
  };
}

export type ResetConfirmKind = "changed" | "weak-password" | "dead-link" | "failed";

export interface ResetConfirmOutcome {
  kind: ResetConfirmKind;
  /** Null when the server's own validation message should be shown instead. */
  message: string | null;
  changed: boolean;
}

/**
 * Turns the confirm endpoint's status into an outcome.
 *
 * 400 IS THE ONE STATUS WHOSE BODY THE CALLER MAY USE, and the only one — it
 * carries the password-rule message the user must read to comply ("at least N
 * characters"). `message: null` signals that; the component substitutes a
 * generic sentence when the body has nothing usable. Every other status maps to
 * a constant here.
 */
export function describeResetConfirm(status: number): ResetConfirmOutcome {
  if (status === 200) {
    return { kind: "changed", message: null, changed: true };
  }
  if (status === 400) {
    return { kind: "weak-password", message: null, changed: false };
  }
  if (status === 410) {
    return { kind: "dead-link", message: RESET_LINK_INVALID_MESSAGE, changed: false };
  }
  return { kind: "failed", message: RESET_REQUEST_FAILED_MESSAGE, changed: false };
}

/** Whether both password fields agree. Not whether either is strong enough. */
export function passwordsMatch(password: string, confirmation: string): boolean {
  return password === confirmation;
}
