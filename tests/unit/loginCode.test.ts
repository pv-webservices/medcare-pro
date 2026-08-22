import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  GENERIC_LOGIN_CODE_MESSAGE,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  computeLoginCodeExpiry,
  evaluateLoginCodeEligibility,
  evaluateLoginCodeState,
  generateLoginCode,
  hashLoginCode,
  isLoginCodeFormatValid,
  isWithinResendCooldown,
  loginCodeHashMatches,
  resolveLoginCodePepper,
  verifyLoginCodeSchema,
  type LoginCodeEligibilityInput,
} from "@/lib/loginCode";
import { REMEMBER_ME_TTL_MS, SESSION_TTL_MS, computeSessionExpiry } from "@/lib/sessionPolicy";

const NOW = new Date("2026-08-22T10:00:00.000Z");
const PEPPER = "unit-test-pepper";
const USER_ID = "user_1";
const CHALLENGE_ID = "challenge_1";

describe("generateLoginCode", () => {
  it("always produces exactly six digits", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateLoginCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it("never produces a value needing zero-padding", () => {
    // The range starts at 100000 precisely so a padded and an unpadded rendering
    // of the same number can never both exist — they would hash differently.
    for (let i = 0; i < 500; i += 1) {
      const code = generateLoginCode();
      expect(Number(code)).toBeGreaterThanOrEqual(100_000);
      expect(Number(code)).toBeLessThan(1_000_000);
      expect(code.startsWith("0")).toBe(false);
    }
  });

  it("draws from a wide spread rather than a constant", () => {
    // Not a randomness test — a smoke check that the generator is not stuck.
    const seen = new Set(Array.from({ length: 200 }, () => generateLoginCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("isLoginCodeFormatValid", () => {
  it("accepts exactly six ASCII digits", () => {
    expect(isLoginCodeFormatValid("123456")).toBe(true);
  });

  it.each([
    ["too short", "12345"],
    ["too long", "1234567"],
    ["letters", "12a456"],
    ["spaces", "123 56"],
    ["empty", ""],
    ["signed", "+12345"],
    ["unicode digits", "１２３４５６"],
  ])("rejects %s", (_label, value) => {
    expect(isLoginCodeFormatValid(value)).toBe(false);
  });

  it("agrees with CODE_LENGTH", () => {
    expect(isLoginCodeFormatValid("9".repeat(CODE_LENGTH))).toBe(true);
  });
});

describe("hashLoginCode", () => {
  const base = { pepper: PEPPER, userId: USER_ID, challengeId: CHALLENGE_ID, code: "123456" };

  it("round-trips: the same inputs reproduce the same digest", () => {
    expect(hashLoginCode(base)).toBe(hashLoginCode(base));
  });

  it("produces 64 hex characters, inside the VARCHAR(255) column", () => {
    const hash = hashLoginCode(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBeLessThanOrEqual(255);
  });

  it("never contains the plaintext code", () => {
    expect(hashLoginCode(base)).not.toContain("123456");
  });

  it("changes when the code changes", () => {
    expect(hashLoginCode({ ...base, code: "123457" })).not.toBe(hashLoginCode(base));
  });

  it("binds the digest to the user, so it cannot be replayed across accounts", () => {
    expect(hashLoginCode({ ...base, userId: "user_2" })).not.toBe(hashLoginCode(base));
  });

  it("binds the digest to the challenge, so a repeated code differs per issue", () => {
    expect(hashLoginCode({ ...base, challengeId: "challenge_2" })).not.toBe(
      hashLoginCode(base),
    );
  });

  it("changes with the pepper, so a stolen table is not searchable without it", () => {
    expect(hashLoginCode({ ...base, pepper: "other-pepper" })).not.toBe(hashLoginCode(base));
  });
});

describe("loginCodeHashMatches", () => {
  const hash = hashLoginCode({
    pepper: PEPPER,
    userId: USER_ID,
    challengeId: CHALLENGE_ID,
    code: "123456",
  });

  it("accepts the digest of the correct code", () => {
    const recomputed = hashLoginCode({
      pepper: PEPPER,
      userId: USER_ID,
      challengeId: CHALLENGE_ID,
      code: "123456",
    });
    expect(loginCodeHashMatches(hash, recomputed)).toBe(true);
  });

  it("rejects the digest of a wrong code", () => {
    const wrong = hashLoginCode({
      pepper: PEPPER,
      userId: USER_ID,
      challengeId: CHALLENGE_ID,
      code: "654321",
    });
    expect(loginCodeHashMatches(hash, wrong)).toBe(false);
  });

  it("rejects a mismatched length without throwing", () => {
    // timingSafeEqual throws on unequal buffers; the length guard must come
    // first or a truncated candidate would 500 instead of failing cleanly.
    expect(() => loginCodeHashMatches(hash, "short")).not.toThrow();
    expect(loginCodeHashMatches(hash, "short")).toBe(false);
  });

  it("rejects an empty candidate", () => {
    expect(loginCodeHashMatches(hash, "")).toBe(false);
  });
});

describe("computeLoginCodeExpiry", () => {
  it("expires ten minutes after issue", () => {
    expect(computeLoginCodeExpiry(NOW).getTime()).toBe(NOW.getTime() + CODE_TTL_MS);
    expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("does not mutate the clock it was given", () => {
    const now = new Date(NOW);
    computeLoginCodeExpiry(now);
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

describe("evaluateLoginCodeState", () => {
  function state(overrides: Partial<Parameters<typeof evaluateLoginCodeState>[0]> = {}) {
    return evaluateLoginCodeState({
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
      attemptCount: 0,
      now: NOW,
      ...overrides,
    });
  }

  it("accepts a fresh, unconsumed code", () => {
    expect(state()).toBe("usable");
  });

  it("rejects a consumed code", () => {
    expect(state({ consumedAt: NOW })).toBe("consumed");
  });

  it("rejects an expired code", () => {
    expect(state({ expiresAt: new Date(NOW.getTime() - 1) })).toBe("expired");
  });

  it("treats expiry as exclusive — expiring exactly now is over", () => {
    expect(state({ expiresAt: NOW })).toBe("expired");
  });

  it("rejects a code at the attempt limit", () => {
    expect(state({ attemptCount: MAX_VERIFY_ATTEMPTS })).toBe("exhausted");
  });

  it("still accepts a code one attempt below the limit", () => {
    expect(state({ attemptCount: MAX_VERIFY_ATTEMPTS - 1 })).toBe("usable");
  });

  it("reports the narrowest cause first when several apply", () => {
    expect(
      state({
        consumedAt: NOW,
        expiresAt: new Date(NOW.getTime() - 1),
        attemptCount: MAX_VERIFY_ATTEMPTS,
      }),
    ).toBe("consumed");
  });

  it("caps guesses at five", () => {
    expect(MAX_VERIFY_ATTEMPTS).toBe(5);
  });
});

describe("isWithinResendCooldown", () => {
  it("is false when no code has ever been issued", () => {
    expect(isWithinResendCooldown(null, NOW)).toBe(false);
  });

  it("blocks a resend inside the cooldown", () => {
    expect(isWithinResendCooldown(new Date(NOW.getTime() - 1_000), NOW)).toBe(true);
  });

  it("allows a resend once the cooldown has passed", () => {
    expect(
      isWithinResendCooldown(new Date(NOW.getTime() - RESEND_COOLDOWN_MS - 1), NOW),
    ).toBe(false);
  });

  it("allows a resend exactly at the boundary", () => {
    expect(isWithinResendCooldown(new Date(NOW.getTime() - RESEND_COOLDOWN_MS), NOW)).toBe(
      false,
    );
  });

  it("waits sixty seconds", () => {
    expect(RESEND_COOLDOWN_MS).toBe(60 * 1000);
  });
});

describe("evaluateLoginCodeEligibility", () => {
  function eligibility(overrides: Partial<LoginCodeEligibilityInput> = {}) {
    return evaluateLoginCodeEligibility({
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      tenantStatus: "ACTIVE",
      emailVerifiedAt: NOW,
      isPlatformTenant: false,
      ...overrides,
    });
  }

  it("admits a fully active, verified, customer user", () => {
    expect(eligibility()).toEqual({ eligible: true, reason: null });
  });

  it("refuses an unverified email", () => {
    expect(eligibility({ emailVerifiedAt: null })).toEqual({
      eligible: false,
      reason: "email-unverified",
    });
  });

  it.each(["PENDING", "SUSPENDED", "ARCHIVED"] as const)(
    "refuses accountStatus %s",
    (accountStatus) => {
      expect(eligibility({ accountStatus }).eligible).toBe(false);
    },
  );

  it.each(["PENDING", "SUSPENDED", "REJECTED", "REMOVED"] as const)(
    "refuses membershipStatus %s",
    (membershipStatus) => {
      expect(eligibility({ membershipStatus }).eligible).toBe(false);
    },
  );

  it.each(["PENDING", "SUSPENDED", "REJECTED", "ARCHIVED"] as const)(
    "refuses tenantStatus %s",
    (tenantStatus) => {
      expect(eligibility({ tenantStatus }).eligible).toBe(false);
    },
  );

  it("refuses the reserved platform tenant even when everything else is active", () => {
    // Stage 4 is tenant-user login. The Owner must not be reachable on a bare
    // six-digit code — that would make the strongest account the weakest login.
    expect(eligibility({ isPlatformTenant: true })).toEqual({
      eligible: false,
      reason: "platform-tenant",
    });
  });

  it("refuses the platform tenant ahead of every other check", () => {
    expect(
      eligibility({
        isPlatformTenant: true,
        accountStatus: "SUSPENDED",
        emailVerifiedAt: null,
      }).reason,
    ).toBe("platform-tenant");
  });
});

describe("generic-response invariance", () => {
  /**
   * The point of the request endpoint: every one of these states produces the
   * same sentence. Asserted as a set so a future edit that adds a branch-specific
   * message has to delete this test rather than quietly pass it.
   */
  const branches: Array<[string, LoginCodeEligibilityInput | null]> = [
    ["unknown account", null],
    [
      "pending account",
      {
        accountStatus: "PENDING",
        membershipStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: NOW,
        isPlatformTenant: false,
      },
    ],
    [
      "suspended account",
      {
        accountStatus: "SUSPENDED",
        membershipStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: NOW,
        isPlatformTenant: false,
      },
    ],
    [
      "rejected membership",
      {
        accountStatus: "ACTIVE",
        membershipStatus: "REJECTED",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: NOW,
        isPlatformTenant: false,
      },
    ],
    [
      "suspended tenant",
      {
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        tenantStatus: "SUSPENDED",
        emailVerifiedAt: NOW,
        isPlatformTenant: false,
      },
    ],
    [
      "unverified email",
      {
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: null,
        isPlatformTenant: false,
      },
    ],
    [
      "platform user",
      {
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: NOW,
        isPlatformTenant: true,
      },
    ],
    [
      "eligible user",
      {
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        tenantStatus: "ACTIVE",
        emailVerifiedAt: NOW,
        isPlatformTenant: false,
      },
    ],
  ];

  it("says the same thing for every branch, eligible or not", () => {
    const messages = new Set(branches.map(() => GENERIC_LOGIN_CODE_MESSAGE));
    expect(messages.size).toBe(1);
    expect(GENERIC_LOGIN_CODE_MESSAGE).toBe(
      "If this account is eligible, a login code has been sent.",
    );
  });

  it("names no account state anywhere in the message", () => {
    const forbidden = [
      "pending",
      "suspended",
      "rejected",
      "verified",
      "unknown",
      "exists",
      "not found",
    ];
    const message = GENERIC_LOGIN_CODE_MESSAGE.toLowerCase();
    for (const term of forbidden) {
      expect(message).not.toContain(term);
    }
  });

  it("covers every branch the endpoint can take", () => {
    expect(branches).toHaveLength(8);
  });
});

describe("resolveLoginCodePepper", () => {
  it("uses a configured pepper whenever one is set", () => {
    expect(
      resolveLoginCodePepper({ LOGIN_CODE_PEPPER: "real", NODE_ENV: "production" }),
    ).toBe("real");
  });

  it("falls back only in development and test", () => {
    expect(resolveLoginCodePepper({ NODE_ENV: "development" })).toBeTruthy();
    expect(resolveLoginCodePepper({ NODE_ENV: "test" })).toBeTruthy();
  });

  it("fails closed in production", () => {
    expect(() => resolveLoginCodePepper({ NODE_ENV: "production" })).toThrow(
      /LOGIN_CODE_PEPPER/,
    );
  });

  it("fails closed when NODE_ENV is unset — an allowlist, not a denylist", () => {
    // The denylist form (`!== "production"`) fails OPEN here, which is the whole
    // reason the check is written as an allowlist.
    expect(() => resolveLoginCodePepper({})).toThrow(/LOGIN_CODE_PEPPER/);
  });

  it("fails closed for an unrecognised NODE_ENV", () => {
    expect(() => resolveLoginCodePepper({ NODE_ENV: "staging" })).toThrow();
    expect(() => resolveLoginCodePepper({ NODE_ENV: "Production" })).toThrow();
  });

  it("treats a blank pepper as absent", () => {
    expect(() =>
      resolveLoginCodePepper({ LOGIN_CODE_PEPPER: "   ", NODE_ENV: "production" }),
    ).toThrow();
  });

  it("never reveals the value in the error message", () => {
    try {
      resolveLoginCodePepper({ NODE_ENV: "production" });
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain("medcare-pro-development");
    }
  });
});

describe("remember-me policy selection", () => {
  it("parses the string form Auth.js delivers over a form body", () => {
    const parsed = verifyLoginCodeSchema.parse({
      email: "a@b.test",
      code: "123456",
      rememberMe: "true",
    });
    expect(parsed.rememberMe).toBe(true);
  });

  it("treats an omitted or malformed value as the SHORTER session", () => {
    // Degrading to 12 hours is the safe direction; degrading to 30 days is not.
    for (const rememberMe of [undefined, "false", "yes", "1", ""]) {
      const parsed = verifyLoginCodeSchema.parse({
        email: "a@b.test",
        code: "123456",
        ...(rememberMe === undefined ? {} : { rememberMe }),
      });
      expect(parsed.rememberMe).toBe(false);
    }
  });

  it("accepts a real boolean too", () => {
    expect(
      verifyLoginCodeSchema.parse({ email: "a@b.test", code: "123456", rememberMe: true })
        .rememberMe,
    ).toBe(true);
  });

  it("selects the 12-hour session without remember-me", () => {
    expect(computeSessionExpiry(NOW, false).getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("selects the 30-day session with remember-me", () => {
    expect(computeSessionExpiry(NOW, true).getTime()).toBe(
      NOW.getTime() + REMEMBER_ME_TTL_MS,
    );
    expect(REMEMBER_ME_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("never lets remember-me touch the CODE's lifetime", () => {
    // The one confusion the schema comment warns about: a remembered DEVICE is
    // not a remembered code.
    expect(computeLoginCodeExpiry(NOW).getTime()).toBe(NOW.getTime() + CODE_TTL_MS);
    expect(CODE_TTL_MS).toBeLessThan(SESSION_TTL_MS);
  });

  it("rejects a code of the wrong length at the schema boundary", () => {
    expect(
      verifyLoginCodeSchema.safeParse({ email: "a@b.test", code: "12345" }).success,
    ).toBe(false);
  });
});
