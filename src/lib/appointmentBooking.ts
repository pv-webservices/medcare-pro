import { createHash } from "node:crypto";
import { AppointmentBookingSource, Prisma } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { parseSlotInstant } from "@/lib/appointmentInput";
import {
  appointmentTransaction,
  findOccupyingClash,
  isUniqueConstraintError,
  SLOT_TAKEN_MESSAGE,
  takeDoctorDayLocks,
} from "@/lib/appointmentLocks";
import {
  activeSlotStartForStatus,
  appointmentIntervalProblem,
  appointmentLockDate,
  isAppointmentTypeUsableAt,
  matchesDuration,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import { computeAppointmentSlots } from "@/lib/appointmentSlots";
import {
  formatClockTime,
  formatDateOnly,
  parseDateOnly,
} from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ScopeError } from "@/lib/rbac";

export interface AppointmentPatientSnapshot {
  name: string;
  mobileNumber: string;
  age?: number | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
}

export type AppointmentBookingProvenance =
  | {
      bookingSource: "STAFF";
      bookedById: string;
      bookingSourceRef: null;
      auditActorUserId: string;
    }
  | {
      bookingSource: "PHONE_IVR";
      bookedById: null;
      bookingSourceRef: string;
      auditActorUserId: null;
    };

export interface ScopedAppointmentBookingInput {
  tenantId: string;
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  patientId?: string | null;
  patientSnapshot: AppointmentPatientSnapshot;
  slotStart: string;
  slotEnd: string;
  provenance: AppointmentBookingProvenance;
}

export interface BookedAppointment {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  patientId: string | null;
  name: string;
  slotStart: string;
  slotEnd: string;
  startTime: string;
  endTime: string;
  date: string;
  status: AppointmentStatus;
  amount: string;
}

interface AppointmentRowForResult {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  patientId: string | null;
  name: string;
  slotStart: Date;
  slotEnd: Date;
  status: AppointmentStatus;
  amount: Prisma.Decimal;
}

const RESULT_SELECT = {
  id: true,
  clinicId: true,
  doctorId: true,
  appointmentTypeId: true,
  patientId: true,
  name: true,
  slotStart: true,
  slotEnd: true,
  status: true,
  amount: true,
} as const;

function toBookedAppointment(row: AppointmentRowForResult): BookedAppointment {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    appointmentTypeId: row.appointmentTypeId,
    patientId: row.patientId,
    name: row.name,
    slotStart: row.slotStart.toISOString(),
    slotEnd: row.slotEnd.toISOString(),
    startTime: formatClockTime(row.slotStart),
    endTime: formatClockTime(row.slotEnd),
    date: formatDateOnly(row.slotStart),
    status: row.status,
    amount: row.amount.toFixed(2),
  };
}

function blankToNull(value: string | undefined | null): string | null {
  return value === undefined || value === null || value.trim() === ""
    ? null
    : value.trim();
}

/**
 * Opaque, deterministic, and clinic-scoped. The raw provider identifier never
 * reaches appointment output or audit metadata.
 */
export function buildPhoneBookingSourceRef(
  clinicId: string,
  callUuid: string,
): string {
  const digest = createHash("sha256")
    .update(clinicId)
    .update("\0")
    .update(callUuid)
    .digest("hex");
  return `plivo:${digest}`;
}

async function findExistingPhoneBooking(input: {
  tenantId: string;
  clinicId: string;
  bookingSourceRef: string;
}): Promise<AppointmentRowForResult | null> {
  return prisma.appointment.findFirst({
    where: {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      bookingSource: AppointmentBookingSource.PHONE_IVR,
      bookingSourceRef: input.bookingSourceRef,
    },
    select: RESULT_SELECT,
  });
}

export async function getPhoneIvrAppointmentForCall(input: {
  tenantId: string;
  clinicId: string;
  callUuid: string;
}): Promise<BookedAppointment | null> {
  const bookingSourceRef = buildPhoneBookingSourceRef(
    input.clinicId,
    input.callUuid,
  );
  const existing = await findExistingPhoneBooking({
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    bookingSourceRef,
  });
  return existing ? toBookedAppointment(existing) : null;
}

/**
 * The single appointment booking implementation used by staff and PHONE_IVR.
 * It performs no human RBAC; callers must establish scope and provenance, and
 * this core independently re-proves every referenced entity before using the
 * shared DoctorScheduleLock protocol.
 */
export async function createAppointmentForScope(
  input: ScopedAppointmentBookingInput,
): Promise<BookedAppointment> {
  const provenance = input.provenance;
  if (
    provenance.bookingSource === "PHONE_IVR" &&
    provenance.bookingSourceRef.trim() === ""
  ) {
    throw new BadRequestError("A telephone booking reference is required.");
  }

  if (provenance.bookingSource === "PHONE_IVR") {
    const existing = await findExistingPhoneBooking({
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      bookingSourceRef: provenance.bookingSourceRef,
    });
    if (existing) return toBookedAppointment(existing);
  }

  const [doctor, appointmentType] = await Promise.all([
    prisma.doctor.findFirst({
      where: {
        id: input.doctorId,
        clinicId: input.clinicId,
        clinic: { tenantId: input.tenantId },
      },
      select: {
        id: true,
        clinicId: true,
        name: true,
        clinic: { select: { tenantId: true } },
      },
    }),
    prisma.appointmentType.findFirst({
      where: { id: input.appointmentTypeId, tenantId: input.tenantId },
      select: {
        id: true,
        tenantId: true,
        clinicId: true,
        name: true,
        durationMinutes: true,
        defaultAmount: true,
        isActive: true,
      },
    }),
  ]);

  if (!doctor) throw new ScopeError();
  if (
    !appointmentType ||
    !isAppointmentTypeUsableAt(
      appointmentType,
      input.tenantId,
      input.clinicId,
    )
  ) {
    throw new ScopeError();
  }

  let patientId = input.patientId ?? null;
  let snapshot = input.patientSnapshot;
  if (patientId !== null) {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
      },
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
    if (!patient) throw new ScopeError();

    // System bookings cannot accept demographic snapshot data from transport
    // state. Re-load it here even though the telephone wrapper already did.
    if (provenance.bookingSource === "PHONE_IVR") {
      patientId = patient.id;
      snapshot = patient;
    }
  } else if (provenance.bookingSource === "PHONE_IVR") {
    throw new ScopeError();
  }

  const slotStart = parseSlotInstant(input.slotStart);
  const slotEnd = parseSlotInstant(input.slotEnd);
  if (!slotStart || !slotEnd) {
    throw new BadRequestError("Choose a valid appointment time.");
  }
  const problem = appointmentIntervalProblem(slotStart, slotEnd);
  if (problem === "end-not-after-start") {
    throw new BadRequestError("The appointment must end after it starts.");
  }
  if (problem === "spans-two-days") {
    throw new BadRequestError("An appointment cannot run past midnight.");
  }
  if (problem) throw new BadRequestError("Choose a valid appointment time.");
  if (!matchesDuration(slotStart, slotEnd, appointmentType.durationMinutes)) {
    throw new BadRequestError(
      `A ${appointmentType.name} appointment is ${appointmentType.durationMinutes} minutes long.`,
    );
  }

  const date = formatDateOnly(slotStart);
  const status: AppointmentStatus = "SCHEDULED";
  const amount = appointmentType.defaultAmount.toFixed(2);

  try {
    const created = await appointmentTransaction(prisma, async (tx) => {
      await takeDoctorDayLocks(tx, [
        { doctorId: doctor.id, date: appointmentLockDate(slotStart) },
      ]);

      if (provenance.bookingSource === "PHONE_IVR") {
        const existing = await tx.appointment.findFirst({
          where: {
            tenantId: input.tenantId,
            clinicId: input.clinicId,
            bookingSource: AppointmentBookingSource.PHONE_IVR,
            bookingSourceRef: provenance.bookingSourceRef,
          },
          select: RESULT_SELECT,
        });
        if (existing) return existing;
      }

      const day = parseDateOnly(date);
      const [availability, leave] = await Promise.all([
        tx.doctorAvailability.findMany({
          where: { doctorId: doctor.id, date: day },
          select: { date: true, startTime: true, endTime: true },
        }),
        tx.doctorLeave.findMany({
          where: {
            doctorId: doctor.id,
            startDate: { lte: day },
            endDate: { gte: day },
          },
          select: { startDate: true, endDate: true },
        }),
      ]);

      const computed = computeAppointmentSlots({
        date,
        durationMinutes: appointmentType.durationMinutes,
        availability: availability.map((window) => ({
          date: formatDateOnly(window.date),
          startTime: window.startTime,
          endTime: window.endTime,
        })),
        leave: leave.map((range) => ({
          startDate: formatDateOnly(range.startDate),
          endDate: formatDateOnly(range.endDate),
        })),
        booked: [],
      });

      if (computed.outcome === "on-leave") {
        throw new ConflictError(
          `${doctor.name} is on leave on ${date}. Please choose another date.`,
        );
      }
      if (computed.outcome !== "ok") {
        throw new ConflictError(
          `${doctor.name} is not available on ${date}. Please choose another date.`,
        );
      }
      const offered = computed.slots.some(
        (slot) =>
          slot.start.getTime() === slotStart.getTime() &&
          slot.end.getTime() === slotEnd.getTime(),
      );
      if (!offered) {
        throw new BadRequestError(
          "That time is not one of this doctor's bookable slots.",
        );
      }

      if (
        await findOccupyingClash(tx, {
          doctorId: doctor.id,
          slotStart,
          slotEnd,
        })
      ) {
        throw new ConflictError(SLOT_TAKEN_MESSAGE);
      }

      const row = await tx.appointment.create({
        data: {
          tenantId: doctor.clinic.tenantId,
          clinicId: doctor.clinicId,
          doctorId: doctor.id,
          appointmentTypeId: appointmentType.id,
          patientId,
          name: snapshot.name.trim(),
          mobileNumber: snapshot.mobileNumber.trim(),
          age: snapshot.age ?? null,
          gender: blankToNull(snapshot.gender),
          address: blankToNull(snapshot.address),
          city: blankToNull(snapshot.city),
          amount,
          slotStart,
          slotEnd,
          activeSlotStart: activeSlotStartForStatus(status, slotStart),
          status,
          bookingSource: provenance.bookingSource,
          bookingSourceRef: provenance.bookingSourceRef,
          bookedById: provenance.bookedById,
        },
        select: RESULT_SELECT,
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
        targetType: "Appointment",
        targetId: row.id,
        actorUserId: provenance.auditActorUserId,
        actorTenantId: input.tenantId,
        afterValue: {
          clinicId: doctor.clinicId,
          doctorId: doctor.id,
          appointmentTypeId: appointmentType.id,
          date,
          startTime: formatClockTime(slotStart),
          endTime: formatClockTime(slotEnd),
          durationMinutes: appointmentType.durationMinutes,
          status,
          amount,
          existingPatient: patientId !== null,
          ...(provenance.bookingSource === "PHONE_IVR"
            ? { bookingSource: "PHONE_IVR" }
            : {}),
        },
      });

      return row;
    });

    return toBookedAppointment(created);
  } catch (error: unknown) {
    if (
      provenance.bookingSource === "PHONE_IVR" &&
      isUniqueConstraintError(error)
    ) {
      const existing = await findExistingPhoneBooking({
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        bookingSourceRef: provenance.bookingSourceRef,
      });
      if (existing) return toBookedAppointment(existing);
    }
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(SLOT_TAKEN_MESSAGE);
    }
    throw error;
  }
}
