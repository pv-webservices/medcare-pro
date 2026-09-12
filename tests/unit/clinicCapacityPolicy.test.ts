import { describe, expect, it } from "vitest";
import {
  calculateClinicCapacity,
  canApprovePaidClinicCapacity,
  canSetClinicCapacityPaymentStatus,
  capacityStatus,
  isOpenClinicCapacityRequest,
} from "@/lib/clinicCapacityPolicy";

const now = new Date("2026-09-12T12:00:00.000Z");
const grant = (overrides: Partial<{ quantity: number; status: "ACTIVE" | "REVOKED" | "EXPIRED"; startsAt: Date; expiresAt: Date | null }> = {}) => ({
  quantity: 1,
  status: "ACTIVE" as const,
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  expiresAt: null,
  ...overrides,
});

describe("clinic capacity policy", () => {
  it.each([
    [2, 0, [], 2, 2, false],
    [2, 1, [], 2, 1, false],
    [2, 2, [], 2, 0, true],
    [2, 2, [grant()], 3, 1, false],
    [2, 3, [grant()], 3, 0, true],
  ])("calculates plan + active grants for the required matrix", (includedClinics, usedClinics, grants, effectiveLimit, remainingClinics, isAtLimit) => {
    expect(calculateClinicCapacity({ includedClinics, usedClinics, grants, now })).toMatchObject({ effectiveLimit, remainingClinics, isAtLimit });
  });

  it("excludes expired, revoked, and future grants", () => {
    const result = calculateClinicCapacity({
      includedClinics: 2,
      usedClinics: 2,
      now,
      grants: [
        grant({ status: "EXPIRED" }),
        grant({ status: "REVOKED" }),
        grant({ expiresAt: new Date("2026-09-12T11:59:59.000Z") }),
        grant({ startsAt: new Date("2026-09-13T00:00:00.000Z") }),
      ],
    });
    expect(result).toMatchObject({ activeGrantQuantity: 0, effectiveLimit: 2, remainingClinics: 0, isAtLimit: true });
  });

  it("marks historical usage over limit without changing the used count", () => {
    const result = calculateClinicCapacity({ includedClinics: 2, usedClinics: 4, grants: [], now });
    expect(result).toMatchObject({ effectiveLimit: 2, remainingClinics: 0, isAtLimit: true, isOverLimit: true });
    expect(capacityStatus({ hasPlan: true, usedClinics: 4, effectiveLimit: 2 })).toBe("OVER_LIMIT");
  });

  it("reports planless tenants explicitly", () => {
    expect(capacityStatus({ hasPlan: false, usedClinics: 4, effectiveLimit: 0 })).toBe("NO_PLAN");
  });

  it("keeps only non-terminal requests open", () => {
    for (const status of ["PENDING", "PAYMENT_PENDING", "PAYMENT_SUBMITTED", "UNDER_REVIEW"] as const) {
      expect(isOpenClinicCapacityRequest(status)).toBe(true);
    }
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(isOpenClinicCapacityRequest(status)).toBe(false);
    }
  });

  it("never treats a submitted reference as confirmed payment", () => {
    expect(canApprovePaidClinicCapacity("SUBMITTED")).toBe(false);
    expect(canApprovePaidClinicCapacity("PENDING")).toBe(false);
    expect(canApprovePaidClinicCapacity("CONFIRMED")).toBe(true);
    expect(canApprovePaidClinicCapacity("WAIVED")).toBe(true);
    expect(canApprovePaidClinicCapacity("NOT_REQUIRED")).toBe(true);
  });

  it("makes confirmed and waived payment decisions final", () => {
    expect(canSetClinicCapacityPaymentStatus("SUBMITTED", "CONFIRMED")).toBe(true);
    expect(canSetClinicCapacityPaymentStatus("FAILED", "WAIVED")).toBe(true);
    expect(canSetClinicCapacityPaymentStatus("CONFIRMED", "WAIVED")).toBe(false);
    expect(canSetClinicCapacityPaymentStatus("WAIVED", "CONFIRMED")).toBe(false);
    expect(canSetClinicCapacityPaymentStatus("FAILED", "FAILED")).toBe(false);
  });
});
