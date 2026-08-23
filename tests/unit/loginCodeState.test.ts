import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  CODE_SENT_MESSAGE,
  INVALID_CODE_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  RATE_LIMITED_MESSAGE,
  REQUEST_FAILED_MESSAGE,
  RESEND_COOLDOWN_MS,
  UNKNOWN_ACCOUNT_MESSAGE,
  describeRequestOutcome,
  formatCooldown,
  isCodeComplete,
  remainingCooldownMs,
  sanitiseCodeInput,
} from "@/components/auth/loginCodeState";
import {
  CODE_LENGTH as SERVER_CODE_LENGTH,
  GENERIC_LOGIN_CODE_MESSAGE,
  RESEND_COOLDOWN_MS as SERVER_RESEND_COOLDOWN_MS,
  UNKNOWN_ACCOUNT_LOGIN_CODE_MESSAGE as SERVER_UNKNOWN_ACCOUNT_MESSAGE,
} from "@/lib/loginCode";
import { RATE_LIMITED_MESSAGE as SERVER_RATE_LIMITED_MESSAGE } from "@/lib/rateLimit";

/**
 * The client mirrors four server constants because it cannot import the module
 * that owns them — lib/loginCode.ts pulls in node:crypto and Prisma, and a
 * client component that imported it would drag both into the browser bundle.
 *
 * This suite runs in Node and can import both sides, so it is the join. If the
 * server ever changes a value alone, the drift shows up here rather than as a
 * countdown that lies or a message that no longer matches the API's.
 */
describe("client constants track the server", () => {
  it("uses the server's code length", () => {
    expect(CODE_LENGTH).toBe(SERVER_CODE_LENGTH);
  });

  it("uses the server's resend cooldown", () => {
    expect(RESEND_COOLDOWN_MS).toBe(SERVER_RESEND_COOLDOWN_MS);
  });

  it("uses the server's generic acknowledgement, word for word", () => {
    expect(CODE_SENT_MESSAGE).toBe(GENERIC_LOGIN_CODE_MESSAGE);
  });

  it("uses the server's throttling message", () => {
    expect(RATE_LIMITED_MESSAGE).toBe(SERVER_RATE_LIMITED_MESSAGE);
  });

  it("uses the server's unregistered-address message, word for word", () => {
    expect(UNKNOWN_ACCOUNT_MESSAGE).toBe(SERVER_UNKNOWN_ACCOUNT_MESSAGE);
  });

  it("keeps the disclosed message distinct from the generic one", () => {
    // If these two ever collapsed into the same string, the 404 branch would
    // stop saying anything the 200 branch does not — and the change would be
    // invisible in the UI rather than failing here.
    expect(UNKNOWN_ACCOUNT_MESSAGE).not.toBe(CODE_SENT_MESSAGE);
  });
});

describe("sanitiseCodeInput", () => {
  it("keeps a plain six-digit code untouched", () => {
    expect(sanitiseCodeInput("123456")).toBe("123456");
  });

  it("keeps leading zeros, which a numeric input would eat", () => {
    expect(sanitiseCodeInput("000123")).toBe("000123");
  });

  it("drops letters and punctuation typed into the field", () => {
    expect(sanitiseCodeInput("1a2b3c")).toBe("123");
    expect(sanitiseCodeInput("--12--")).toBe("12");
  });

  it("normalises the shapes a code is actually pasted in", () => {
    // All three are how the code leaves an email client.
    expect(sanitiseCodeInput("123 456")).toBe("123456");
    expect(sanitiseCodeInput("123-456")).toBe("123456");
    expect(sanitiseCodeInput("\n123456\t")).toBe("123456");
  });

  it("takes the first six digits of a pasted line of surrounding text", () => {
    expect(sanitiseCodeInput("Your code is 123456, it expires in 10 minutes")).toBe("123456");
  });

  it("never returns more than the code length", () => {
    expect(sanitiseCodeInput("1234567890")).toHaveLength(CODE_LENGTH);
  });

  it("returns an empty string for nothing usable", () => {
    expect(sanitiseCodeInput("")).toBe("");
    expect(sanitiseCodeInput("abcdef")).toBe("");
    expect(sanitiseCodeInput(null)).toBe("");
    expect(sanitiseCodeInput(undefined)).toBe("");
  });

  it("is idempotent, so re-running it on state cannot change it", () => {
    const once = sanitiseCodeInput("12 34-56 78");
    expect(sanitiseCodeInput(once)).toBe(once);
  });

  it("can only ever shorten its input", () => {
    for (const input of ["1", "abc", "1 2 3 4 5 6 7", "", "999999"]) {
      expect(sanitiseCodeInput(input).length).toBeLessThanOrEqual(input.length);
    }
  });
});

describe("isCodeComplete", () => {
  it("is true only at exactly six digits", () => {
    expect(isCodeComplete("123456")).toBe(true);
    expect(isCodeComplete("12345")).toBe(false);
    expect(isCodeComplete("")).toBe(false);
  });

  it("judges length, never correctness", () => {
    // Two different codes are equally "complete"; which one is right is the
    // server's business and this helper has no opinion.
    expect(isCodeComplete("000000")).toBe(true);
    expect(isCodeComplete("999999")).toBe(true);
  });
});

describe("remainingCooldownMs", () => {
  const NOW = 1_700_000_000_000;

  it("is zero before anything has been requested", () => {
    // Distinct from "the cooldown finished": nothing has started one.
    expect(remainingCooldownMs(null, NOW)).toBe(0);
  });

  it("is the full window immediately after a request", () => {
    expect(remainingCooldownMs(NOW, NOW)).toBe(RESEND_COOLDOWN_MS);
  });

  it("counts down as time passes", () => {
    expect(remainingCooldownMs(NOW, NOW + 20_000)).toBe(RESEND_COOLDOWN_MS - 20_000);
  });

  it("reaches zero exactly at the boundary", () => {
    expect(remainingCooldownMs(NOW, NOW + RESEND_COOLDOWN_MS)).toBe(0);
  });

  it("never goes negative, whatever the clock does", () => {
    // A machine whose clock jumps forward must not produce a negative that
    // renders as "Resend in -412s".
    expect(remainingCooldownMs(NOW, NOW + 10 * RESEND_COOLDOWN_MS)).toBe(0);
  });

  it("clamps a clock that jumps backwards to the window it knows", () => {
    expect(remainingCooldownMs(NOW, NOW - 5_000)).toBe(RESEND_COOLDOWN_MS + 5_000);
  });

  it("accepts an explicit window for testing without touching the constant", () => {
    expect(remainingCooldownMs(NOW, NOW + 1_000, 5_000)).toBe(4_000);
  });
});

describe("formatCooldown", () => {
  it("rounds up so the label never reads zero while the button is disabled", () => {
    expect(formatCooldown(1)).toBe("1s");
    expect(formatCooldown(999)).toBe("1s");
    expect(formatCooldown(1_001)).toBe("2s");
  });

  it("shows the whole window at the start", () => {
    expect(formatCooldown(RESEND_COOLDOWN_MS)).toBe("60s");
  });

  it("shows zero only when nothing is left", () => {
    expect(formatCooldown(0)).toBe("0s");
  });

  it("refuses to render a negative", () => {
    expect(formatCooldown(-5_000)).toBe("0s");
  });
});

describe("describeRequestOutcome", () => {
  it("advances on 200 with the generic acknowledgement", () => {
    expect(describeRequestOutcome(200)).toEqual({
      kind: "sent",
      message: CODE_SENT_MESSAGE,
      advance: true,
      offerSignup: false,
    });
  });

  it("says the same thing on 200 whatever REGISTERED account it was for", () => {
    // A 200 now means only "this address exists". The endpoint still answers
    // identically for a suspended, pending, unverified and eligible account, so
    // deriving copy from the status alone preserves what remains undisclosed.
    expect(describeRequestOutcome(200).message).toBe(describeRequestOutcome(200).message);
  });

  it("reports an unregistered address on 404, and offers signup", () => {
    // THE ONE DISCLOSED BRANCH — a deliberate product decision, explained on
    // AccountNotFoundError in src/lib/auth.ts. It must not advance: there is no
    // inbox for a code to arrive in.
    const outcome = describeRequestOutcome(404);
    expect(outcome.kind).toBe("unknown-account");
    expect(outcome.message).toBe(UNKNOWN_ACCOUNT_MESSAGE);
    expect(outcome.advance).toBe(false);
    expect(outcome.offerSignup).toBe(true);
  });

  it("offers signup on that status and on no other", () => {
    for (const status of [200, 201, 400, 401, 403, 429, 500, 502, 0]) {
      expect(describeRequestOutcome(status).offerSignup).toBe(false);
    }
  });

  it("reports throttling without advancing", () => {
    const outcome = describeRequestOutcome(429);
    expect(outcome.kind).toBe("rate-limited");
    expect(outcome.message).toBe(RATE_LIMITED_MESSAGE);
    expect(outcome.advance).toBe(false);
  });

  it("asks for a valid address on 400", () => {
    expect(describeRequestOutcome(400).message).toBe(INVALID_EMAIL_MESSAGE);
    expect(describeRequestOutcome(400).advance).toBe(false);
  });

  it("falls back to the generic failure for anything else", () => {
    // 404 is deliberately absent: it is a meaningful status here now.
    for (const status of [401, 403, 500, 502, 0]) {
      const outcome = describeRequestOutcome(status);
      expect(outcome.kind).toBe("failed");
      expect(outcome.message).toBe(REQUEST_FAILED_MESSAGE);
      expect(outcome.advance).toBe(false);
    }
  });

  it("advances on nothing but a 200", () => {
    for (const status of [201, 204, 301, 400, 401, 404, 429, 500]) {
      expect(describeRequestOutcome(status).advance).toBe(false);
    }
  });
});

/**
 * The remaining copy still discloses nothing. UNKNOWN_ACCOUNT_MESSAGE is
 * deliberately excluded from this list — it is the one string that DOES name an
 * account fact, by product decision (see AccountNotFoundError in
 * src/lib/auth.ts). Adding it here would fail, which is the point: the exclusion
 * has to be a decision somebody made, not a message that drifted in.
 */
describe("user-facing copy discloses nothing", () => {
  const ALL_COPY = [
    CODE_SENT_MESSAGE,
    INVALID_CODE_MESSAGE,
    INVALID_EMAIL_MESSAGE,
    RATE_LIMITED_MESSAGE,
    REQUEST_FAILED_MESSAGE,
  ];

  it("names no account state and no internal machinery", () => {
    // "Too many attempts" is deliberately absent from this list: it describes
    // the caller's own behaviour, not the account's, and is the one refusal a
    // user can actually act on.
    const forbidden = [
      "suspended",
      "pending",
      "rejected",
      "not found",
      "unknown",
      "expired",
      "prisma",
      "hmac",
      "pepper",
      "database",
      "tenant",
      "clinic",
    ];
    for (const copy of ALL_COPY) {
      for (const word of forbidden) {
        expect(copy.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("gives one message for every verification refusal", () => {
    // Wrong, expired, already used and out-of-attempts must be indistinguishable
    // in the UI, because they are indistinguishable in the API by design.
    expect(INVALID_CODE_MESSAGE).toBe("That code is not valid. Request a new one.");
  });
});
