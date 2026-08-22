import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  MembershipStatus,
  TenantStatus,
  UserAccountStatus,
} from "@prisma/client";
import { createAppSession } from "@/lib/appSession";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import {
  RATE_LIMIT_POLICIES,
  createDatabaseRateLimiter,
  type RateLimiter,
} from "@/lib/rateLimit";

/**
 * Six-digit login codes — Stage 4.
 *
 * THE ONE PLACE A CODE IS VERIFIED. The API route, the Auth.js `login-code`
 * provider and the UI all funnel through `verifyLoginCode` below; none of them
 * reimplements any part of it. That is not tidiness, it is the correctness
 * property the stage turns on — two verification paths would each consume a
 * code, and a code consumed twice is a code that authenticated twice.
 *
 * WHAT IS NEVER PERSISTED, LOGGED OR MAILED BACK. The plaintext code exists in
 * memory for the length of one request and is then discarded. It is not in the
 * database (only its HMAC is), not in a URL, not in the audit trail, not in a
 * server log, and not in any response body — including in development, where a
 * convenience echo would inevitably be copied into a staging deployment.
 *
 * WHY HMAC-SHA256 WITH A PEPPER, NOT BCRYPT AND NOT PLAIN SHA-256.
 *
 *   Plain SHA-256 is unusable here. A six-digit code carries about 20 bits of
 *   entropy, so the whole space is a million digests — a database dump would be
 *   reversed by exhaustive search in well under a second. This is exactly why
 *   lib/verification.ts's unsalted SHA-256 is fine for a 256-bit token and is
 *   NOT transferable to this file.
 *
 *   Bcrypt would resist that dump, because the work factor multiplies the
 *   million-guess search into something impractical. Its cost is that every
 *   verification burns ~300ms of CPU on the login path, and the same work must
 *   then be burned on the ineligible branch to avoid a timing oracle — so a
 *   trivial flood of requests for nonexistent accounts becomes a CPU
 *   exhaustion vector against a single Hostinger box.
 *
 *   HMAC-SHA256 keyed with a pepper held OUTSIDE the database defeats the dump
 *   attack at its root: an attacker with the table but not the environment has
 *   nothing to search against, because they cannot compute a candidate digest at
 *   all. The residual risk is a compromise that yields both the database and the
 *   process environment, at which point the million-guess search is cheap again.
 *   That is an accepted, documented tradeoff: at that level of compromise the
 *   attacker can read `users` and mint sessions directly, so the codes are not
 *   the weak link. The short TTL, single use and five-attempt cap bound the
 *   online attack, which is the one an outsider can actually mount.
 */

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Policy constants. Named, gathered, and referenced everywhere — a change here
// is the only edit a policy revision needs.
// ---------------------------------------------------------------------------

export const CODE_LENGTH = 6;

/**
 * Ten minutes. Long enough to survive slow mail delivery and a user switching
 * to their phone; short enough that a code left in an inbox is dead by the time
 * anyone else reads it.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Five wrong guesses kill the code. With a million-value space, five guesses is
 * a 1-in-200,000 chance per code — and the attacker cannot buy more guesses by
 * requesting a fresh code, because the request endpoint is itself limited to
 * three per fifteen minutes per address.
 */
export const MAX_VERIFY_ATTEMPTS = 5;

/** One minute between codes for the same account. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * THE ONLY THING THE REQUEST ENDPOINT EVER SAYS. Identical for an unknown
 * address, a pending account, a rejected one, a suspended one, an unverified
 * one, a platform user and a perfectly eligible user. Exported so the route, the
 * tests and the verification script all assert against one string rather than
 * three copies that could drift apart.
 */
export const GENERIC_LOGIN_CODE_MESSAGE =
  "If this account is eligible, a login code has been sent.";

/**
 * Floor on how long a request takes, whatever branch it took.
 *
 * WHAT THIS DOES AND DOES NOT ACHIEVE, stated plainly. The eligible branch does
 * real work the ineligible branch cannot: it writes rows and calls Resend over
 * the network. Padding both to a common floor removes the *cheap* signal — the
 * one where a nonexistent address returns in 4ms and a real one in 90ms. It does
 * not make the two indistinguishable, because a slow upstream mail call can
 * still exceed the floor. The residual signal is noisy (it varies with Resend's
 * latency, not with the account) and an attacker's ability to sample it is
 * capped at three requests per address per fifteen minutes. Combined, that is
 * the mitigation; "constant time" would be an overclaim.
 */
export const MIN_REQUEST_DURATION_MS = 400;

/**
 * Prefix on the HMAC input, so a future pepper rotation can be staged: v2
 * digests are computed differently and never collide with v1 ones. Bump it only
 * alongside a plan for the codes already outstanding.
 */
const HMAC_CONTEXT_VERSION = "v1";

// ---------------------------------------------------------------------------
// Pure helpers. No Prisma, no clock of their own, no environment — every rule
// a security review cares about is testable here without standing anything up.
// ---------------------------------------------------------------------------

/**
 * A uniformly random six-digit code.
 *
 * `randomInt` draws from the CSPRNG and rejects modulo bias internally.
 * `Math.random()` is a non-cryptographic PRNG whose internal state can be
 * recovered from a handful of outputs — with it, an attacker who requested a few
 * codes for their own account could predict a victim's.
 *
 * The range is [100000, 1000000), so the value is always exactly six digits and
 * never needs zero-padding — a padded code and an unpadded one are different
 * strings and would produce different HMACs.
 */
export function generateLoginCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

/** Exactly six ASCII digits. Rejects spaces, signs and unicode digits. */
export function isLoginCodeFormatValid(code: string): boolean {
  return new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(code);
}

export interface LoginCodeHashInput {
  pepper: string;
  userId: string;
  /** The LoginCode row's id — see `issueLoginCodeRecord` on why it is known first. */
  challengeId: string;
  code: string;
}

/**
 * Keyed digest of one code, bound to one user and one challenge.
 *
 * WHY THE CONTEXT MATTERS. Hashing the bare code would make the digest a
 * property of the six digits alone, so the same digest would appear in every row
 * that happened to draw the same number — roughly one collision per million
 * issued codes, visible by inspection. An attacker with read access to the table
 * could then watch for a digest matching one they had been mailed themselves and
 * replay it against another account. Binding userId and the row id makes each
 * digest usable in exactly one place.
 *
 * Returns 64 hex characters, inside the VARCHAR(255) column.
 */
export function hashLoginCode(input: LoginCodeHashInput): string {
  const context = `${HMAC_CONTEXT_VERSION}:${input.userId}:${input.challengeId}:${input.code}`;
  return createHmac("sha256", input.pepper).update(context).digest("hex");
}

/**
 * Constant-time digest comparison.
 *
 * `===` on strings short-circuits at the first differing character, so the
 * comparison's duration reveals how many leading characters matched. That is a
 * genuine oracle against a digest an attacker can influence. `timingSafeEqual`
 * requires equal-length buffers and throws otherwise, so the length check comes
 * first — length is not secret here (every digest is 64 hex characters), so
 * returning early on a mismatched length leaks nothing.
 */
export function loginCodeHashMatches(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
}

export function computeLoginCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + CODE_TTL_MS);
}

/** True while a fresh code may not yet be issued for this account. */
export function isWithinResendCooldown(
  lastIssuedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastIssuedAt) {
    return false;
  }
  return now.getTime() - lastIssuedAt.getTime() < RESEND_COOLDOWN_MS;
}

/** Which gate refused. SERVER-SIDE ONLY — never reaches a response body. */
export type LoginCodeIneligibility =
  | "unknown-account"
  | "email-unverified"
  | "account-inactive"
  | "membership-inactive"
  | "tenant-inactive"
  | "platform-tenant"
  | null;

export interface LoginCodeEligibilityInput {
  accountStatus: UserAccountStatus;
  membershipStatus: MembershipStatus;
  tenantStatus: TenantStatus;
  emailVerifiedAt: Date | null;
  isPlatformTenant: boolean;
}

/**
 * All five conditions, in one predicate used by BOTH the request and the verify
 * path. Verify re-runs it against freshly-read rows rather than trusting that
 * the account was eligible when the code was issued: ten minutes is long enough
 * for an Owner to suspend an account, and a code minted before that suspension
 * must not still open a session after it.
 *
 * The reserved platform tenant is refused outright. Stage 4 is login for
 * ordinary tenant users; the Owner account is deliberately NOT reachable on a
 * bare six-digit code, and giving it one here would quietly set the platform's
 * strongest login to its weakest factor. The Owner keeps password login until a
 * later stage adds a stronger factor.
 */
export function evaluateLoginCodeEligibility(
  input: LoginCodeEligibilityInput,
): { eligible: boolean; reason: LoginCodeIneligibility } {
  if (input.isPlatformTenant) {
    return { eligible: false, reason: "platform-tenant" };
  }
  if (!input.emailVerifiedAt) {
    return { eligible: false, reason: "email-unverified" };
  }
  if (input.tenantStatus !== "ACTIVE") {
    return { eligible: false, reason: "tenant-inactive" };
  }
  if (input.accountStatus !== "ACTIVE") {
    return { eligible: false, reason: "account-inactive" };
  }
  if (input.membershipStatus !== "ACTIVE") {
    return { eligible: false, reason: "membership-inactive" };
  }
  return { eligible: true, reason: null };
}

export type LoginCodeState = "usable" | "consumed" | "expired" | "exhausted";

export interface LoginCodeStateInput {
  consumedAt: Date | null;
  expiresAt: Date;
  attemptCount: number;
  now: Date;
}

/**
 * Whether a stored code may still be attempted.
 *
 * Order is narrowest-cause-first, matching evaluateSession(): a consumed code
 * that has also expired reports "consumed", because that is the fact an
 * administrator reading a log needs.
 *
 * The verify path re-expresses these same three conditions as SQL predicates on
 * a conditional UPDATE, so that concurrent submissions cannot interleave past
 * them. This function is the readable statement of the rule and the thing unit
 * tests pin down; the SQL guard is what enforces it under concurrency.
 */
export function evaluateLoginCodeState(input: LoginCodeStateInput): LoginCodeState {
  if (input.consumedAt !== null) {
    return "consumed";
  }
  if (input.attemptCount >= MAX_VERIFY_ATTEMPTS) {
    return "exhausted";
  }
  // Expiry is exclusive, matching sessionPolicy: a code expiring exactly now is
  // over.
  if (input.expiresAt.getTime() <= input.now.getTime()) {
    return "expired";
  }
  return "usable";
}

/**
 * Development-only pepper. Present so `npm test` and the local verification
 * script can run without every developer minting a secret first.
 *
 * IT IS NOT A FALLBACK IN ANY DEPLOYED ENVIRONMENT. `resolveLoginCodePepper`
 * admits it only when NODE_ENV is explicitly "development" or "test" — an
 * ALLOWLIST, deliberately, not a `!== "production"` check. The denylist form
 * fails open exactly where it matters most: a container that starts with
 * NODE_ENV unset or misspelled would silently accept this constant, and every
 * login code on that deployment would be forgeable by anyone reading this file.
 */
const DEVELOPMENT_ONLY_PEPPER = "medcare-pro-development-only-login-code-pepper";

const PEPPER_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Reads LOGIN_CODE_PEPPER, or fails closed.
 *
 * Takes the environment as a parameter so the fail-closed rule itself is
 * testable without mutating process.env across a test suite.
 *
 * The parameter is a loose string record rather than NodeJS.ProcessEnv on
 * purpose. Next's type augmentation narrows NODE_ENV to three literals, which
 * would make the cases this function exists to handle — unset, misspelled,
 * "staging" — unrepresentable in a test. Those cases are real at runtime
 * whatever the type says, and the allowlist below is what catches them.
 */
export function resolveLoginCodePepper(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.LOGIN_CODE_PEPPER?.trim();
  if (configured) {
    return configured;
  }

  const nodeEnv = env.NODE_ENV?.trim() ?? "";
  if (PEPPER_ENVIRONMENTS.has(nodeEnv)) {
    return DEVELOPMENT_ONLY_PEPPER;
  }

  // Never name the variable's value, never guess a default. A login method that
  // cannot be secured must not run at all.
  throw new Error(
    "LOGIN_CODE_PEPPER is not set. Login codes cannot be issued or verified without it.",
  );
}

// ---------------------------------------------------------------------------
// Input schemas.
// ---------------------------------------------------------------------------

export const requestLoginCodeSchema = z.object({
  email: z.email().max(255),
});

/**
 * `rememberMe` arrives as a STRING, not a boolean.
 *
 * Auth.js serialises credentials into an application/x-www-form-urlencoded body
 * on both the client (`signIn` from next-auth/react) and the server (the
 * `signIn` action in next-auth/lib/actions.js), so `true` reaches `authorize()`
 * as `"true"`. Accepting both shapes here keeps one schema for the route and the
 * provider; anything else is false, so a malformed value degrades to the SHORTER
 * session rather than the longer one.
 */
const rememberMeSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === "true");

export const verifyLoginCodeSchema = z.object({
  email: z.email().max(255),
  code: z.string().trim().length(CODE_LENGTH),
  rememberMe: rememberMeSchema,
});

export type VerifyLoginCodeInput = z.infer<typeof verifyLoginCodeSchema>;

// ---------------------------------------------------------------------------
// Database-backed flows.
// ---------------------------------------------------------------------------

/** What the mailer must do. Injected so no test or script sends real mail. */
export type LoginCodeMailer = (params: {
  to: string;
  code: string;
  expiresInMinutes: number;
}) => Promise<void>;

export interface LoginCodeDeps {
  prisma: PrismaClient;
  sendEmail: LoginCodeMailer;
  /** Injected so expiry and cooldown are exercisable without waiting. */
  now?: Date;
  /** Injected so a Redis limiter can replace the MySQL one. */
  rateLimiter?: RateLimiter;
  pepper?: string;
  /** Set false in tests and scripts that must not sleep. */
  padTiming?: boolean;
}

export interface RequestLoginCodeInput {
  email: string;
  ip: string | null;
  userAgent: string | null;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function padToMinimumDuration(startedAt: number, enabled: boolean): Promise<void> {
  if (!enabled) {
    return;
  }
  const elapsed = Date.now() - startedAt;
  if (elapsed >= MIN_REQUEST_DURATION_MS) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_DURATION_MS - elapsed));
}

/**
 * Burns roughly the work the eligible branch spends on hashing, so the two
 * branches do not differ by a measurable HMAC. Cheap, but free to do, and it
 * keeps the ineligible path from being the obviously shorter one.
 */
function burnEquivalentHashWork(pepper: string): void {
  hashLoginCode({
    pepper,
    userId: "timing-defence",
    challengeId: randomUUID(),
    code: generateLoginCode(),
  });
}

const USER_FOR_LOGIN_CODE_SELECT = {
  id: true,
  email: true,
  name: true,
  tenantId: true,
  emailVerifiedAt: true,
  accountStatus: true,
  membershipStatus: true,
  tenant: { select: { status: true, isPlatform: true } },
} as const;

/**
 * Issues a code and mails it — or does nothing at all, and says exactly the same
 * thing either way.
 *
 * ALWAYS RESOLVES WITH THE GENERIC MESSAGE, including when delivery fails.
 * Reporting a mail error to the caller would be an enumeration channel in
 * itself: only a real, eligible account ever reaches the point where delivery
 * can fail, so "could not send" means "this address exists". The failure is
 * logged server-side instead. The one thing that does propagate is
 * RateLimitError, which is a deliberate 429 and says nothing about the account.
 */
export async function requestLoginCode(
  deps: LoginCodeDeps,
  input: RequestLoginCodeInput,
): Promise<{ message: string }> {
  const startedAt = Date.now();
  const now = deps.now ?? new Date();
  const pepper = deps.pepper ?? resolveLoginCodePepper();
  const limiter = deps.rateLimiter ?? createDatabaseRateLimiter(deps.prisma);
  const padTiming = deps.padTiming ?? true;
  const email = normaliseEmail(input.email);

  // Throttle before touching the user table, so an enumeration sweep is capped
  // regardless of which addresses it guesses. IP first: it is the dimension that
  // catches a single attacker walking a list of addresses, none of which would
  // individually trip the per-email limit.
  try {
    await limiter.assertAllowed({ policy: RATE_LIMIT_POLICIES.requestByIp, subject: input.ip ?? "unknown", now });
    await limiter.assertAllowed({ policy: RATE_LIMIT_POLICIES.requestByEmail, subject: email, now });
  } catch (error: unknown) {
    await writeAuditLog(deps.prisma, {
      action: AUDIT_ACTIONS.LOGIN_CODE_RATE_LIMITED,
      targetType: "User",
      // No targetId and no address: the row records that throttling happened,
      // not who was throttled. The digested rate-limit key is the join key for
      // an operator who needs to correlate.
      targetId: null,
      afterValue: { method: "login-code", outcome: "rate-limited", phase: "request" },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw error;
  }

  const user = await deps.prisma.user.findUnique({
    where: { email },
    select: USER_FOR_LOGIN_CODE_SELECT,
  });

  const eligibility = user
    ? evaluateLoginCodeEligibility({
        accountStatus: user.accountStatus,
        membershipStatus: user.membershipStatus,
        tenantStatus: user.tenant.status,
        emailVerifiedAt: user.emailVerifiedAt,
        isPlatformTenant: user.tenant.isPlatform,
      })
    : { eligible: false, reason: "unknown-account" as const };

  if (!user || !eligibility.eligible) {
    burnEquivalentHashWork(pepper);
    // Deliberately NOT audited. An audit row per guessed address would turn the
    // trail into the enumeration list the response refuses to be, and would let
    // an attacker fill a table nobody may delete from.
    await padToMinimumDuration(startedAt, padTiming);
    return { message: GENERIC_LOGIN_CODE_MESSAGE };
  }

  const code = generateLoginCode();
  const challengeId = randomUUID();

  const issued = await deps.prisma.$transaction(async (tx) => {
    // Cooldown is read INSIDE the transaction so two concurrent requests for the
    // same account serialise on the same rows rather than both seeing "no recent
    // code" and both issuing one.
    const newest = await tx.loginCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (isWithinResendCooldown(newest?.createdAt ?? null, now)) {
      return null;
    }

    // "A newer code invalidates the older one" — enforced by consuming every
    // outstanding code before the new row exists, so there is never a moment
    // when two are live. `consumedAt` is the invalidation marker; the schema
    // permits either that or expiry, and reusing consumedAt means the verify
    // path needs exactly one predicate rather than two.
    await tx.loginCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });

    // The id is generated here rather than by the database default, because the
    // HMAC is bound to it and must be computed before the row is written. The
    // alternative — insert, then update with the real hash — would leave a row
    // that briefly cannot verify, and would fail permanently if the second
    // statement did not land.
    await tx.loginCode.create({
      data: {
        id: challengeId,
        userId: user.id,
        codeHash: hashLoginCode({ pepper, userId: user.id, challengeId, code }),
        expiresAt: computeLoginCodeExpiry(now),
        requestIp: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: now,
      },
      select: { id: true },
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.LOGIN_CODE_REQUESTED,
      targetType: "LoginCode",
      // The row id lives in a column, not in metadata: assertSafeAuditMetadata
      // rejects any metadata KEY containing "code", which is the guard doing its
      // job rather than an obstacle to work around.
      targetId: challengeId,
      actorUserId: user.id,
      actorTenantId: user.tenantId,
      afterValue: { method: "login-code", outcome: "issued" },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { id: challengeId };
  });

  // Still in cooldown: no new code exists, so there is nothing to mail. The
  // caller is told the same thing as a successful issue.
  if (!issued) {
    await padToMinimumDuration(startedAt, padTiming);
    return { message: GENERIC_LOGIN_CODE_MESSAGE };
  }

  try {
    await deps.sendEmail({
      to: user.email,
      code,
      expiresInMinutes: Math.round(CODE_TTL_MS / 60_000),
    });
  } catch (error: unknown) {
    // The address is deliberately absent from this line. Server logs are
    // access-controlled but they are still copied into support tickets, and the
    // pairing of an address with "login code" is the disclosure being avoided.
    console.error(
      "Login code delivery failed",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  await padToMinimumDuration(startedAt, padTiming);
  return { message: GENERIC_LOGIN_CODE_MESSAGE };
}

/** What a successful verification hands back to the Auth.js provider. */
export interface VerifiedLoginCodeUser {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  sid: string;
}

export interface VerifyLoginCodeRequestInput extends VerifyLoginCodeInput {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Verifies a code and, on success, creates the session.
 *
 * Returns null for EVERY failure — unknown address, ineligible account, no
 * outstanding code, wrong code, expired code, consumed code, exhausted
 * attempts. Auth.js collapses a null into its generic CredentialsSignin error,
 * which is what the login screen renders. No branch is distinguishable to the
 * caller; the reason exists only in the audit trail.
 *
 * CONCURRENCY — the property that makes single-use real. Both state changes are
 * conditional updates whose predicates the database evaluates inside the write:
 *
 *   attempt bump  WHERE id = ? AND consumed_at IS NULL
 *                   AND attempt_count < 5 AND expires_at > now
 *   consume       WHERE id = ? AND consumed_at IS NULL
 *
 * Two correct submissions arriving together therefore both bump, but exactly one
 * matches a row on the consume — the other sees `count === 0` and is refused. A
 * read-then-write would let both through and mint two sessions from one code.
 */
export async function verifyLoginCode(
  deps: LoginCodeDeps,
  input: VerifyLoginCodeRequestInput,
): Promise<VerifiedLoginCodeUser | null> {
  const now = deps.now ?? new Date();
  const pepper = deps.pepper ?? resolveLoginCodePepper();
  const limiter = deps.rateLimiter ?? createDatabaseRateLimiter(deps.prisma);
  const email = normaliseEmail(input.email);

  await limiter.assertAllowed({ policy: RATE_LIMIT_POLICIES.verifyByIp, subject: input.ip ?? "unknown", now });
  await limiter.assertAllowed({ policy: RATE_LIMIT_POLICIES.verifyByEmail, subject: email, now });

  if (!isLoginCodeFormatValid(input.code)) {
    return null;
  }

  const user = await deps.prisma.user.findUnique({
    where: { email },
    select: USER_FOR_LOGIN_CODE_SELECT,
  });

  if (!user) {
    burnEquivalentHashWork(pepper);
    return null;
  }

  // Re-checked against rows read NOW, not against the state that was true when
  // the code was issued. A code minted while the account was active must not
  // open a session after an Owner has suspended it.
  const eligibility = evaluateLoginCodeEligibility({
    accountStatus: user.accountStatus,
    membershipStatus: user.membershipStatus,
    tenantStatus: user.tenant.status,
    emailVerifiedAt: user.emailVerifiedAt,
    isPlatformTenant: user.tenant.isPlatform,
  });

  if (!eligibility.eligible) {
    burnEquivalentHashWork(pepper);
    await recordFailure(deps.prisma, user, null, "ineligible", input);
    return null;
  }

  const candidate = await deps.prisma.loginCode.findFirst({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attemptCount: true, consumedAt: true },
  });

  if (!candidate) {
    burnEquivalentHashWork(pepper);
    await recordFailure(deps.prisma, user, null, "no-code", input);
    return null;
  }

  const state = evaluateLoginCodeState({
    consumedAt: candidate.consumedAt,
    expiresAt: candidate.expiresAt,
    attemptCount: candidate.attemptCount,
    now,
  });

  if (state !== "usable") {
    burnEquivalentHashWork(pepper);
    await recordFailure(deps.prisma, user, candidate.id, state, input);
    return null;
  }

  // Charge the attempt BEFORE comparing. If the comparison or anything after it
  // throws, the attempt is still spent — otherwise a client that aborts
  // mid-request gets unlimited free guesses.
  const bumped = await deps.prisma.loginCode.updateMany({
    where: {
      id: candidate.id,
      consumedAt: null,
      attemptCount: { lt: MAX_VERIFY_ATTEMPTS },
      expiresAt: { gt: now },
    },
    data: { attemptCount: { increment: 1 } },
  });

  if (bumped.count === 0) {
    // Lost a race: consumed, exhausted or expired between the read and here.
    await recordFailure(deps.prisma, user, candidate.id, "exhausted", input);
    return null;
  }

  const expected = hashLoginCode({
    pepper,
    userId: user.id,
    challengeId: candidate.id,
    code: input.code,
  });

  if (!loginCodeHashMatches(candidate.codeHash, expected)) {
    await recordFailure(deps.prisma, user, candidate.id, "wrong-code", input);
    return null;
  }

  const sid = await deps.prisma.$transaction(async (tx) => {
    const consumed = await tx.loginCode.updateMany({
      where: { id: candidate.id, consumedAt: null },
      data: { consumedAt: now },
    });

    // A concurrent submission of the same correct code got there first. Exactly
    // one of the two may produce a session.
    if (consumed.count === 0) {
      return null;
    }

    const sessionId = await createAppSession(tx, {
      userId: user.id,
      tenantId: user.tenantId,
      rememberMe: input.rememberMe,
      ip: input.ip,
      userAgent: input.userAgent,
      now,
    });

    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.LOGIN_CODE_SUCCEEDED,
      targetType: "LoginCode",
      targetId: candidate.id,
      actorUserId: user.id,
      actorTenantId: user.tenantId,
      afterValue: {
        method: "login-code",
        outcome: "success",
        rememberMe: input.rememberMe,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return sessionId;
  });

  if (!sid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tenantId: user.tenantId,
    sid,
  };
}

/**
 * One failure row, with a machine-readable outcome and nothing else.
 *
 * `outcome` is safe to record because the trail is server-side and per-user: it
 * is never returned to the caller, so it cannot become the enumeration channel
 * the response refuses to be. The code and its digest are absent by
 * construction — `assertSafeAuditMetadata` would throw on a key naming either.
 */
async function recordFailure(
  client: PrismaClientOrTransaction,
  user: { id: string; tenantId: string },
  loginCodeId: string | null,
  outcome: string,
  input: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await writeAuditLog(client, {
    action: AUDIT_ACTIONS.LOGIN_CODE_FAILED,
    targetType: loginCodeId ? "LoginCode" : "User",
    targetId: loginCodeId ?? user.id,
    actorUserId: user.id,
    actorTenantId: user.tenantId,
    afterValue: { method: "login-code", outcome },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
