import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  deleteProfile: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.authorize,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicIvrProfile: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAuditLog: mocks.writeAuditLog };
});

import { PermissionError, ScopeError } from "@/lib/rbac";
import {
  getClinicIvrProfileForActor,
  replaceClinicIvrProfileForActor,
  replaceClinicIvrProfileSchema,
  resetClinicIvrProfileForActor,
} from "@/lib/telephony/ivrProfile";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };
const UPDATED_AT = new Date("2026-09-02T06:00:00.000Z");

function input() {
  return replaceClinicIvrProfileSchema.parse({
    greetingTemplate: "Thank you for calling {clinicName}.",
    language: "en-US",
    voice: "WOMAN",
    items: [
      {
        digit: 1,
        label: "tomorrow slots",
        action: "TOMORROW_SLOTS",
        position: 0,
        enabled: true,
      },
      {
        digit: 4,
        label: "clinic information",
        action: "CLINIC_INFORMATION",
        position: 1,
        enabled: true,
      },
    ],
  });
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-a",
    clinicId: "clinic-a",
    greetingTemplate: input().greetingTemplate,
    language: input().language,
    voice: input().voice,
    updatedAt: UPDATED_AT,
    items: input().items,
    ...overrides,
  };
}

describe("clinic IVR profile service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.authorize.mockResolvedValue(undefined);
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({
      id: "profile-a",
      clinicId: "clinic-a",
      greetingTemplate: input().greetingTemplate,
      language: input().language,
      voice: input().voice,
      updatedAt: UPDATED_AT,
    });
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.createMany.mockResolvedValue({ count: input().items.length });
    mocks.deleteProfile.mockResolvedValue({ id: "profile-a" });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        clinicIvrProfile: {
          findUnique: mocks.findUnique,
          upsert: mocks.upsert,
          delete: mocks.deleteProfile,
        },
        clinicIvrMenuItem: {
          deleteMany: mocks.deleteMany,
          createMany: mocks.createMany,
        },
      }),
    );
  });

  it("returns a virtual default without creating database rows", async () => {
    const result = await getClinicIvrProfileForActor(ACTOR, "clinic-a");
    expect(mocks.authorize).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(result).toMatchObject({
      clinicId: "clinic-a",
      source: "default",
      greetingTemplate: "Welcome to {clinicName}.",
      updatedAt: null,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("returns a persisted profile as custom without infrastructure fields", async () => {
    mocks.findUnique.mockResolvedValueOnce(stored());
    const result = await getClinicIvrProfileForActor(ACTOR, "clinic-a");
    expect(result).toMatchObject({ source: "custom", updatedAt: UPDATED_AT });
    expect(JSON.stringify(result)).not.toMatch(
      /plivoNumber|publicPhoneNumber|receptionPhoneNumber|urgentPhoneNumber/i,
    );
  });

  it("atomically replaces the complete profile and appends a safe audit event", async () => {
    const result = await replaceClinicIvrProfileForActor(
      ACTOR,
      "clinic-a",
      input(),
    );

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: "clinic-a" } }),
    );
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { profileId: "profile-a" },
    });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: input().items.map((item) => ({ profileId: "profile-a", ...item })),
    });
    expect(mocks.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createMany.mock.invocationCallOrder[0],
    );
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "CLINIC_IVR_PROFILE_UPDATED",
        targetType: "ClinicIvrProfile",
        targetId: "profile-a",
        afterValue: {
          clinicId: "clinic-a",
          changedFields: ["greetingTemplate", "language", "voice", "items"],
          menuItemCount: 2,
          enabledActions: ["TOMORROW_SLOTS", "CLINIC_INFORMATION"],
          digits: [1, 4],
        },
      }),
    );
    const auditJson = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditJson).not.toContain(input().greetingTemplate);
    expect(auditJson).not.toContain("tomorrow slots");
    expect(auditJson).not.toMatch(/phoneNumber|authToken|patient|webhook/i);
    expect(result).toMatchObject({ source: "custom", items: input().items });
  });

  it("does not write or audit a semantically identical PUT", async () => {
    mocks.findUnique.mockResolvedValueOnce(stored());
    const result = await replaceClinicIvrProfileForActor(
      ACTOR,
      "clinic-a",
      input(),
    );
    expect(result.source).toBe("custom");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("removes stale items before inserting the complete later profile", async () => {
    mocks.findUnique.mockResolvedValueOnce(
      stored({
        items: [
          ...input().items,
          {
            digit: 3,
            label: "urgent assistance",
            action: "URGENT_ASSISTANCE",
            position: 2,
            enabled: true,
          },
        ],
      }),
    );
    await replaceClinicIvrProfileForActor(ACTOR, "clinic-a", input());
    expect(mocks.deleteMany).toHaveBeenCalledOnce();
    expect(mocks.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("does not report success or audit when transactional item creation fails", async () => {
    mocks.findUnique.mockResolvedValueOnce(stored({ voice: "MAN" }));
    mocks.createMany.mockRejectedValueOnce(new Error("item write failed"));
    await expect(
      replaceClinicIvrProfileForActor(ACTOR, "clinic-a", input()),
    ).rejects.toThrow("item write failed");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("resets a custom profile transactionally without touching telephony config", async () => {
    mocks.findUnique.mockResolvedValueOnce(stored());
    const result = await resetClinicIvrProfileForActor(
      ACTOR,
      "clinic-a",
    );
    expect(mocks.deleteProfile).toHaveBeenCalledWith({
      where: { id: "profile-a" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "CLINIC_IVR_PROFILE_RESET",
        afterValue: {
          clinicId: "clinic-a",
          removedMenuItemCount: 2,
          enabledActions: ["TOMORROW_SLOTS", "CLINIC_INFORMATION"],
          digits: [1, 4],
        },
      }),
    );
    expect(result.source).toBe("default");
  });

  it("treats reset without a custom profile as a no-op", async () => {
    const result = await resetClinicIvrProfileForActor(ACTOR, "clinic-a");
    expect(result.source).toBe("default");
    expect(mocks.deleteProfile).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    [new PermissionError("clinic:edit"), PermissionError],
    [new ScopeError(), ScopeError],
  ])("does not query after authorization fails", async (error, ErrorType) => {
    mocks.authorize.mockRejectedValueOnce(error);
    await expect(
      getClinicIvrProfileForActor(ACTOR, "clinic-other"),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
