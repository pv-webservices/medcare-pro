import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizePatientMobile,
  hashPortalToken,
  portalToken,
  portalCodeDigest,
  portalCodeMatches,
  portalRecordLive,
  portalChallengeLive,
  portalLoginSchema,
  portalVerifySchema,
  assertPortalOrigin,
  portalPepper,
  OTP_ATTEMPTS,
} from "@/lib/patientPortalSecurity";
import {
  planPatientPortalRoleMigration,
  PRE_PATIENT_PORTAL_ROLES,
} from "@/lib/patientPortalRoleMigration";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
import { createPatientPortalTestSender } from "@/lib/patientPortalTestSender";
const now = new Date("2026-09-13T00:00:00Z");
afterEach(() => vi.unstubAllEnvs());
describe("Patient Portal security", () => {
  it.each([
    "9876543210",
    "+919876543210",
    "919876543210",
    "00919876543210",
    "(98765) 43210",
  ])("normalizes %s", (n) =>
    expect(normalizePatientMobile(n)).toBe("+919876543210"),
  );
  it.each([
    "1234567890",
    "+19876543210",
    "987654321",
    "98765432100",
    "98765abc10",
  ])("rejects %s", (n) => expect(() => normalizePatientMobile(n)).toThrow());
  it("generates high entropy opaque tokens and stores only a different digest", () => {
    const t = portalToken();
    expect(t).toMatch(/^[\w-]{43}$/);
    expect(portalToken()).not.toBe(t);
    expect(hashPortalToken(t)).toHaveLength(64);
    expect(hashPortalToken(t)).not.toBe(t);
  });
  it("binds OTP digests to challenge and pepper", () => {
    const secret = "x".repeat(32);
    const d = portalCodeDigest("a", "012345", secret);
    expect(portalCodeMatches("a", "012345", d, secret)).toBe(true);
    expect(portalCodeMatches("b", "012345", d, secret)).toBe(false);
    expect(portalCodeMatches("a", "012345", d, "y".repeat(32))).toBe(false);
    expect(portalCodeMatches("a", "999999", d, secret)).toBe(false);
    expect(portalCodeMatches("a", "012345", "bad", secret)).toBe(false);
  });
  it.each([
    { expiresAt: now },
    { expiresAt: new Date(now.getTime() + 1), revokedAt: now },
    { expiresAt: new Date(now.getTime() + 1), consumedAt: now },
  ])("refuses expired/revoked/consumed token %j", (row) =>
    expect(portalRecordLive(row, now)).toBe(false),
  );
  it("accepts an unconsumed future token", () =>
    expect(
      portalRecordLive({ expiresAt: new Date(now.getTime() + 1) }, now),
    ).toBe(true));
  it("refuses exhausted challenges even if database maxAttempts is broadened", () => {
    expect(
      portalChallengeLive(
        {
          expiresAt: new Date(now.getTime() + 1000),
          consumedAt: null,
          attemptCount: OTP_ATTEMPTS,
          maxAttempts: 100,
        },
        now,
      ),
    ).toBe(false);
  });
  it("accepts a live challenge below five attempts", () =>
    expect(
      portalChallengeLive(
        {
          expiresAt: new Date(now.getTime() + 1000),
          consumedAt: null,
          attemptCount: 4,
          maxAttempts: 5,
        },
        now,
      ),
    ).toBe(true));
  it.each(["patientId", "tenantId", "clinicId", "roleId"])(
    "rejects browser ownership field %s",
    (field) => {
      expect(
        portalLoginSchema.safeParse({ mobile: "9876543210", [field]: "other" })
          .success,
      ).toBe(false);
      expect(
        portalVerifySchema.safeParse({
          mobile: "9876543210",
          code: "012345",
          [field]: "other",
        }).success,
      ).toBe(false);
    },
  );
  it("requires a strong configured pepper", () => {
    vi.stubEnv("PATIENT_PORTAL_OTP_SECRET", "");
    expect(portalPepper).toThrow();
    vi.stubEnv("PATIENT_PORTAL_OTP_SECRET", "x".repeat(32));
    expect(portalPepper()).toHaveLength(32);
  });
  it("rejects foreign and absent origins", () => {
    vi.stubEnv("AUTH_URL", "https://clinic.example");
    expect(() =>
      assertPortalOrigin(
        new Request("https://clinic.example/api", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertPortalOrigin(new Request("https://clinic.example/api")),
    ).toThrow();
    expect(() =>
      assertPortalOrigin(
        new Request("https://clinic.example/api", {
          headers: { origin: "https://clinic.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("test transport fails closed in production despite copied test flags", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "mysql://test@localhost/medcare_ep_portal_test");
    vi.stubEnv("PATIENT_PORTAL_TEST_TRANSPORT", "local-file");
    vi.stubEnv("PATIENT_PORTAL_TEST_OUTBOX", "C:/test-only");
    expect(createPatientPortalTestSender).toThrow();
  });
  it("test transport refuses remote databases", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://test@remote.example/medcare_ep_portal_test",
    );
    vi.stubEnv("PATIENT_PORTAL_TEST_TRANSPORT", "local-file");
    vi.stubEnv("PATIENT_PORTAL_TEST_OUTBOX", "C:/test-only");
    expect(createPatientPortalTestSender).toThrow();
  });
  it.each(["CLINIC_ADMIN", "RECEPTIONIST"])(
    "backfills only exact historical system %s roles",
    (key) => {
      const before = PRE_PATIENT_PORTAL_ROLES[key];
      expect(
        planPatientPortalRoleMigration({
          key,
          isSystem: true,
          permissions: before,
        }).status,
      ).toBe("ELIGIBLE");
      for (const permissions of [
        before.slice(1),
        [...before, "custom:permission"],
        [...before, before[0]],
        {},
      ])
        expect(
          planPatientPortalRoleMigration({ key, isSystem: true, permissions })
            .status,
        ).toBe("CUSTOMIZED_OR_OLDER");
      expect(
        planPatientPortalRoleMigration({
          key,
          isSystem: false,
          permissions: before,
        }).status,
      ).toBe("CUSTOMIZED_OR_OLDER");
    },
  );
  it("defaults management only to Admin/front desk/Owner wildcard", () => {
    for (const r of DEFAULT_ROLES)
      expect(r.permissions.includes("patient_portal:manage")).toBe(
        ["CLINIC_ADMIN", "RECEPTIONIST"].includes(r.key),
      );
    expect(
      DEFAULT_FEATURES.find((f) => f.key === "patient_portal"),
    ).toMatchObject({ globalEnabled: true, inDefaultPlan: true, tier: "CORE" });
  });
});
