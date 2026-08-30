import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertClinicInTenant: vi.fn(),
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
    assertClinicInTenant: mocks.assertClinicInTenant,
    can: mocks.can,
    requirePermission: mocks.requirePermission,
  };
});

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAuditLog: mocks.writeAuditLog };
});

import { ConflictError } from "@/lib/apiHandler";
import { PermissionError, ScopeError } from "@/lib/rbac";
import {
  getClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigForActor,
} from "@/lib/telephony/clinicConfig";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };
const STORED_CONFIG = {
  id: "config-a",
  clinicId: "clinic-a",
  enabled: false,
  plivoNumber: null,
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
  timezone: "Asia/Kolkata",
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
  updatedAt: new Date("2026-08-30T00:00:00.000Z"),
};

describe("clinic telephony domain authorization and writes", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.assertClinicInTenant.mockResolvedValue(undefined);
    mocks.can.mockResolvedValue(true);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({
      ...STORED_CONFIG,
      enabled: true,
      plivoNumber: "+14155550101",
    });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({ clinicTelephonyConfig: { upsert: mocks.upsert } }),
    );
  });

  it("requires tenant membership, clinic visibility, and clinic:edit for reads", async () => {
    const result = await getClinicTelephonyConfigForActor(ACTOR, "clinic-a");

    expect(result).toMatchObject({ clinicId: "clinic-a", enabled: false });
    expect(mocks.assertClinicInTenant).toHaveBeenCalledWith(
      "tenant-a",
      "clinic-a",
    );
    expect(mocks.can).toHaveBeenCalledWith(ACTOR, "clinic:read", "clinic-a");
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      ACTOR,
      "clinic:edit",
      "clinic-a",
    );
  });

  it("does not enumerate cross-tenant clinics", async () => {
    mocks.assertClinicInTenant.mockRejectedValueOnce(new ScopeError());

    await expect(
      getClinicTelephonyConfigForActor(ACTOR, "clinic-c"),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("does not enumerate clinics outside a clinic-scoped role", async () => {
    mocks.can.mockResolvedValueOnce(false);

    await expect(
      getClinicTelephonyConfigForActor(ACTOR, "clinic-b"),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("denies a visible clinic when edit permission is absent", async () => {
    mocks.requirePermission.mockRejectedValueOnce(
      new PermissionError("clinic:edit"),
    );

    await expect(
      getClinicTelephonyConfigForActor(ACTOR, "clinic-a"),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("audits only field names and enabled state in the write transaction", async () => {
    await updateClinicTelephonyConfigForActor(ACTOR, "clinic-a", {
      enabled: true,
      plivoNumber: "+14155550101",
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetType: "ClinicTelephonyConfig",
        targetId: "config-a",
        actorUserId: "user-a",
        actorTenantId: "tenant-a",
        afterValue: {
          clinicId: "clinic-a",
          changedFields: ["enabled", "plivoNumber"],
          enabled: true,
        },
      }),
    );
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain(
      "+14155550101",
    );
  });

  it("maps database uniqueness failures to a non-disclosing conflict", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      updateClinicTelephonyConfigForActor(ACTOR, "clinic-a", {
        plivoNumber: "+14155550101",
      }),
    ).rejects.toEqual(
      new ConflictError("That provider number is already assigned."),
    );
  });
});
