import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.authorize,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicBusinessHours: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAuditLog: mocks.writeAuditLog };
});

import { ScopeError } from "@/lib/rbac";
import {
  CLINIC_BUSINESS_WEEKDAYS,
  getClinicBusinessHoursForActor,
  updateClinicBusinessHoursForActor,
  updateClinicBusinessHoursSchema,
} from "@/lib/telephony/businessHours";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };

function input() {
  return updateClinicBusinessHoursSchema.parse({
    hours: CLINIC_BUSINESS_WEEKDAYS.map((dayOfWeek) =>
      dayOfWeek === "MONDAY"
        ? {
            dayOfWeek,
            isClosed: false,
            openTime: "09:00",
            closeTime: "17:00",
          }
        : { dayOfWeek, isClosed: true },
    ),
  });
}

describe("clinic business-hours domain authorization and writes", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.authorize.mockResolvedValue(undefined);
    mocks.findMany.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({ clinicBusinessHours: { upsert: mocks.upsert } }),
    );
  });

  it("authorizes GET and returns seven closed defaults without writing", async () => {
    const result = await getClinicBusinessHoursForActor(ACTOR, "clinic-a");
    expect(mocks.authorize).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(result.hours).toHaveLength(7);
    expect(result.hours.every((day) => day.isClosed)).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not query hours after non-enumerable scope authorization fails", async () => {
    mocks.authorize.mockRejectedValueOnce(new ScopeError());
    await expect(
      getClinicBusinessHoursForActor(ACTOR, "clinic-other"),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("atomically upserts all seven days and audits changed weekdays only", async () => {
    const result = await updateClinicBusinessHoursForActor(
      ACTOR,
      "clinic-a",
      input(),
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(7);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "CLINIC_TELEPHONY_HOURS_UPDATED",
        targetId: "clinic-a",
        afterValue: {
          clinicId: "clinic-a",
          changedWeekdays: CLINIC_BUSINESS_WEEKDAYS,
        },
      }),
    );
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(
      /phone|\+91/i,
    );
    expect(result.hours[0]).toMatchObject({
      dayOfWeek: "MONDAY",
      isClosed: false,
    });
  });

  it("does not write or audit a semantically unchanged schedule", async () => {
    mocks.findMany.mockResolvedValue(input().hours);
    await updateClinicBusinessHoursForActor(ACTOR, "clinic-a", input());
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not report success when an atomic weekday write fails", async () => {
    mocks.upsert.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      updateClinicBusinessHoursForActor(ACTOR, "clinic-a", input()),
    ).rejects.toThrow("database unavailable");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
