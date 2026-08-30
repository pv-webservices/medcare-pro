import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelephonyBookingRequestReason } from "@prisma/client";

const db = vi.hoisted(() => ({
  patientFindMany: vi.fn(),
  clinicFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  requestFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findMany: db.patientFindMany },
    clinic: { findFirst: db.clinicFindFirst },
    telephonyBookingRequest: {
      create: db.requestCreate,
      findUnique: db.requestFindUnique,
    },
  },
}));

vi.mock("@/lib/appointmentLocks", () => ({
  isUniqueConstraintError: (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "P2002",
}));

import {
  createTelephonyBookingRequest,
  normalizePlivoCallUuid,
  resolveTelephonePatient,
} from "@/lib/telephony/bookingIdentity";
import {
  normalizePlivoCallerNumber,
  patientMobileRepresentations,
} from "@/lib/telephony/phoneNumber";

const clinic = { tenantId: "tenant-a", clinicId: "clinic-a" };
const patient = {
  id: "patient-a",
  name: "Sensitive Name",
  mobileNumber: "9876543210",
  age: 40,
  gender: "Female",
  address: "Sensitive address",
  city: "Pune",
};

describe("telephone patient resolution", () => {
  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
    db.patientFindMany.mockResolvedValue([]);
  });

  it.each([
    ["+919876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
  ])("normalizes provider caller %s", (value, expected) => {
    expect(normalizePlivoCallerNumber(value)).toBe(expected);
  });

  it.each(["9876543210", "not-a-number", "+12025550123"])(
    "does not guess a patient representation for %s",
    (value) => {
      const canonical = normalizePlivoCallerNumber(value);
      expect(canonical ? patientMobileRepresentations(canonical) : []).toEqual([]);
    },
  );

  it("queries only the finite Indian representations inside tenant and clinic", async () => {
    db.patientFindMany.mockResolvedValueOnce([patient]);
    const result = await resolveTelephonePatient({ clinic, from: "+919876543210" });

    expect(result).toMatchObject({ kind: "one", patient: { id: "patient-a" } });
    expect(db.patientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          clinicId: "clinic-a",
          mobileNumber: { in: ["+919876543210", "9876543210"] },
        },
        take: 2,
      }),
    );
  });

  it("distinguishes zero, one, and two-or-more without findFirst", async () => {
    await expect(resolveTelephonePatient({ clinic, from: "+919876543210" }))
      .resolves.toMatchObject({ kind: "none" });
    db.patientFindMany.mockResolvedValueOnce([patient]);
    await expect(resolveTelephonePatient({ clinic, from: "+919876543210" }))
      .resolves.toMatchObject({ kind: "one" });
    db.patientFindMany.mockResolvedValueOnce([patient, { ...patient, id: "patient-b" }]);
    await expect(resolveTelephonePatient({ clinic, from: "+919876543210" }))
      .resolves.toMatchObject({ kind: "ambiguous" });
  });

  it("treats malformed and non-India From as no safe match without a DB scan", async () => {
    await expect(resolveTelephonePatient({ clinic, from: "9876543210" }))
      .resolves.toMatchObject({ kind: "none" });
    await expect(resolveTelephonePatient({ clinic, from: "+12025550123" }))
      .resolves.toMatchObject({ kind: "none" });
    expect(db.patientFindMany).not.toHaveBeenCalled();
  });
});

describe("telephone callback request idempotency", () => {
  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
    db.clinicFindFirst.mockResolvedValue({ id: "clinic-a" });
  });

  it.each([undefined, "", "short", "bad uuid with spaces"])(
    "rejects malformed CallUUID %j before writing",
    async (callUuid) => {
      expect(normalizePlivoCallUuid(callUuid)).toBeNull();
      await expect(
        createTelephonyBookingRequest({
          clinic,
          callUuid: String(callUuid ?? ""),
          callerNumber: "+919876543210",
          reason: TelephonyBookingRequestReason.NO_PATIENT_MATCH,
        }),
      ).rejects.toThrow();
      expect(db.requestCreate).not.toHaveBeenCalled();
    },
  );

  it("returns the scoped existing request when a concurrent insert wins", async () => {
    const existing = {
      id: "request-a",
      reason: TelephonyBookingRequestReason.NO_PATIENT_MATCH,
      status: "PENDING",
    };
    db.requestCreate.mockRejectedValueOnce({ code: "P2002" });
    db.requestFindUnique.mockResolvedValueOnce(existing);

    await expect(
      createTelephonyBookingRequest({
        clinic,
        callUuid: "call-uuid-123456",
        callerNumber: "+919876543210",
        reason: TelephonyBookingRequestReason.USER_REQUESTED,
      }),
    ).resolves.toEqual(existing);
    expect(db.requestFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clinicId_provider_providerCallId: {
            clinicId: "clinic-a",
            provider: "PLIVO",
            providerCallId: "call-uuid-123456",
          },
        },
      }),
    );
  });
});
