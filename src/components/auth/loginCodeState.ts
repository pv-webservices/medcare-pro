/**
 * The login-code form's decisions, extracted from its rendering — Stage 5.
 *
 * Every function here is pure: same input, same output, no clock of its own, no
 * `window`, no fetch, no React. That is what makes them testable at all — this
 * repository runs Vitest in a Node environment with no DOM, deliberately (see
 * vitest.config.ts), so logic that stays inside a component is logic that stays
 * untested. The component keeps the state and the effects; the rules live here.
 *
 * WHY THE CONSTANTS ARE RESTATED. `@/lib/loginCode` is the authority on all of
 * them, but it imports node:crypto and Prisma, so a client component cannot
 * import it without dragging the server into the browser bundle. The values are
 * therefore mirrored below and asserted equal to the server's in
 * tests/unit/loginCodeState.test.ts, which runs in Node and CAN import both. If
 * one side is ever changed alone, that test fails rather than the UI quietly
 * counting down to the wrong number.
 *
 * NOTHING HERE EVER RECEIVES OR RETURNS A CODE'S VALIDITY. `sanitiseCodeInput`
 * shapes keystrokes; it does not judge them. Whether six digits are the right
 * six digits is decided by the server and by nothing else.
 */

/** Mirrors CODE_LENGTH in src/lib/loginCode.ts. */
export const CODE_LENGTH = 6;

/** Mirrors RESEND_COOLDOWN_MS in src/lib/loginCode.ts. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** Mirrors GENERIC_LOGIN_CODE_MESSAGE in src/lib/loginCode.ts. */
export const CODE_SENT_MESSAGE =
  "If this account is eligible, a login code has been sent.";

/** Mirrors RATE_LIMITED_MESSAGE in src/lib/rateLimit.ts. */
export const RATE_LIMITED_MESSAGE =
  "Too many attempts. Wait a few minutes and try again.";

export const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

/** Mirrors UNKNOWN_ACCOUNT_LOGIN_CODE_MESSAGE in src/lib/loginCode.ts. */
export const UNKNOWN_ACCOUNT_MESSAGE =
  "No account exists for that email address. Sign up to create one.";

export const REQUEST_FAILED_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

/**
 * The single message for every verification refusal — wrong, expired, already
 * used, out of attempts, account not eligible. The server draws no distinction
 * between them on purpose, and the form must not invent one.
 */
export const INVALID_CODE_MESSAGE = "That code is not valid. Request a new one.";

/**
 * Keeps only what a six-digit code can contain.
 *
 * Runs on every keystroke AND on paste, which is the case that matters: a code
 * copied out of an email arrives as "123 456", "123-456", or with a trailing
 * newline, and a field that rejected those would look broken while the user is
 * holding the correct code. Stripping is the friendly behaviour and the safe
 * one — there is no input this can turn into a longer or different string.
 *
 * Truncating rather than refusing over-length input means a pasted line of
 * surrounding text still yields its first six digits instead of nothing.
 */
export function sanitiseCodeInput(raw: string | null | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** Whether the field holds enough to be worth sending. Not whether it is right. */
export function isCodeComplete(code: string): boolean {
  return sanitiseCodeInput(code).length === CODE_LENGTH;
}

/**
 * Milliseconds left before another code may be requested, never negative.
 *
 * THE CLIENT'S COPY OF A SERVER RULE. The countdown exists so the button does
 * not lie about being available; the server enforces the real cooldown and the
 * real rate limit, and a user who edits this number gets a 429 or a silently
 * suppressed resend, not an extra code. `null` means "nothing requested yet",
 * which is not the same as "cooldown finished" and must not be conflated.
 */
export function remainingCooldownMs(
  lastRequestedAt: number | null,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (lastRequestedAt === null) {
    return 0;
  }
  return Math.max(0, lastRequestedAt + cooldownMs - now);
}

/**
 * The countdown as it is read aloud and shown: whole seconds, rounded up, so it
 * never displays "0s" while the button is still disabled.
 */
export function formatCooldown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${seconds}s`;
}

export type RequestOutcomeKind =
  | "sent"
  | "unknown-account"
  | "invalid-email"
  | "rate-limited"
  | "failed";

export interface RequestOutcome {
  kind: RequestOutcomeKind;
  message: string;
  /** Whether to advance to the code step. Only a 200 has issued anything. */
  advance: boolean;
  /**
   * Whether the form should offer a link to /signup beside the message. True for
   * exactly one status — 404 — where creating an account is the real next step.
   */
  offerSignup: boolean;
}

/**
 * Turns the request endpoint's status into copy — from the status ALONE.
 *
 * The response body is deliberately not consulted. Every message the user sees
 * is a constant in this file, so there is no path by which a server string, a
 * proxy's error page, or an exception's text can reach the screen. The endpoint
 * currently returns only curated messages, but "currently" is not a property
 * worth depending on for enumeration safety.
 *
 * A 200 STILL SAYS NOTHING BEYOND "this address is registered". The endpoint
 * answers identically for a suspended account, an unverified one and an eligible
 * one, so advancing to the code step is not a signal that a code was actually
 * issued.
 *
 * A 404 IS the disclosed branch — the address has no account. That is the one
 * account fact the request endpoint now reveals, by product decision; the
 * reasoning lives on `AccountNotFoundError` in src/lib/auth.ts. It does not
 * advance, because there is no inbox for a code to arrive in.
 */
export function describeRequestOutcome(status: number): RequestOutcome {
  if (status === 200) {
    return {
      kind: "sent",
      message: CODE_SENT_MESSAGE,
      advance: true,
      offerSignup: false,
    };
  }
  if (status === 404) {
    return {
      kind: "unknown-account",
      message: UNKNOWN_ACCOUNT_MESSAGE,
      advance: false,
      offerSignup: true,
    };
  }
  if (status === 429) {
    return {
      kind: "rate-limited",
      message: RATE_LIMITED_MESSAGE,
      advance: false,
      offerSignup: false,
    };
  }
  if (status === 400) {
    return {
      kind: "invalid-email",
      message: INVALID_EMAIL_MESSAGE,
      advance: false,
      offerSignup: false,
    };
  }
  return {
    kind: "failed",
    message: REQUEST_FAILED_MESSAGE,
    advance: false,
    offerSignup: false,
  };
}
