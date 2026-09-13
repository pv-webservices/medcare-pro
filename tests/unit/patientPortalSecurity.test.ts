import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashPortalToken,
  portalToken,
  portalRecordLive,
  portalLoginSchema,
  portalActivationSchema,
  portalPasswordSchema,
  assertPortalOrigin,
  ACTIVATION_TTL,
} from "@/lib/patientPortalSecurity";
import {
  hashPatientPassword,
  comparePatientPassword,
  DUMMY_PATIENT_HASH,
} from "@/lib/patientPortalPasswordAuth";
import {
  createPatientPortalTestMailer,
  portalEmailBody,
} from "@/lib/patientPortalEmails";
import {
  planPatientPortalRoleMigration,
  PRE_PATIENT_PORTAL_ROLES,
} from "@/lib/patientPortalRoleMigration";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
afterEach(() => vi.unstubAllEnvs());
describe("Patient Portal password security", () => {
  it("uses 32 bytes of entropy and SHA-256 hashes with a 15 minute activation TTL", () => {
    const token = portalToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(hashPortalToken(token)).toHaveLength(64);
    expect(portalToken()).not.toBe(token);
    expect(ACTIVATION_TTL).toBe(900000);
  });
  it("normalizes organization and patient code", () => {
    expect(
      portalLoginSchema.parse({
        organization: " SHARMA-CLINIC ",
        patientCode: " pt-2026-001 ",
        password: "passphrase here",
      }),
    ).toEqual({
      organization: "sharma-clinic",
      patientCode: "PT-2026-001",
      password: "passphrase here",
    });
  });
  it.each([
    "patientId",
    "tenantId",
    "clinicId",
    "portalAccountId",
    "linkId",
    "status",
  ])("rejects browser authority %s", (field) => {
    expect(
      portalLoginSchema.safeParse({
        organization: "clinic",
        patientCode: "PT-001",
        password: "passphrase here",
        [field]: "other",
      }).success,
    ).toBe(false);
    expect(
      portalActivationSchema.safeParse({
        token: portalToken(),
        password: "passphrase here",
        [field]: "other",
      }).success,
    ).toBe(false);
  });
  it("allows passphrases without arbitrary complexity and bounds length", () => {
    expect(portalPasswordSchema.safeParse("this is a passphrase").success).toBe(
      true,
    );
    expect(portalPasswordSchema.safeParse("short").success).toBe(false);
    expect(portalPasswordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
  it("bcrypt uses cost 12 and compares the entire long Unicode passphrase", async () => {
    const password = "é".repeat(60) + "first";
    const hash = await hashPatientPassword(password);
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
    expect(await comparePatientPassword(password, hash)).toBe(true);
    expect(await comparePatientPassword("é".repeat(60) + "second", hash)).toBe(
      false,
    );
    expect(await comparePatientPassword(password, DUMMY_PATIENT_HASH)).toBe(
      false,
    );
  }, 20000);
  it.each(["revokedAt", "consumedAt"])("refuses %s tokens", (field) =>
    expect(
      portalRecordLive(
        { expiresAt: new Date(Date.now() + 1000), [field]: new Date() },
        new Date(),
      ),
    ).toBe(false),
  );
  it("rejects expired tokens", () =>
    expect(portalRecordLive({ expiresAt: new Date(0) }, new Date())).toBe(
      false,
    ));
  it("requires matching origin and rejects cross-site requests", () => {
    vi.stubEnv("AUTH_URL", "https://clinic.example");
    expect(() =>
      assertPortalOrigin(new Request("https://clinic.example/api")),
    ).toThrow();
    expect(() =>
      assertPortalOrigin(
        new Request("https://clinic.example/api", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertPortalOrigin(
        new Request("https://clinic.example/api", {
          headers: {
            origin: "https://clinic.example",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertPortalOrigin(
        new Request("https://clinic.example/api", {
          headers: { origin: "https://clinic.example" },
        }),
      ),
    ).not.toThrow();
  });
  it.each(["production", "remote"])(
    "test mailer refuses %s environment",
    (environment) => {
      vi.stubEnv(
        "NODE_ENV",
        environment === "production" ? "production" : "test",
      );
      vi.stubEnv(
        "DATABASE_URL",
        `mysql://test@${environment === "remote" ? "remote.example" : "localhost"}/medcare_ep_portal_test`,
      );
      vi.stubEnv("PATIENT_PORTAL_TEST_TRANSPORT", "local-file");
      vi.stubEnv("PATIENT_PORTAL_TEST_OUTBOX", "C:/test-only");
      expect(createPatientPortalTestMailer).toThrow();
    },
  );
  it.each(["VERIFY_RECOVERY_EMAIL", "PASSWORD_RESET"] as const)(
    "%s security email contains no clinical data and no token in subject",
    (purpose) => {
      const token = portalToken();
      const body = portalEmailBody({
        to: "synthetic@example.test",
        purpose,
        url: `https://clinic.example/patient/security?token=${token}`,
      });
      expect(body.subject).not.toContain(token);
      expect(body.text).not.toMatch(
        /diagnosis|medication|appointment|prescription|doctor/i,
      );
      expect(body.html).toContain("https://clinic.example");
    },
  );
  it.each(["CLINIC_ADMIN", "RECEPTIONIST"])(
    "preserves customized %s role permissions",
    (key) => {
      const before = PRE_PATIENT_PORTAL_ROLES[key];
      expect(
        planPatientPortalRoleMigration({
          key,
          isSystem: true,
          permissions: before,
        }).status,
      ).toBe("ELIGIBLE");
      expect(
        planPatientPortalRoleMigration({
          key,
          isSystem: true,
          permissions: [...before, "custom:right"],
        }).status,
      ).toBe("CUSTOMIZED_OR_OLDER");
    },
  );
  it("keeps management entitlement defaults", () => {
    for (const role of DEFAULT_ROLES)
      expect(role.permissions.includes("patient_portal:manage")).toBe(
        ["CLINIC_ADMIN", "RECEPTIONIST"].includes(role.key),
      );
    expect(
      DEFAULT_FEATURES.find((f) => f.key === "patient_portal"),
    ).toMatchObject({ tier: "CORE", globalEnabled: true });
  });
});
