import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Durable rate limiting on top of `rate_limit_buckets` — Stage 4.
 *
 * Database-backed rather than in-process, so a restart cannot reset an
 * attacker's counter and two app instances share one view of it. The schema
 * note on RateLimitBucket records the known ceiling: a single MySQL table
 * serialises writes on the hottest keys. That is why everything below the
 * `RateLimiter` interface is replaceable — a Redis implementation satisfies the
 * same three methods and no call site changes.
 *
 * WHY THE KEYS ARE DIGESTS, NOT ADDRESSES. Two independent reasons:
 *
 *   1. Privacy. `rate_limit_buckets` is operational data read by support staff.
 *      A table of raw email addresses of everyone who tried to log in is a
 *      standing disclosure that buys nothing — the limiter only ever needs to
 *      know whether two requests come from the same subject, never who.
 *   2. Correctness. `key` is a bare Prisma `String`, which MySQL maps to
 *      VARCHAR(191). An email may be 255 characters; prefixed, it would exceed
 *      the column and throw on insert. A fixed-width digest cannot.
 */

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Thrown when a subject has exhausted its allowance. Mapped to HTTP 429 by
 * lib/apiHandler.ts.
 *
 * `retryAfterMs` is for the SERVER's own logs and for authenticated callers. It
 * must never be echoed to an unauthenticated caller on the login-code request
 * endpoint: a precise retry window varies with how far through its allowance a
 * *particular address* is, which is the account-existence signal that endpoint
 * exists to hide.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RateLimitPolicy {
  /** Namespace fragment, e.g. "login-code:request:email". */
  readonly name: string;
  readonly windowMs: number;
  /** Requests permitted within one window. The (max + 1)th is refused. */
  readonly maxCount: number;
  /** How long a subject stays refused once it trips the limit. */
  readonly blockMs: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Initial Stage 4 policy. Deliberately gathered in one object rather than
 * scattered as constants: these are starting values to be tuned against real
 * traffic, and tuning them must never mean hunting through business logic.
 *
 * The email limits are the tight ones because an attacker enumerating accounts,
 * or flooding one victim's inbox, works per address. The IP limits are looser so
 * that a clinic's whole front desk behind one NAT address is not locked out by
 * ordinary use.
 */
export const RATE_LIMIT_POLICIES = {
  requestByEmail: {
    name: "login-code:request:email",
    windowMs: FIFTEEN_MINUTES_MS,
    maxCount: 3,
    blockMs: FIFTEEN_MINUTES_MS,
  },
  requestByIp: {
    name: "login-code:request:ip",
    windowMs: FIFTEEN_MINUTES_MS,
    maxCount: 20,
    blockMs: FIFTEEN_MINUTES_MS,
  },
  verifyByEmail: {
    name: "login-code:verify:email",
    windowMs: FIFTEEN_MINUTES_MS,
    maxCount: 10,
    blockMs: FIFTEEN_MINUTES_MS,
  },
  verifyByIp: {
    name: "login-code:verify:ip",
    windowMs: FIFTEEN_MINUTES_MS,
    maxCount: 50,
    blockMs: FIFTEEN_MINUTES_MS,
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/** Digest width in hex characters. 128 bits — far past collision concern here. */
const SUBJECT_DIGEST_LENGTH = 32;

/**
 * One-way, fixed-width identifier for a rate-limit subject.
 *
 * NOT a security boundary, and not claimed to be one: the input space of email
 * and IPv4 addresses is small enough to brute-force offline, so this is
 * unlinkability at rest, not secrecy. It stops a casual reader of the table from
 * harvesting addresses; it does not stop a determined one from confirming a
 * guess. Making it stronger would mean keying it, and a keyed digest that has to
 * survive restarts is a second secret to manage for a table of counters.
 */
export function hashRateLimitSubject(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, SUBJECT_DIGEST_LENGTH);
}

/**
 * Builds the stored key. The policy name carries the dimension, so one table
 * serves every limiter and a key is self-describing when read by hand.
 */
export function buildRateLimitKey(policy: RateLimitPolicy, subject: string): string {
  return `${policy.name}:${hashRateLimitSubject(subject)}`;
}

/** The subset of a bucket row the decision needs. Kept pure for unit testing. */
export interface RateLimitBucketSnapshot {
  windowStartedAt: Date;
  count: number;
  blockedUntil: Date | null;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Zero when allowed. */
  retryAfterMs: number;
  /** Which gate refused, for server logs only. */
  reason: "blocked" | "limit-reached" | null;
}

const ALLOWED: RateLimitVerdict = { allowed: true, retryAfterMs: 0, reason: null };

/**
 * Decides an outcome from a bucket snapshot, without touching a database.
 *
 * Split out so the window/limit/block rules — the part a policy change actually
 * alters — are testable with no database and no clock. The impure limiter below
 * re-expresses the same rules as conditional SQL predicates so that concurrent
 * requests cannot interleave past them; this is the readable statement of intent
 * that the SQL has to match.
 */
export function evaluateBucket(input: {
  bucket: RateLimitBucketSnapshot | null;
  policy: RateLimitPolicy;
  now: Date;
}): RateLimitVerdict {
  const { bucket, policy, now } = input;

  if (!bucket) {
    return ALLOWED;
  }

  if (bucket.blockedUntil && bucket.blockedUntil.getTime() > now.getTime()) {
    return {
      allowed: false,
      retryAfterMs: bucket.blockedUntil.getTime() - now.getTime(),
      reason: "blocked",
    };
  }

  // The window has rolled over: the stored count belongs to a window that is
  // over, so it says nothing about this one.
  const windowEndsAt = bucket.windowStartedAt.getTime() + policy.windowMs;
  if (windowEndsAt <= now.getTime()) {
    return ALLOWED;
  }

  if (bucket.count >= policy.maxCount) {
    return {
      allowed: false,
      retryAfterMs: windowEndsAt - now.getTime(),
      reason: "limit-reached",
    };
  }

  return ALLOWED;
}

/**
 * The replaceable surface. A Redis-backed limiter implements these three and
 * nothing in lib/loginCode.ts changes.
 */
export interface RateLimiter {
  checkAndIncrement(input: {
    policy: RateLimitPolicy;
    subject: string;
    now?: Date;
  }): Promise<RateLimitVerdict>;

  assertAllowed(input: {
    policy: RateLimitPolicy;
    subject: string;
    now?: Date;
  }): Promise<void>;

  /** Clears a subject's bucket. For tests, and for support unblocking a user. */
  reset(input: { policy: RateLimitPolicy; subject: string }): Promise<void>;
}

/** Message for a refused caller. Says nothing about which subject tripped. */
export const RATE_LIMITED_MESSAGE =
  "Too many attempts. Wait a few minutes and try again.";

/**
 * True when Prisma refused a create because the row already existed. The unique
 * index on `key` is what makes the create-first strategy below safe.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * The MySQL-backed limiter.
 *
 * CONCURRENCY. Every state change is a single conditional statement, so two
 * simultaneous requests cannot read the same count and both conclude they are
 * under the cap:
 *
 *   1. create               — succeeds for exactly one racer; the unique index
 *                             on `key` refuses the rest, who fall through.
 *   2. reset a stale window — `updateMany` guarded on `windowStartedAt < cutoff`,
 *                             so only the first racer past the boundary resets.
 *   3. increment            — `updateMany` guarded on `count < maxCount`. This is
 *                             the important one: the guard is evaluated by the
 *                             database inside the write, so the (max + 1)th
 *                             concurrent request matches zero rows and is
 *                             refused. A read-then-write here would let N racers
 *                             all observe `count = max - 1` and all pass.
 *
 * The only non-atomic read is the blocked-until fast path for an already-refused
 * subject. It cannot admit anyone the guards above would refuse — it only
 * refuses them earlier.
 */
export function createDatabaseRateLimiter(
  client: PrismaClientOrTransaction,
): RateLimiter {
  async function checkAndIncrement(input: {
    policy: RateLimitPolicy;
    subject: string;
    now?: Date;
  }): Promise<RateLimitVerdict> {
    const { policy } = input;
    const now = input.now ?? new Date();
    const key = buildRateLimitKey(policy, input.subject);
    const windowCutoff = new Date(now.getTime() - policy.windowMs);

    const existing = await client.rateLimitBucket.findUnique({
      where: { key },
      select: { windowStartedAt: true, count: true, blockedUntil: true },
    });

    if (!existing) {
      try {
        await client.rateLimitBucket.create({
          data: { key, windowStartedAt: now, count: 1 },
        });
        return ALLOWED;
      } catch (error: unknown) {
        // Another racer created it first. Fall through and treat this as an
        // increment against the row they just wrote.
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    } else {
      const verdict = evaluateBucket({ bucket: existing, policy, now });
      if (!verdict.allowed && verdict.reason === "blocked") {
        return verdict;
      }
    }

    // Stale window: start a fresh one. Guarded, so concurrent racers past the
    // boundary do not each reset the count to 1 in turn.
    const reset = await client.rateLimitBucket.updateMany({
      where: { key, windowStartedAt: { lt: windowCutoff } },
      data: { windowStartedAt: now, count: 1, blockedUntil: null },
    });
    if (reset.count > 0) {
      return ALLOWED;
    }

    // Live window. The `count < maxCount` guard is the atomic admission test.
    const incremented = await client.rateLimitBucket.updateMany({
      where: { key, count: { lt: policy.maxCount } },
      data: { count: { increment: 1 } },
    });
    if (incremented.count > 0) {
      return ALLOWED;
    }

    // Over the cap. Start, or extend, the block window.
    const blockedUntil = new Date(now.getTime() + policy.blockMs);
    await client.rateLimitBucket.updateMany({
      where: {
        key,
        OR: [{ blockedUntil: null }, { blockedUntil: { lt: blockedUntil } }],
      },
      data: { blockedUntil },
    });

    return { allowed: false, retryAfterMs: policy.blockMs, reason: "limit-reached" };
  }

  return {
    checkAndIncrement,

    async assertAllowed(input) {
      const verdict = await checkAndIncrement(input);
      if (!verdict.allowed) {
        throw new RateLimitError(RATE_LIMITED_MESSAGE, verdict.retryAfterMs);
      }
    },

    async reset(input) {
      await client.rateLimitBucket.deleteMany({
        where: { key: buildRateLimitKey(input.policy, input.subject) },
      });
    },
  };
}
