/**
 * Session-registry policy — Stage 2, decision 2 (Option A).
 *
 * The Credentials provider forces JWT sessions; Auth.js cannot issue database
 * sessions for it. So the JWT stays, but it carries only ONE thing we trust:
 * a `sid` pointing at an `app_sessions` row. Authorization is decided from that
 * row and from the user/tenant status columns, never from claims in the token.
 *
 * This module is deliberately pure — no Prisma, no Auth.js, no clock of its
 * own. `now` is passed in so expiry is testable without waiting, and so two
 * checks inside one request cannot disagree about the time.
 *
 * A missing sid is UNAUTHENTICATED, never "skip the check". That is the whole
 * point of the registry: a token minted before the registry existed, or forged
 * without one, must not be honoured.
 */

/** Which gate refused. For server logs and Owner diagnostics — never the client. */
export type SessionDenialReason =
  | "no-sid"
  | "unknown-sid"
  | "user-mismatch"
  | "revoked"
  | "expired"
  | null;

/** The subset of an `app_sessions` row the decision needs. */
export interface SessionRecordSnapshot {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface SessionEvaluationInput {
  /** The `sid` claim off the JWT, if it carried one. */
  sid: string | null | undefined;
  /** The `id` claim off the same JWT. */
  claimedUserId: string | null | undefined;
  /** The row `sid` resolved to, or null when there is no such row. */
  record: SessionRecordSnapshot | null;
  now: Date;
}

export interface SessionEvaluation {
  valid: boolean;
  reason: SessionDenialReason;
}

/**
 * Decides whether a presented session is live.
 *
 * Ordered narrowest-cause-first so the reason names the real problem: a revoked
 * session that has also aged past its expiry reports "revoked", because that is
 * what an administrator needs to see.
 *
 * `user-mismatch` catches a token whose `sid` and `id` disagree — the shape a
 * stolen-and-edited token takes. Trusting `sid` alone would let an attacker
 * keep their own live session id while swapping the user id they claim to be.
 */
export function evaluateSession(input: SessionEvaluationInput): SessionEvaluation {
  const { sid, claimedUserId, record, now } = input;

  if (!sid || !claimedUserId) {
    return { valid: false, reason: "no-sid" };
  }

  if (!record || record.id !== sid) {
    return { valid: false, reason: "unknown-sid" };
  }

  if (record.userId !== claimedUserId) {
    return { valid: false, reason: "user-mismatch" };
  }

  if (record.revokedAt !== null) {
    return { valid: false, reason: "revoked" };
  }

  // Expiry is exclusive: a session expiring exactly now is over.
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, reason: null };
}

export function isSessionLive(input: SessionEvaluationInput): boolean {
  return evaluateSession(input).valid;
}

/**
 * How long a new session lives. Both are absolute lifetimes, not idle
 * timeouts: `lastSeenAt` is recorded for the "your devices" list, but it never
 * extends `expiresAt`. A sliding window would mean a stolen token stays valid
 * forever as long as it keeps being used.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `rememberMe` lengthens THIS session only. It never means "remember the
 * six-digit code" — Stage 4 codes stay single-use and short-lived regardless.
 */
export function computeSessionExpiry(now: Date, rememberMe: boolean): Date {
  return new Date(now.getTime() + (rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS));
}

/**
 * Trims an untrusted header to something a fixed-width column will accept.
 * Returns null rather than an empty string so "not sent" and "sent blank" both
 * land as SQL NULL.
 */
export function truncateForColumn(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** IPv6 in full form is 45 characters — the width of `app_sessions.ip`. */
export const IP_COLUMN_MAX = 45;
/** `user_agent` is TEXT, but an unbounded header is still not worth storing. */
export const USER_AGENT_MAX = 512;
