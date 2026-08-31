import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeTenant: vi.fn(),
  can: vi.fn(),
  requirePermission: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicTelephonyConfig: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return {
    ...actual,
    assertClinicInTenant: mocks.authorizeTenant,
    can: mocks.can,
    requirePermission: mocks.requirePermission,
  };
});

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAuditLog: mocks.writeAuditLog };
});

import {
  getClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigSchema,
} from "@/lib/telephony/clinicConfig";

const migrationName = "20260831160000_plivo_stage7_routing_hours";
const migration = readFileSync(
  resolve(`prisma/migrations/${migrationName}/migration.sql`),
  "utf8",
);
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const ACTOR = { userId: "user-a", tenantId: "tenant-a" };

describe("Stage 7 routing-mode configuration", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.authorizeTenant.mockResolvedValue(undefined);
    mocks.can.mockResolvedValue(true);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({
      id: "config-a",
      clinicId: "clinic-a",
      enabled: false,
      plivoNumber: null,
      publicPhoneNumber: null,
      receptionPhoneNumber: null,
      urgentPhoneNumber: null,
      timezone: "Asia/Kolkata",
      routingMode: "OPEN",
      createdAt: new Date("2026-08-31T00:00:00Z"),
      updatedAt: new Date("2026-08-31T00:00:00Z"),
    });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({ clinicTelephonyConfig: { upsert: mocks.upsert } }),
    );
  });

  it.each(["AUTO", "OPEN", "AFTER_HOURS"] as const)(
    "accepts routingMode=%s",
    (routingMode) => {
      expect(updateClinicTelephonyConfigSchema.parse({ routingMode })).toEqual({
        routingMode,
      });
    },
  );

  it("strictly rejects unknown routing modes", () => {
    expect(() =>
      updateClinicTelephonyConfigSchema.parse({ routingMode: "DISABLED" }),
    ).toThrow();
  });

  it("returns AFTER_HOURS for a clinic without a config row", async () => {
    await expect(
      getClinicTelephonyConfigForActor(ACTOR, "clinic-a"),
    ).resolves.toMatchObject({ routingMode: "AFTER_HOURS" });
  });

  it("audits routingMode by field name without private values", async () => {
    await updateClinicTelephonyConfigForActor(ACTOR, "clinic-a", {
      routingMode: "OPEN",
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        afterValue: {
          clinicId: "clinic-a",
          changedFields: ["routingMode"],
          enabled: false,
        },
      }),
    );
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/\+\d/);
  });
});

describe("Stage 7 additive Prisma migration", () => {
  it("sorts lexically after the Stage 5 migration", () => {
    expect(migrationName > "20260831120000_plivo_stage5_booking").toBe(true);
  });

  it("adds the safe AFTER_HOURS default and no DISABLED mode", () => {
    expect(migration).toContain(
      "ENUM('AUTO', 'OPEN', 'AFTER_HOURS') NOT NULL DEFAULT 'AFTER_HOURS'",
    );
    expect(migration).not.toContain("DISABLED");
  });

  it("defines one clinic/day unique key and cascade relation", () => {
    expect(schema).toContain(
      '@@unique([clinicId, dayOfWeek], map: "clinic_business_hours_clinic_day_key")',
    );
    expect(migration).toContain("clinic_business_hours_clinic_day_key");
    expect(migration).toContain("clinic_business_hours_clinic_id_fkey");
    expect(migration).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
  });

  it("keeps every new explicit database identifier within 64 characters", () => {
    const names = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/g)].map(
      (match) => match[1],
    );
    expect(names.length).toBeGreaterThan(0);
    expect(Math.max(...names.map((name) => name.length))).toBeLessThanOrEqual(64);
  });

  it("does not alter patient, appointment, or booking schema", () => {
    expect(migration).not.toMatch(
      /`(?:patients|appointments|telephony_booking_requests)`/,
    );
  });
});
