import { describe, expect, it } from "vitest";
import {
  RESET_LINK_INVALID_MESSAGE,
  RESET_MISMATCH_MESSAGE,
  RESET_RATE_LIMITED_MESSAGE,
  RESET_REQUEST_FAILED_MESSAGE,
  RESET_SENT_MESSAGE,
  RESET_UNKNOWN_ACCOUNT_MESSAGE,
  describeResetConfirm,
  describeResetRequest,
  passwordsMatch,
} from "@/components/auth/passwordResetState";
import {
  RESET_LINK_INVALID_MESSAGE as SERVER_LINK_INVALID_MESSAGE,
  RESET_REQUESTED_MESSAGE as SERVER_REQUESTED_MESSAGE,
  RESET_UNKNOWN_ACCOUNT_MESSAGE as SERVER_UNKNOWN_ACCOUNT_MESSAGE,
} from "@/lib/passwordReset";
import { RATE_LIMITED_MESSAGE as SERVER_RATE_LIMITED_MESSAGE } from "@/lib/rateLimit";

/**
 * The forgot-password forms mirror four server constants, for the same reason
 * loginCodeState.ts does: lib/passwordReset.ts imports bcrypt and Prisma, so a
 * client component cannot import it without dragging the server into the browser
 * bundle. This suite runs in Node and can import both sides, so it is the join
 * that catches one of them changing alone.
 */
describe("client copy mirrors the server's, word for word", () => {
  it("uses the server's neutral acknowledgement", () => {
    expect(RESET_SENT_MESSAGE).toBe(SERVER_REQUESTED_MESSAGE);
  });

  it("uses the server's unregistered-address message", () => {
    expect(RESET_UNKNOWN_ACCOUNT_MESSAGE).toBe(SERVER_UNKNOWN_ACCOUNT_MESSAGE);
  });

  it("uses the server's dead-link message", () => {
    expect(RESET_LINK_INVALID_MESSAGE).toBe(SERVER_LINK_INVALID_MESSAGE);
  });

  it("uses the server's throttling message", () => {
    expect(RESET_RATE_LIMITED_MESSAGE).toBe(SERVER_RATE_LIMITED_MESSAGE);
  });
});

describe("describeResetRequest", () => {
  it("confirms the send on 200 without naming the account", () => {
    expect(describeResetRequest(200)).toEqual({
      kind: "sent",
      message: RESET_SENT_MESSAGE,
      sent: true,
      offerSignup: false,
    });
  });

  it("reports an unregistered address on 404, and offers signup", () => {
    // The ONE disclosed branch — a product decision, explained on
    // AccountNotFoundError in src/lib/auth.ts.
    expect(describeResetRequest(404)).toEqual({
      kind: "unknown-account",
      message: RESET_UNKNOWN_ACCOUNT_MESSAGE,
      sent: false,
      offerSignup: true,
    });
  });

  it("reports throttling without confirming a send", () => {
    const outcome = describeResetRequest(429);
    expect(outcome.kind).toBe("rate-limited");
    expect(outcome.message).toBe(RESET_RATE_LIMITED_MESSAGE);
    expect(outcome.sent).toBe(false);
  });

  it("asks for a valid address on 400", () => {
    expect(describeResetRequest(400).kind).toBe("invalid-email");
    expect(describeResetRequest(400).sent).toBe(false);
  });

  it("falls back to the generic failure for anything else", () => {
    for (const status of [401, 403, 410, 500, 502, 0]) {
      const outcome = describeResetRequest(status);
      expect(outcome.kind).toBe("failed");
      expect(outcome.message).toBe(RESET_REQUEST_FAILED_MESSAGE);
      expect(outcome.sent).toBe(false);
    }
  });

  it("confirms a send on nothing but a 200", () => {
    for (const status of [201, 204, 301, 400, 404, 429, 500, 0]) {
      expect(describeResetRequest(status).sent).toBe(false);
    }
  });

  it("offers signup on 404 and on no other status", () => {
    for (const status of [200, 201, 400, 401, 410, 429, 500, 0]) {
      expect(describeResetRequest(status).offerSignup).toBe(false);
    }
    expect(describeResetRequest(404).offerSignup).toBe(true);
  });
});

describe("describeResetConfirm", () => {
  it("treats 200 as the password having changed", () => {
    expect(describeResetConfirm(200)).toEqual({
      kind: "changed",
      message: null,
      changed: true,
    });
  });

  it("defers to the server's own text on 400, and only on 400", () => {
    // 400 carries the password rule the user has to satisfy — the one body the
    // client is allowed to read. Every other status maps to a local constant.
    expect(describeResetConfirm(400)).toEqual({
      kind: "weak-password",
      message: null,
      changed: false,
    });
    for (const status of [200, 410, 500]) {
      expect(describeResetConfirm(status).kind).not.toBe("weak-password");
    }
  });

  it("reports a dead link on 410 without saying which way it died", () => {
    // Invalid, expired, already used and account-no-longer-resettable all arrive
    // as 410 and must stay indistinguishable here.
    expect(describeResetConfirm(410)).toEqual({
      kind: "dead-link",
      message: RESET_LINK_INVALID_MESSAGE,
      changed: false,
    });
  });

  it("falls back to the generic failure for anything else", () => {
    for (const status of [401, 403, 404, 429, 500, 502, 0]) {
      const outcome = describeResetConfirm(status);
      expect(outcome.kind).toBe("failed");
      expect(outcome.message).toBe(RESET_REQUEST_FAILED_MESSAGE);
    }
  });

  it("reports success on nothing but a 200", () => {
    for (const status of [201, 204, 301, 400, 410, 429, 500, 0]) {
      expect(describeResetConfirm(status).changed).toBe(false);
    }
  });
});

describe("passwordsMatch", () => {
  it("accepts two identical strings", () => {
    expect(passwordsMatch("correct horse battery", "correct horse battery")).toBe(true);
  });

  it("rejects a difference in trailing whitespace", () => {
    // Trimming here would let a user set a password they cannot then type back.
    expect(passwordsMatch("hunter2hunter2", "hunter2hunter2 ")).toBe(false);
  });

  it("rejects a difference in case", () => {
    expect(passwordsMatch("Passphrase123", "passphrase123")).toBe(false);
  });

  it("treats two empty strings as matching", () => {
    // Emptiness is the `required` attribute's and the server schema's problem,
    // not this predicate's — it answers one question and nothing else.
    expect(passwordsMatch("", "")).toBe(true);
  });
});

describe("the mismatch message names the fields, not the account", () => {
  it("mentions neither an email nor an account", () => {
    expect(RESET_MISMATCH_MESSAGE.toLowerCase()).not.toContain("account");
    expect(RESET_MISMATCH_MESSAGE.toLowerCase()).not.toContain("email");
  });
});
