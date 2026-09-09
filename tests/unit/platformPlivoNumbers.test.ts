import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rootFindMany: vi.fn(),
  transaction: vi.fn(),
  clinicFindFirst: vi.fn(),
  numberFindUnique: vi.fn(),
  numberFindMany: vi.fn(),
  numberUpsert: vi.fn(),
  numberUpdate: vi.fn(),
  numberUpdateMany: vi.fn(),
  configUpsert: vi.fn(),
  configUpdateMany: vi.fn(),
  configFindUnique: vi.fn(),
  configFindFirst: vi.fn(),
  audit: vi.fn(),
}));

const tx = {
  clinic: { findFirst: mocks.clinicFindFirst },
  platformPlivoNumber: {
    findUnique: mocks.numberFindUnique,
    findMany: mocks.numberFindMany,
    upsert: mocks.numberUpsert,
    update: mocks.numberUpdate,
    updateMany: mocks.numberUpdateMany,
  },
  clinicTelephonyConfig: {
    upsert: mocks.configUpsert,
    updateMany: mocks.configUpdateMany,
    findUnique: mocks.configFindUnique,
    findFirst: mocks.configFindFirst,
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformPlivoNumber: { findMany: mocks.rootFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAuditLog: mocks.audit };
});

import { ConflictError } from "@/lib/apiHandler";
import {
  assignPlatformPlivoNumber,
  platformPlivoAssignmentSchema,
  reassignPlatformPlivoNumber,
  releasePlatformPlivoNumber,
  releasePlatformPlivoNumberEarly,
  releasePlatformPlivoNumberSchema,
  restorePreviousPlatformPlivoNumber,
  syncPlatformPlivoNumbers,
  unassignPlatformPlivoNumber,
} from "@/lib/platform/plivoNumbers";

const owner = {
  userId: "owner",
  platformRole: "SUPER_ADMIN" as const,
  sessionId: "session",
};
const now = new Date("2026-09-09T12:00:00.000Z");
const number = {
  id: "number-a",
  phoneNumber: "+918031725772",
  providerApplicationId: "31757617137466453",
  providerApplicationName: "MedCare_Pro_IVR_Production",
  providerNumberType: "local",
  providerRegion: "India",
  providerPresent: true,
  assignmentStatus: "AVAILABLE" as const,
  healthStatus: "HEALTHY" as const,
  assignedTenantId: null,
  assignedClinicId: null,
  assignedAt: null,
  quarantinedAt: null,
  quarantinedUntil: null,
  quarantineSourceTenantId: null,
  quarantineSourceClinicId: null,
  quarantineSourceTelephonyEnabled: null,
  lastSyncedAt: now,
  providerSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

describe("platform Plivo number ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation) => operation(tx));
    mocks.clinicFindFirst.mockResolvedValue({ id: "clinic-a", tenantId: "tenant-a" });
    mocks.numberUpdateMany.mockResolvedValue({ count: 1 });
    mocks.configUpsert.mockResolvedValue({});
    mocks.configUpdateMany.mockResolvedValue({ count: 1 });
    mocks.configFindUnique.mockResolvedValue({ enabled: true });
    mocks.configFindFirst.mockResolvedValue(null);
    mocks.audit.mockResolvedValue(undefined);
  });

  it("defines the additive global and per-clinic uniqueness constraints", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const migration = readFileSync(resolve("prisma/migrations/20260909120000_platform_plivo_number_inventory/migration.sql"), "utf8");
    const quarantineMigration = readFileSync(resolve("prisma/migrations/20260910120000_plivo_quarantine_origin/migration.sql"), "utf8");
    expect(schema).toMatch(/phoneNumber\s+String\s+@unique/);
    expect(schema).toMatch(/assignedClinicId\s+String\?\s+@unique/);
    expect(migration).toContain("platform_plivo_numbers_phone_number_key");
    expect(migration).toContain("platform_plivo_numbers_assigned_clinic_id_key");
    expect(schema).toContain("quarantineSourceTelephonyEnabled Boolean?");
    expect(quarantineMigration).toContain("quarantine_source_tenant_id");
    expect(quarantineMigration).toContain("quarantine_source_clinic_id");
  });

  it("uses strict action schemas and rejects client-controlled tenant scope", () => {
    expect(platformPlivoAssignmentSchema.parse({ action: "assign", clinicId: "clinic-a", numberId: "number-a" })).toEqual({ action: "assign", clinicId: "clinic-a", numberId: "number-a" });
    expect(() => platformPlivoAssignmentSchema.parse({ action: "assign", clinicId: "clinic-a", numberId: "number-a", tenantId: "tenant-b" })).toThrow();
    expect(() => platformPlivoAssignmentSchema.parse({ action: "reassign", clinicId: "clinic-a", numberId: "number-a" })).toThrow();
    expect(platformPlivoAssignmentSchema.parse({ action: "restorePreviousAssignment", numberId: "number-a", confirmed: true })).toEqual({ action: "restorePreviousAssignment", numberId: "number-a", confirmed: true });
    expect(() => platformPlivoAssignmentSchema.parse({ action: "restorePreviousAssignment", numberId: "number-a", confirmed: true, clinicId: "clinic-b" })).toThrow();
    expect(() => releasePlatformPlivoNumberSchema.parse({ action: "releaseQuarantineEarly", numberId: "number-a", confirmed: true, reason: "short" })).toThrow();
    expect(() => releasePlatformPlivoNumberSchema.parse({ action: "releaseQuarantineEarly", numberId: "number-a", reason: "A sufficiently detailed reason" })).toThrow();
    expect(() => releasePlatformPlivoNumberSchema.parse({ action: "releaseQuarantine", numberId: "number-a" })).toThrow();
  });

  it("does not mutate inventory when the provider listing fails", async () => {
    const provider = { listOwnedNumbers: vi.fn().mockRejectedValue(new Error("provider unavailable")) };
    await expect(syncPlatformPlivoNumbers(owner, provider, "31757617137466453", now)).rejects.toThrow("provider unavailable");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("marks unseen rows missing only after a complete provider listing and retains assignment", async () => {
    const missingAssigned = { ...number, id: "number-b", phoneNumber: "+918031700000", assignmentStatus: "ASSIGNED", assignedTenantId: "tenant-a", assignedClinicId: "clinic-a" };
    mocks.rootFindMany.mockResolvedValueOnce([number, missingAssigned]).mockResolvedValueOnce([]);
    mocks.numberFindMany.mockResolvedValue([missingAssigned]);
    mocks.numberUpsert.mockResolvedValue({ id: "number-a" });
    const provider = { listOwnedNumbers: vi.fn().mockResolvedValue([{ phoneNumber: number.phoneNumber, applicationId: number.providerApplicationId, applicationName: number.providerApplicationName, numberType: "local", region: "India" }]) };

    await syncPlatformPlivoNumbers(owner, provider, "31757617137466453", now);

    expect(mocks.numberUpdate).toHaveBeenCalledWith({
      where: { id: "number-b" },
      data: { providerPresent: false, healthStatus: "MISSING_FROM_PROVIDER", lastSyncedAt: now },
    });
    expect(JSON.stringify(mocks.numberUpdate.mock.calls)).not.toContain("assignedClinicId");
  });

  it("marks a provider-present number out of sync when the application differs", async () => {
    mocks.rootFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.numberFindMany.mockResolvedValue([]);
    mocks.numberUpsert.mockResolvedValue({ id: "number-a" });
    const provider = { listOwnedNumbers: vi.fn().mockResolvedValue([{ phoneNumber: number.phoneNumber, applicationId: "99999", applicationName: "Wrong", numberType: "local", region: "India" }]) };
    await syncPlatformPlivoNumbers(owner, provider, "31757617137466453", now);
    expect(mocks.numberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ healthStatus: "OUT_OF_SYNC", providerPresent: true }),
      update: expect.objectContaining({ healthStatus: "OUT_OF_SYNC", providerPresent: true }),
    }));
  });

  it("assigns atomically and mirrors only the provider number", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce(number).mockResolvedValueOnce(null);
    await assignPlatformPlivoNumber(owner, "tenant-a", { clinicId: "clinic-a", numberId: "number-a" }, now);
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignmentStatus: "AVAILABLE", providerPresent: true, healthStatus: "HEALTHY" }),
      data: expect.objectContaining({ assignedTenantId: "tenant-a", assignedClinicId: "clinic-a", assignmentStatus: "ASSIGNED" }),
    }));
    expect(mocks.configUpsert).toHaveBeenCalledWith({
      where: { clinicId: "clinic-a" },
      create: { clinicId: "clinic-a", plivoNumber: number.phoneNumber },
      update: { plivoNumber: number.phoneNumber },
    });
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("turns a lost assignment race into a generic conflict", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce(number).mockResolvedValueOnce(null);
    mocks.numberUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(assignPlatformPlivoNumber(owner, "tenant-a", { clinicId: "clinic-a", numberId: "number-a" }, now)).rejects.toEqual(new ConflictError("This IVR number is already assigned."));
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });

  it("refuses a provider-present number that is not healthy", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce({ ...number, healthStatus: "OUT_OF_SYNC" }).mockResolvedValueOnce(null);
    await expect(assignPlatformPlivoNumber(owner, "tenant-a", { clinicId: "clinic-a", numberId: "number-a" }, now)).rejects.toThrow("not available");
    expect(mocks.numberUpdateMany).not.toHaveBeenCalled();
  });

  it("unassigns into quarantine without deleting other telephony settings", async () => {
    mocks.numberFindUnique.mockResolvedValue({ ...number, assignmentStatus: "ASSIGNED", assignedTenantId: "tenant-a", assignedClinicId: "clinic-a" });
    await unassignPlatformPlivoNumber(owner, "tenant-a", { clinicId: "clinic-a", numberId: "number-a" }, 14, now);
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignmentStatus: "QUARANTINED",
        assignedTenantId: null,
        assignedClinicId: null,
        quarantineSourceTenantId: "tenant-a",
        quarantineSourceClinicId: "clinic-a",
        quarantineSourceTelephonyEnabled: true,
      }),
    }));
    expect(mocks.configUpdateMany).toHaveBeenCalledWith({
      where: { clinicId: "clinic-a", plivoNumber: number.phoneNumber },
      data: { plivoNumber: null, enabled: false },
    });
    expect(Object.keys(mocks.configUpdateMany.mock.calls[0][0].data).sort()).toEqual(["enabled", "plivoNumber"]);
  });

  it("reassigns atomically and quarantines the number being replaced", async () => {
    const selected = { ...number, assignmentStatus: "ASSIGNED", assignedTenantId: "tenant-a", assignedClinicId: "clinic-old" };
    const replaced = { ...number, id: "number-old", phoneNumber: "+918031700000", assignmentStatus: "ASSIGNED", assignedTenantId: "tenant-a", assignedClinicId: "clinic-a" };
    mocks.numberFindUnique.mockResolvedValueOnce(selected).mockResolvedValueOnce(replaced);
    await reassignPlatformPlivoNumber(owner, "tenant-a", { clinicId: "clinic-a", numberId: "number-a" }, 14, now);
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "number-old" }),
      data: expect.objectContaining({ assignmentStatus: "QUARANTINED", assignedClinicId: null }),
    }));
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quarantineSourceTenantId: "tenant-a",
        quarantineSourceClinicId: "clinic-a",
        quarantineSourceTelephonyEnabled: true,
      }),
    }));
    expect(mocks.configUpdateMany).toHaveBeenCalledWith({
      where: { clinicId: "clinic-old", plivoNumber: selected.phoneNumber },
      data: { plivoNumber: null, enabled: false },
    });
    expect(mocks.configUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clinicId: "clinic-a" },
      update: { plivoNumber: selected.phoneNumber },
    }));
  });

  it("restores only the recorded previous clinic and restores its known enabled state", async () => {
    const quarantined = {
      ...number,
      assignmentStatus: "QUARANTINED" as const,
      quarantinedAt: now,
      quarantinedUntil: new Date("2026-09-23T12:00:00.000Z"),
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
      quarantineSourceTelephonyEnabled: true,
    };
    mocks.numberFindUnique.mockResolvedValueOnce(quarantined).mockResolvedValueOnce(null);
    const result = await restorePreviousPlatformPlivoNumber(owner, "number-a", "tenant-a", now);
    expect(result).toEqual({ previousTelephonyStateKnown: true, telephonyEnabled: true });
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ quarantineSourceTenantId: "tenant-a", quarantineSourceClinicId: "clinic-a" }),
      data: expect.objectContaining({
        assignmentStatus: "ASSIGNED",
        assignedTenantId: "tenant-a",
        assignedClinicId: "clinic-a",
        quarantineSourceTenantId: null,
        quarantineSourceClinicId: null,
        quarantineSourceTelephonyEnabled: null,
      }),
    }));
    expect(mocks.configUpsert).toHaveBeenCalledWith({
      where: { clinicId: "clinic-a" },
      create: { clinicId: "clinic-a", plivoNumber: number.phoneNumber, enabled: true },
      update: { plivoNumber: number.phoneNumber, enabled: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "PLIVO_NUMBER_ASSIGNMENT_RESTORED" }));
  });

  it("keeps telephony disabled when the previous activation state is unknown", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
      quarantineSourceTelephonyEnabled: null,
    }).mockResolvedValueOnce(null);
    const result = await restorePreviousPlatformPlivoNumber(owner, "number-a", undefined, now);
    expect(result).toEqual({ previousTelephonyStateKnown: false, telephonyEnabled: false });
    expect(mocks.configUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { plivoNumber: number.phoneNumber, enabled: false },
    }));
  });

  it("refuses restore when the previous clinic already has another number", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
    }).mockResolvedValueOnce({ id: "another-number" });
    await expect(restorePreviousPlatformPlivoNumber(owner, "number-a", undefined, now)).rejects.toThrow("already has another IVR number");
    expect(mocks.configUpsert).not.toHaveBeenCalled();
  });

  it("cannot restore through a different organisation route", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
    });
    await expect(restorePreviousPlatformPlivoNumber(owner, "number-a", "tenant-b", now)).rejects.toThrow("cannot be restored");
    expect(mocks.numberUpdateMany).not.toHaveBeenCalled();
  });

  it("requires a healthy provider-present quarantine for restore", async () => {
    mocks.numberFindUnique.mockResolvedValueOnce({
      ...number,
      assignmentStatus: "QUARANTINED",
      healthStatus: "OUT_OF_SYNC",
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
    });
    await expect(restorePreviousPlatformPlivoNumber(owner, "number-a", undefined, now)).rejects.toThrow("cannot be restored");
    expect(mocks.numberUpdateMany).not.toHaveBeenCalled();
  });

  it("releases quarantine early without assigning and audits the mandatory reason", async () => {
    mocks.numberFindUnique.mockResolvedValue({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantineSourceTenantId: "tenant-a",
      quarantineSourceClinicId: "clinic-a",
    });
    await releasePlatformPlivoNumberEarly(owner, "number-a", "Acceptance testing recovery");
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignmentStatus: "AVAILABLE", quarantineSourceTenantId: null }),
    }));
    expect(mocks.numberUpdateMany.mock.calls[0][0].data).not.toHaveProperty("assignedTenantId");
    expect(mocks.numberUpdateMany.mock.calls[0][0].data).not.toHaveProperty("assignedClinicId");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "PLIVO_NUMBER_QUARANTINE_OVERRIDDEN",
      reason: "Acceptance testing recovery",
    }));
  });

  it("releases only an expired quarantine", async () => {
    mocks.numberFindUnique.mockResolvedValue({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantinedAt: new Date("2026-08-20T00:00:00.000Z"),
      quarantinedUntil: new Date("2026-09-01T00:00:00.000Z"),
    });
    await releasePlatformPlivoNumber(owner, "number-a", now);
    expect(mocks.numberUpdateMany).toHaveBeenCalledWith({
      where: { id: "number-a", assignmentStatus: "QUARANTINED", quarantinedUntil: { lte: now } },
      data: {
        assignmentStatus: "AVAILABLE",
        quarantinedAt: null,
        quarantinedUntil: null,
        quarantineSourceTenantId: null,
        quarantineSourceClinicId: null,
        quarantineSourceTelephonyEnabled: null,
      },
    });
  });

  it("rejects normal release before quarantine expiry", async () => {
    mocks.numberFindUnique.mockResolvedValue({
      ...number,
      assignmentStatus: "QUARANTINED",
      quarantinedUntil: new Date("2026-09-23T12:00:00.000Z"),
    });
    await expect(releasePlatformPlivoNumber(owner, "number-a", now)).rejects.toThrow("not ready");
    expect(mocks.numberUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps every Owner endpoint behind requirePlatformOwner", () => {
    for (const path of [
      "src/app/api/owner/ivr-numbers/route.ts",
      "src/app/api/owner/ivr-numbers/sync/route.ts",
      "src/app/api/owner/applications/[id]/ivr/route.ts",
    ]) {
      expect(readFileSync(resolve(path), "utf8")).toContain("requirePlatformOwner");
    }
  });

  it("keeps the production backfill dry-run by default and requires --apply", () => {
    const source = readFileSync(resolve("scripts/backfill-plivo-number-inventory.mts"), "utf8");
    expect(source).toContain('process.argv.includes("--apply")');
    expect(source).toContain("DRY RUN");
    expect(source).toContain("Backfill aborted because ambiguous conflicts");
    expect(source).not.toContain("PLIVO_AUTH_TOKEN");
  });

  it("keeps quarantine-origin repair dry-run by default and never guesses enabled state", () => {
    const source = readFileSync(resolve("scripts/backfill-plivo-quarantine-origin.mts"), "utf8");
    expect(source).toContain('process.argv.includes("--apply")');
    expect(source).toContain("DRY RUN");
    expect(source).toContain("previous telephony state: UNKNOWN");
    expect(source).toContain("quarantineSourceTelephonyEnabled: null");
  });

  it("uses MEDCARE confirmation dialogs for every destructive Platform action", () => {
    const tenantUi = readFileSync(resolve("src/components/owner/PlatformTenantIvr.tsx"), "utf8");
    const inventoryUi = readFileSync(resolve("src/components/owner/PlatformPlivoNumbers.tsx"), "utf8");
    expect(tenantUi).not.toContain("window.confirm");
    expect(tenantUi).toContain("ConfirmDialog");
    expect(tenantUi).toContain("Unassign and quarantine");
    expect(tenantUi).toContain("The current number will enter quarantine");
    expect(inventoryUi).toContain("Release quarantined number early?");
    expect(inventoryUi).toContain("Quarantined until");
    expect(inventoryUi).not.toContain("row.assignmentStatus === \"QUARANTINED\" ? <span className=\"text-slate-500\">View after provider fix");
  });
});
