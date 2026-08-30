import {
  TelephonyBookingRequestReason,
  TelephonyBookingRequestStatus,
} from "@prisma/client";
import { isUniqueConstraintError } from "@/lib/appointmentLocks";
import { prisma } from "@/lib/prisma";
import {
  normalizePlivoCallerNumber,
  patientMobileRepresentations,
} from "@/lib/telephony/phoneNumber";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";

export const PLIVO_PROVIDER = "PLIVO";

export interface TelephonePatient {
  id: string;
  name: string;
  mobileNumber: string;
  age: number | null;
  gender: string | null;
  address: string | null;
  city: string | null;
}

export type TelephonePatientResolution =
  | { kind: "none"; callerNumber: string | null }
  | { kind: "ambiguous"; callerNumber: string }
  | { kind: "one"; callerNumber: string; patient: TelephonePatient };

export function normalizePlivoCallUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/.test(normalized)
    ? normalized
    : null;
}

/** Resolve against the already-established tenant and clinic, never globally. */
export async function resolveTelephonePatient(input: {
  clinic: Pick<InboundClinicContext, "tenantId" | "clinicId">;
  from: unknown;
}): Promise<TelephonePatientResolution> {
  const callerNumber = normalizePlivoCallerNumber(input.from);
  if (!callerNumber) return { kind: "none", callerNumber: null };
  const representations = patientMobileRepresentations(callerNumber);
  if (representations.length === 0) {
    return { kind: "none", callerNumber };
  }

  const matches = await prisma.patient.findMany({
    where: {
      tenantId: input.clinic.tenantId,
      clinicId: input.clinic.clinicId,
      mobileNumber: { in: [...representations] },
    },
    orderBy: { id: "asc" },
    take: 2,
    select: {
      id: true,
      name: true,
      mobileNumber: true,
      age: true,
      gender: true,
      address: true,
      city: true,
    },
  });
  if (matches.length === 0) return { kind: "none", callerNumber };
  if (matches.length > 1) return { kind: "ambiguous", callerNumber };
  return { kind: "one", callerNumber, patient: matches[0] };
}

export interface TelephonyBookingRequestView {
  id: string;
  reason: TelephonyBookingRequestReason;
  status: TelephonyBookingRequestStatus;
}

/** Idempotent callback request creation; it never creates patients or registrations. */
export async function createTelephonyBookingRequest(input: {
  clinic: Pick<InboundClinicContext, "tenantId" | "clinicId">;
  callUuid: string;
  callerNumber: string | null;
  reason: TelephonyBookingRequestReason;
}): Promise<TelephonyBookingRequestView> {
  const callUuid = normalizePlivoCallUuid(input.callUuid);
  if (!callUuid) throw new Error("A valid provider call identifier is required.");

  const clinic = await prisma.clinic.findFirst({
    where: { id: input.clinic.clinicId, tenantId: input.clinic.tenantId },
    select: { id: true },
  });
  if (!clinic) throw new Error("The inbound clinic scope is no longer valid.");

  const unique = {
    clinicId_provider_providerCallId: {
      clinicId: clinic.id,
      provider: PLIVO_PROVIDER,
      providerCallId: callUuid,
    },
  } as const;
  try {
    return await prisma.telephonyBookingRequest.create({
      data: {
        tenantId: input.clinic.tenantId,
        clinicId: clinic.id,
        provider: PLIVO_PROVIDER,
        providerCallId: callUuid,
        callerNumber: input.callerNumber,
        reason: input.reason,
      },
      select: { id: true, reason: true, status: true },
    });
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await prisma.telephonyBookingRequest.findUnique({
      where: unique,
      select: { id: true, reason: true, status: true },
    });
    if (!existing) throw error;
    return existing;
  }
}

export function callbackReasonForResolution(
  resolution: Exclude<TelephonePatientResolution, { kind: "one" }>,
): TelephonyBookingRequestReason {
  return resolution.kind === "ambiguous"
    ? TelephonyBookingRequestReason.AMBIGUOUS_PATIENT_MATCH
    : TelephonyBookingRequestReason.NO_PATIENT_MATCH;
}
