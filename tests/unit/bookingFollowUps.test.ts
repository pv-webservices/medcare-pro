import {
  TelephonyBookingRequestReason,
  TelephonyBookingRequestStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    telephonyBookingRequest: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    moduleLock: vi.fn(),
    requireModule: vi.fn(),
    accessibleScopes: vi.fn(),
    assertClinic: vi.fn(),
    requirePermission: vi.fn(),
    clinicFindMany: vi.fn(),
    followUpFindMany: vi.fn(),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    writeAuditLog: vi.fn(),
    ScopeError: class ScopeError extends Error {},
    ConflictError: class ConflictError extends Error {},
    tx,
  };
});

vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { ivr: "ivr", appointments: "appointments" },
  moduleLock: mocks.moduleLock,
  requireModule: mocks.requireModule,
}));
vi.mock("@/lib/rbac", () => ({
  ScopeError: mocks.ScopeError,
  accessibleClinicScopes: mocks.accessibleScopes,
  assertClinicInTenant: mocks.assertClinic,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TELEPHONY_BOOKING_FOLLOW_UP_RESOLVED:
      "TELEPHONY_BOOKING_FOLLOW_UP_RESOLVED",
  },
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/apiHandler", () => ({
  ConflictError: mocks.ConflictError,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findMany: mocks.clinicFindMany },
    telephonyBookingRequest: { findMany: mocks.followUpFindMany },
    $transaction: mocks.transaction,
  },
}));

import {
  getBookingFollowUpsForActor,
  resolveTelephonyBookingFollowUpForActor,
} from "@/lib/telephony/bookingFollowUps";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };
const CLINICS = [
  { id: "clinic-a", name: "Sharma Clinic" },
  { id: "clinic-b", name: "North Clinic" },
];

type TestClinicScope =
  | { scope: "all" }
  | { scope: "clinics"; clinicIds: readonly string[] }
  | { scope: "none" };

function scopes(
  dashboard: TestClinicScope,
  booking: TestClinicScope,
): ReadonlyMap<string, TestClinicScope> {
  return new Map([
    ["dashboard:view", dashboard],
    ["appointment:create", booking],
  ]);
}

describe("shared booking follow-ups", () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    }
    mocks.tx.telephonyBookingRequest.findFirst.mockReset();
    mocks.tx.telephonyBookingRequest.updateMany.mockReset();
    mocks.moduleLock.mockResolvedValue(null);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.assertClinic.mockResolvedValue(undefined);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.clinicFindMany.mockResolvedValue(CLINICS);
    mocks.accessibleScopes.mockResolvedValue(
      scopes({ scope: "all" }, { scope: "clinics", clinicIds: ["clinic-a"] }),
    );
    mocks.followUpFindMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
  });

  it("queries only pending requests in the tenant and authorised clinic scope", async () => {
    mocks.followUpFindMany.mockResolvedValue([{
      id: "request-a",
      clinicId: "clinic-a",
      callerNumber: "+919876543210",
      reason: TelephonyBookingRequestReason.NO_PATIENT_MATCH,
      status: TelephonyBookingRequestStatus.PENDING,
      createdAt: new Date("2026-09-05T08:00:00.000Z"),
      clinic: { name: "Sharma Clinic" },
    }]);

    const model = await getBookingFollowUpsForActor(ACTOR, null);
    expect(mocks.followUpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          clinicId: { in: ["clinic-a"] },
          status: TelephonyBookingRequestStatus.PENDING,
        },
      }),
    );
    const query = mocks.followUpFindMany.mock.calls[0][0];
    expect(query.select).toEqual({
      id: true,
      clinicId: true,
      callerNumber: true,
      reason: true,
      status: true,
      createdAt: true,
      clinic: { select: { name: true } },
    });
    expect(model?.items[0]).toEqual({
      id: "request-a",
      clinicId: "clinic-a",
      clinicName: "Sharma Clinic",
      callerNumber: "+919876543210",
      reason: TelephonyBookingRequestReason.NO_PATIENT_MATCH,
      reasonLabel: "No matching patient found",
      status: "PENDING",
      createdAt: "2026-09-05T08:00:00.000Z",
    });
    expect(JSON.stringify(model)).not.toMatch(
      /providerCallId|providerCallUuid|authToken|Digits|raw|payload|candidate/i,
    );
  });

  it("uses appointment authority only and cannot widen a clinic selection", async () => {
    expect(
      await getBookingFollowUpsForActor(ACTOR, "clinic-b"),
    ).toBeNull();
    expect(mocks.accessibleScopes).toHaveBeenCalledWith(ACTOR, [
      "appointment:create",
    ]);
    expect(mocks.followUpFindMany).not.toHaveBeenCalled();
  });

  it("marks only an in-scope pending request resolved and audits no phone data", async () => {
    mocks.tx.telephonyBookingRequest.findFirst.mockResolvedValue({
      id: "request-a",
      status: TelephonyBookingRequestStatus.PENDING,
    });
    mocks.tx.telephonyBookingRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      resolveTelephonyBookingFollowUpForActor(
        ACTOR,
        "clinic-a",
        "request-a",
      ),
    ).resolves.toEqual({ id: "request-a", status: "RESOLVED" });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      ACTOR,
      "appointment:create",
      "clinic-a",
    );
    expect(mocks.tx.telephonyBookingRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "request-a",
        tenantId: "tenant-a",
        clinicId: "clinic-a",
        status: TelephonyBookingRequestStatus.PENDING,
      },
      data: { status: TelephonyBookingRequestStatus.RESOLVED },
    });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain(
      "+919876543210",
    );
  });

  it("cannot mutate a guessed request from another tenant or clinic", async () => {
    mocks.tx.telephonyBookingRequest.findFirst.mockResolvedValue(null);
    await expect(
      resolveTelephonyBookingFollowUpForActor(
        ACTOR,
        "clinic-a",
        "tenant-b-request",
      ),
    ).rejects.toBeInstanceOf(mocks.ScopeError);
    expect(mocks.tx.telephonyBookingRequest.findFirst).toHaveBeenCalledWith({
      where: {
        id: "tenant-b-request",
        tenantId: "tenant-a",
        clinicId: "clinic-a",
      },
      select: { id: true, status: true },
    });
    expect(mocks.tx.telephonyBookingRequest.updateMany).not.toHaveBeenCalled();
  });

  it("treats an already resolved request as an idempotent success", async () => {
    mocks.tx.telephonyBookingRequest.findFirst.mockResolvedValue({
      id: "request-a",
      status: TelephonyBookingRequestStatus.RESOLVED,
    });
    await expect(
      resolveTelephonyBookingFollowUpForActor(
        ACTOR,
        "clinic-a",
        "request-a",
      ),
    ).resolves.toEqual({ id: "request-a", status: "RESOLVED" });
    expect(mocks.tx.telephonyBookingRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
