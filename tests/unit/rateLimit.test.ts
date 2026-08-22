import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_POLICIES,
  RateLimitError,
  buildRateLimitKey,
  evaluateBucket,
  hashRateLimitSubject,
  type RateLimitBucketSnapshot,
  type RateLimitPolicy,
} from "@/lib/rateLimit";

const NOW = new Date("2026-08-22T10:00:00.000Z");

const POLICY: RateLimitPolicy = {
  name: "test:policy",
  windowMs: 60_000,
  maxCount: 3,
  blockMs: 120_000,
};

describe("hashRateLimitSubject", () => {
  it("is stable for the same subject", () => {
    expect(hashRateLimitSubject("a@b.test")).toBe(hashRateLimitSubject("a@b.test"));
  });

  it("normalises case and surrounding whitespace", () => {
    // Two spellings of one address must share a bucket, or the limit is trivially
    // bypassed by varying the capitalisation.
    expect(hashRateLimitSubject("  A@B.TEST ")).toBe(hashRateLimitSubject("a@b.test"));
  });

  it("separates different subjects", () => {
    expect(hashRateLimitSubject("a@b.test")).not.toBe(hashRateLimitSubject("c@d.test"));
  });

  it("never contains the plaintext subject", () => {
    expect(hashRateLimitSubject("a@b.test")).not.toContain("a@b.test");
    expect(hashRateLimitSubject("a@b.test")).not.toContain("@");
  });

  it("is fixed width, whatever the input length", () => {
    const short = hashRateLimitSubject("a@b.test");
    const long = hashRateLimitSubject(`${"x".repeat(250)}@example.test`);
    expect(short).toHaveLength(32);
    expect(long).toHaveLength(32);
    expect(short).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildRateLimitKey", () => {
  it("namespaces by policy so one table serves every dimension", () => {
    const key = buildRateLimitKey(RATE_LIMIT_POLICIES.requestByEmail, "a@b.test");
    expect(key.startsWith("login-code:request:email:")).toBe(true);
  });

  it("gives the same subject different buckets per dimension", () => {
    const request = buildRateLimitKey(RATE_LIMIT_POLICIES.requestByEmail, "a@b.test");
    const verify = buildRateLimitKey(RATE_LIMIT_POLICIES.verifyByEmail, "a@b.test");
    expect(request).not.toBe(verify);
  });

  it("leaks no address into the stored key", () => {
    const key = buildRateLimitKey(RATE_LIMIT_POLICIES.requestByEmail, "doctor@clinic.test");
    expect(key).not.toContain("doctor");
    expect(key).not.toContain("clinic.test");
  });

  it("fits MySQL's VARCHAR(191) even for a maximum-length email", () => {
    // `key` has no @db.VarChar, so Prisma maps it to VARCHAR(191). A raw
    // 255-character address would overflow the column and throw on insert; the
    // digest is what makes the width constant.
    const longest = `${"x".repeat(243)}@example.test`;
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(buildRateLimitKey(policy, longest).length).toBeLessThanOrEqual(191);
    }
  });

  it("keeps IP subjects out of the key in the clear too", () => {
    const key = buildRateLimitKey(RATE_LIMIT_POLICIES.requestByIp, "203.0.113.7");
    expect(key).not.toContain("203.0.113.7");
  });
});

describe("RATE_LIMIT_POLICIES", () => {
  it("holds every dimension, and drops none as stages are added", () => {
    expect(Object.keys(RATE_LIMIT_POLICIES).sort()).toEqual([
      // Stage 6 — invitations.
      "acceptInvitationByIp",
      "inviteByEmail",
      "inviteByTenant",
      // Stage 4 — login codes.
      "requestByEmail",
      "requestByIp",
      "verifyByEmail",
      "verifyByIp",
    ]);
  });

  it("matches the approved Stage 6 invitation policy", () => {
    expect(RATE_LIMIT_POLICIES.inviteByEmail.maxCount).toBe(3);
    expect(RATE_LIMIT_POLICIES.inviteByTenant.maxCount).toBe(20);
    expect(RATE_LIMIT_POLICIES.acceptInvitationByIp.maxCount).toBe(20);
  });

  it("limits invitations to one address more tightly than a whole tenant", () => {
    // Harm concentrates on one victim's inbox, not on the sender — the same
    // reasoning as the login-code limits above.
    expect(RATE_LIMIT_POLICIES.inviteByEmail.maxCount).toBeLessThan(
      RATE_LIMIT_POLICIES.inviteByTenant.maxCount,
    );
  });

  it("matches the approved Stage 4 policy", () => {
    expect(RATE_LIMIT_POLICIES.requestByEmail.maxCount).toBe(3);
    expect(RATE_LIMIT_POLICIES.requestByIp.maxCount).toBe(20);
    expect(RATE_LIMIT_POLICIES.verifyByEmail.maxCount).toBe(10);
    expect(RATE_LIMIT_POLICIES.verifyByIp.maxCount).toBe(50);
  });

  it("uses a fifteen-minute window throughout", () => {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(policy.windowMs).toBe(15 * 60 * 1000);
    }
  });

  it("limits an address more tightly than the shared IP it sits behind", () => {
    // A whole front desk behind one NAT address must not lock itself out.
    expect(RATE_LIMIT_POLICIES.requestByEmail.maxCount).toBeLessThan(
      RATE_LIMIT_POLICIES.requestByIp.maxCount,
    );
    expect(RATE_LIMIT_POLICIES.verifyByEmail.maxCount).toBeLessThan(
      RATE_LIMIT_POLICIES.verifyByIp.maxCount,
    );
  });

  it("allows fewer verify attempts per address than a code survives requests", () => {
    // Bounding the online guessing budget: three codes per window, five guesses
    // each, but only ten verify attempts per address in that same window.
    expect(RATE_LIMIT_POLICIES.verifyByEmail.maxCount).toBeLessThan(
      RATE_LIMIT_POLICIES.requestByEmail.maxCount * 5,
    );
  });
});

describe("evaluateBucket", () => {
  function bucket(overrides: Partial<RateLimitBucketSnapshot> = {}): RateLimitBucketSnapshot {
    return { windowStartedAt: NOW, count: 0, blockedUntil: null, ...overrides };
  }

  it("allows a subject that has never been seen", () => {
    expect(evaluateBucket({ bucket: null, policy: POLICY, now: NOW })).toEqual({
      allowed: true,
      retryAfterMs: 0,
      reason: null,
    });
  });

  it("allows a subject below the cap", () => {
    expect(evaluateBucket({ bucket: bucket({ count: 2 }), policy: POLICY, now: NOW }).allowed).toBe(
      true,
    );
  });

  it("refuses a subject at the cap", () => {
    const verdict = evaluateBucket({ bucket: bucket({ count: 3 }), policy: POLICY, now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("limit-reached");
  });

  it("reports how long remains in the window when the cap is hit", () => {
    const verdict = evaluateBucket({
      bucket: bucket({ count: 3, windowStartedAt: new Date(NOW.getTime() - 20_000) }),
      policy: POLICY,
      now: NOW,
    });
    expect(verdict.retryAfterMs).toBe(40_000);
  });

  it("allows again once the window has rolled over", () => {
    // The stored count belongs to a window that is over, so it says nothing
    // about this one.
    expect(
      evaluateBucket({
        bucket: bucket({ count: 99, windowStartedAt: new Date(NOW.getTime() - 60_001) }),
        policy: POLICY,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });

  it("treats the window boundary as exclusive", () => {
    expect(
      evaluateBucket({
        bucket: bucket({ count: 99, windowStartedAt: new Date(NOW.getTime() - 60_000) }),
        policy: POLICY,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });

  it("refuses a blocked subject regardless of its count", () => {
    const verdict = evaluateBucket({
      bucket: bucket({ count: 0, blockedUntil: new Date(NOW.getTime() + 30_000) }),
      policy: POLICY,
      now: NOW,
    });
    expect(verdict).toEqual({ allowed: false, retryAfterMs: 30_000, reason: "blocked" });
  });

  it("checks the block before the window, so a rolled-over window cannot clear it", () => {
    expect(
      evaluateBucket({
        bucket: bucket({
          count: 0,
          windowStartedAt: new Date(NOW.getTime() - 999_999),
          blockedUntil: new Date(NOW.getTime() + 30_000),
        }),
        policy: POLICY,
        now: NOW,
      }).reason,
    ).toBe("blocked");
  });

  it("releases a subject once the block has elapsed", () => {
    expect(
      evaluateBucket({
        bucket: bucket({
          count: 0,
          windowStartedAt: NOW,
          blockedUntil: new Date(NOW.getTime() - 1),
        }),
        policy: POLICY,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });
});

describe("RateLimitError", () => {
  it("carries a retry window for the server without putting it in the message", () => {
    const error = new RateLimitError("Too many attempts. Wait a few minutes and try again.", 900_000);
    expect(error.retryAfterMs).toBe(900_000);
    expect(error.message).not.toContain("900");
    expect(error.name).toBe("RateLimitError");
  });

  it("has a message naming no account and no subject", () => {
    const error = new RateLimitError("Too many attempts. Wait a few minutes and try again.", 1000);
    expect(error.message.toLowerCase()).not.toContain("email");
    expect(error.message.toLowerCase()).not.toContain("account");
  });
});
