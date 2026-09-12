import type {
  ClinicCapacityPaymentStatus,
  ClinicCapacityRequestStatus,
} from "@prisma/client";

export const OPEN_CLINIC_CAPACITY_REQUEST_STATUSES = [
  "PENDING",
  "PAYMENT_PENDING",
  "PAYMENT_SUBMITTED",
  "UNDER_REVIEW",
] as const satisfies readonly ClinicCapacityRequestStatus[];

export function calculateClinicCapacity(input: {
  includedClinics: number;
  usedClinics: number;
  grants: readonly {
    quantity: number;
    status: "ACTIVE" | "REVOKED" | "EXPIRED";
    startsAt: Date;
    expiresAt: Date | null;
  }[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const activeGrantQuantity = input.grants.reduce((sum, grant) => {
    const active =
      grant.status === "ACTIVE" &&
      grant.startsAt <= now &&
      (grant.expiresAt === null || grant.expiresAt > now);
    return active ? sum + grant.quantity : sum;
  }, 0);
  const effectiveLimit = input.includedClinics + activeGrantQuantity;
  const remainingClinics = Math.max(effectiveLimit - input.usedClinics, 0);

  return {
    activeGrantQuantity,
    effectiveLimit,
    remainingClinics,
    isAtLimit: input.usedClinics >= effectiveLimit,
    isOverLimit: input.usedClinics > effectiveLimit,
  };
}

export function isOpenClinicCapacityRequest(
  status: ClinicCapacityRequestStatus,
): boolean {
  return OPEN_CLINIC_CAPACITY_REQUEST_STATUSES.includes(
    status as (typeof OPEN_CLINIC_CAPACITY_REQUEST_STATUSES)[number],
  );
}

export function canApprovePaidClinicCapacity(
  paymentStatus: ClinicCapacityPaymentStatus,
): boolean {
  return (
    paymentStatus === "CONFIRMED" ||
    paymentStatus === "WAIVED" ||
    paymentStatus === "NOT_REQUIRED"
  );
}

export function canSetClinicCapacityPaymentStatus(
  current: ClinicCapacityPaymentStatus,
  next: "CONFIRMED" | "WAIVED" | "FAILED",
): boolean {
  if (current === "CONFIRMED" || current === "WAIVED" || current === "NOT_REQUIRED") {
    return false;
  }
  return current !== next;
}

export function capacityStatus(input: {
  hasPlan: boolean;
  usedClinics: number;
  effectiveLimit: number;
}): "WITHIN_LIMIT" | "AT_LIMIT" | "OVER_LIMIT" | "NO_PLAN" {
  if (!input.hasPlan) return "NO_PLAN";
  if (input.usedClinics > input.effectiveLimit) return "OVER_LIMIT";
  if (input.usedClinics === input.effectiveLimit) return "AT_LIMIT";
  return "WITHIN_LIMIT";
}
