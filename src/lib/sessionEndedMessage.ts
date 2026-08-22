/**
 * What the login screen says when a session ended somewhere else — Stage 5.
 *
 * Pure by design: no Prisma, no Auth.js, no browser globals, no clock. It takes
 * a read-only lookup (`URLSearchParams`, Next's `ReadonlyURLSearchParams`, or a
 * plain object in a test) and returns copy, so the whole mapping is testable
 * without rendering anything.
 *
 * EVERY QUERY PARAMETER HERE IS FORGEABLE. `?ended=1&reason=…` is typed by
 * whoever is holding the URL bar, so nothing in this file may be treated as a
 * fact about an account. Two consequences, both deliberate:
 *
 *   1. The `reason` is never echoed back into the page. Only values on the
 *      allowlist below produce copy at all; anything else — an unknown reason,
 *      a script tag, a novel — silently falls through to the default sentence.
 *      A page that rendered `reason` would be a reflected-content hole and a
 *      way to put arbitrary words in the product's mouth.
 *
 *   2. The copy is generic even when the reason is specific. "account-suspended"
 *      and "tenant-suspended" are set by the dashboard shell for its own
 *      diagnostics, but a suspended account is not something to confirm to an
 *      unauthenticated visitor who can simply type the parameter. Both map to
 *      the neutral sentence; the real state stays where it is enforced.
 *
 * `ended=1` is load-bearing beyond this file: middleware.ts lets a request with
 * a still-decodable JWT reach /login only when that flag is present, which is
 * what stops the refuse/redirect loop. A reason without `ended=1` therefore
 * never reaches this page at all, so it produces no message here either.
 */

/** The reasons the dashboard shell actually sets. Anything else is ignored. */
export const SESSION_ENDED_REASONS = [
  "session-revoked",
  "expired",
  "account-suspended",
  "tenant-suspended",
] as const;

export type SessionEndedReason = (typeof SESSION_ENDED_REASONS)[number];

/** Structurally satisfied by URLSearchParams and ReadonlyURLSearchParams. */
export interface ReadableSearchParams {
  get(name: string): string | null;
}

export const SESSION_ENDED_DEFAULT_MESSAGE =
  "Your session has ended. Sign in again to continue.";

export const SESSION_EXPIRED_MESSAGE =
  "Your session expired. Sign in again to continue.";

export const SESSION_SIGN_IN_AGAIN_MESSAGE = "Please sign in again to continue.";

/**
 * `expired` earns its own sentence because it is the one cause the user can act
 * on differently — it means "nothing is wrong, you were away too long", where
 * the default reads as "something happened". The rest share the neutral line.
 */
const MESSAGES: Record<SessionEndedReason, string> = {
  "session-revoked": SESSION_SIGN_IN_AGAIN_MESSAGE,
  expired: SESSION_EXPIRED_MESSAGE,
  "account-suspended": SESSION_SIGN_IN_AGAIN_MESSAGE,
  "tenant-suspended": SESSION_SIGN_IN_AGAIN_MESSAGE,
};

function isKnownReason(value: string | null): value is SessionEndedReason {
  return value !== null && (SESSION_ENDED_REASONS as readonly string[]).includes(value);
}

/**
 * The sentence to show, or null when the visitor simply navigated to /login.
 *
 * Only the exact string "1" opts in, so `?ended=0`, `?ended=true` and `?ended=`
 * all mean "no". Matching middleware.ts's own test exactly keeps the two from
 * disagreeing about whether a session ended.
 */
export function getSessionEndedMessage(
  searchParams: ReadableSearchParams | null | undefined,
): string | null {
  if (!searchParams || searchParams.get("ended") !== "1") {
    return null;
  }

  const reason = searchParams.get("reason");
  return isKnownReason(reason) ? MESSAGES[reason] : SESSION_ENDED_DEFAULT_MESSAGE;
}
