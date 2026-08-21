import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, assertSafeAuditMetadata } from "@/lib/audit";

describe("assertSafeAuditMetadata", () => {
  it("accepts ordinary metadata", () => {
    expect(() =>
      assertSafeAuditMetadata({
        email: "owner@example.com",
        platformRole: "SUPER_ADMIN",
        accountStatus: "ACTIVE",
      }),
    ).not.toThrow();
  });

  it("accepts primitives and null", () => {
    for (const value of [null, undefined, 1, "text", true]) {
      expect(() => assertSafeAuditMetadata(value)).not.toThrow();
    }
  });

  it("refuses a plaintext login code", () => {
    expect(() => assertSafeAuditMetadata({ code: "123456" })).toThrow(/secret/i);
  });

  it("refuses a hashed login code just as firmly", () => {
    // The hash is not safe to publish either: six digits is ~20 bits, so a
    // digest in an append-only table read by support staff is the code itself.
    expect(() => assertSafeAuditMetadata({ codeHash: "abc" })).toThrow();
    expect(() => assertSafeAuditMetadata({ code_hash: "abc" })).toThrow();
  });

  it("refuses invitation tokens", () => {
    expect(() => assertSafeAuditMetadata({ token: "t" })).toThrow();
    expect(() => assertSafeAuditMetadata({ tokenHash: "t" })).toThrow();
    expect(() => assertSafeAuditMetadata({ invitationToken: "t" })).toThrow();
  });

  it("refuses passwords", () => {
    expect(() => assertSafeAuditMetadata({ password: "p" })).toThrow();
    expect(() => assertSafeAuditMetadata({ passwordHash: "p" })).toThrow();
    expect(() => assertSafeAuditMetadata({ newPassword: "p" })).toThrow();
  });

  it("refuses secrets and peppers", () => {
    expect(() => assertSafeAuditMetadata({ secret: "s" })).toThrow();
    expect(() => assertSafeAuditMetadata({ SERVER_PEPPER: "s" })).toThrow();
    expect(() => assertSafeAuditMetadata({ apiKey: "k" })).toThrow();
    expect(() => assertSafeAuditMetadata({ authorization: "Bearer x" })).toThrow();
  });

  it("ignores case and punctuation in key names", () => {
    expect(() => assertSafeAuditMetadata({ "Pass-Word": "p" })).toThrow();
    expect(() => assertSafeAuditMetadata({ TOKEN_HASH: "t" })).toThrow();
  });

  it("finds a secret nested deep inside the value", () => {
    expect(() =>
      assertSafeAuditMetadata({ before: { user: { credentials: { password: "p" } } } }),
    ).toThrow();
  });

  it("finds a secret inside an array", () => {
    expect(() => assertSafeAuditMetadata({ members: [{ name: "a" }, { token: "t" }] })).toThrow();
  });

  it("names the offending path, so the fix is obvious", () => {
    expect(() => assertSafeAuditMetadata({ outer: { codeHash: "x" } }, "afterValue")).toThrow(
      /afterValue\.outer\.codeHash/,
    );
  });

  it("throws rather than redacting", () => {
    // Silently stripping would let the mistake ship: the call site keeps
    // believing it logged the field and nobody finds out until an incident.
    const metadata = { password: "hunter2" };
    expect(() => assertSafeAuditMetadata(metadata)).toThrow();
    expect(metadata.password).toBe("hunter2");
  });
});

describe("AUDIT_ACTIONS", () => {
  it("records what happened, in past tense, within the column width", () => {
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[A-Z][A-Z_]*$/);
      expect(action.length).toBeLessThanOrEqual(64);
    }
  });

  it("includes the Stage 2 provisioning action", () => {
    expect(AUDIT_ACTIONS.OWNER_CREATED).toBe("OWNER_CREATED");
  });
});
