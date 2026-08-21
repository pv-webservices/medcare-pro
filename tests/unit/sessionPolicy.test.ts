import { describe, expect, it } from "vitest";
import {
  REMEMBER_ME_TTL_MS,
  SESSION_TTL_MS,
  computeSessionExpiry,
  evaluateSession,
  isSessionLive,
  truncateForColumn,
  type SessionRecordSnapshot,
} from "@/lib/sessionPolicy";

const NOW = new Date("2026-08-22T10:00:00.000Z");
const SID = "sess_live";
const USER = "user_1";

function record(overrides: Partial<SessionRecordSnapshot> = {}): SessionRecordSnapshot {
  return {
    id: SID,
    userId: USER,
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
}

function evaluate(overrides: Partial<Parameters<typeof evaluateSession>[0]> = {}) {
  return evaluateSession({
    sid: SID,
    claimedUserId: USER,
    record: record(),
    now: NOW,
    ...overrides,
  });
}

describe("evaluateSession", () => {
  it("accepts a live, unrevoked, unexpired session", () => {
    expect(evaluate()).toEqual({ valid: true, reason: null });
  });

  it("treats a missing sid as unauthenticated, never as skip-the-check", () => {
    expect(evaluate({ sid: null }).reason).toBe("no-sid");
    expect(evaluate({ sid: undefined }).reason).toBe("no-sid");
    expect(evaluate({ sid: "" }).reason).toBe("no-sid");
  });

  it("refuses a token that names no user", () => {
    expect(evaluate({ claimedUserId: null }).reason).toBe("no-sid");
  });

  it("refuses a sid with no row behind it", () => {
    expect(evaluate({ record: null }).reason).toBe("unknown-sid");
  });

  it("refuses when the row found is not the row asked for", () => {
    expect(evaluate({ record: record({ id: "someone_else" }) }).reason).toBe("unknown-sid");
  });

  it("refuses a token whose sid and user id disagree", () => {
    // The shape a stolen-and-edited token takes: keep a live sid, swap the
    // claimed identity. Trusting the sid alone would let this through.
    expect(evaluate({ record: record({ userId: "attacker" }) }).reason).toBe("user-mismatch");
  });

  it("refuses a revoked session", () => {
    expect(evaluate({ record: record({ revokedAt: NOW }) }).reason).toBe("revoked");
  });

  it("reports revoked ahead of expired, because that is the actionable cause", () => {
    const stale = record({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluate({ record: stale }).reason).toBe("revoked");
  });

  it("refuses an expired session", () => {
    expect(evaluate({ record: record({ expiresAt: new Date(NOW.getTime() - 1) }) }).reason).toBe(
      "expired",
    );
  });

  it("treats expiry as exclusive: expiring exactly now is over", () => {
    expect(evaluate({ record: record({ expiresAt: NOW }) }).valid).toBe(false);
  });

  it("isSessionLive agrees with evaluateSession", () => {
    expect(isSessionLive({ sid: SID, claimedUserId: USER, record: record(), now: NOW })).toBe(true);
    expect(isSessionLive({ sid: null, claimedUserId: USER, record: null, now: NOW })).toBe(false);
  });
});

describe("computeSessionExpiry", () => {
  it("uses the short lifetime by default", () => {
    expect(computeSessionExpiry(NOW, false).getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
  });

  it("uses the long lifetime when the user asked to be remembered", () => {
    expect(computeSessionExpiry(NOW, true).getTime()).toBe(NOW.getTime() + REMEMBER_ME_TTL_MS);
  });

  it("makes remember-me longer than the default, but still finite", () => {
    expect(REMEMBER_ME_TTL_MS).toBeGreaterThan(SESSION_TTL_MS);
    expect(Number.isFinite(REMEMBER_ME_TTL_MS)).toBe(true);
  });

  it("does not mutate the clock it was given", () => {
    const before = NOW.getTime();
    computeSessionExpiry(NOW, true);
    expect(NOW.getTime()).toBe(before);
  });
});

describe("truncateForColumn", () => {
  it("returns null for anything that is not a usable string", () => {
    expect(truncateForColumn(null, 10)).toBeNull();
    expect(truncateForColumn(undefined, 10)).toBeNull();
    expect(truncateForColumn("   ", 10)).toBeNull();
  });

  it("trims but otherwise preserves a short value", () => {
    expect(truncateForColumn("  1.2.3.4  ", 45)).toBe("1.2.3.4");
  });

  it("cuts an over-long value to the column width", () => {
    expect(truncateForColumn("x".repeat(100), 45)).toHaveLength(45);
  });

  it("keeps a value of exactly the column width", () => {
    const exact = "y".repeat(45);
    expect(truncateForColumn(exact, 45)).toBe(exact);
  });
});
