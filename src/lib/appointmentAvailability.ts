import { ScopeError } from "@/lib/rbac";
import {
  isAppointmentTypeUsableAt,
  OCCUPYING_STATUSES,
} from "@/lib/appointmentRules";
import {
  computeAppointmentSlots,
  type SlotOutcome,
  type SlotStatus,
} from "@/lib/appointmentSlots";
import {
  formatDateOnly,
  parseDateOnly,
  parseDateTime,
} from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export interface AppointmentSlotView {
  start: string;
  end: string;
  status: SlotStatus;
  bookingId?: string;
}

export interface AppointmentSlotsResult {
  date: string;
  clinicId: string;
  doctorId: string;
  doctorName: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  durationMinutes: number;
  outcome: SlotOutcome;
  slots: AppointmentSlotView[];
}

export interface AppointmentAvailabilityScope {
  tenantId: string;
  clinicId: string;
}

export interface AppointmentDoctorOption {
  id: string;
  name: string;
  department: string;
}

export interface AppointmentTypeOption {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface ScopedAppointmentAvailabilityInput
  extends AppointmentAvailabilityScope {
  doctorId: string;
  appointmentTypeId: string;
  date: string;
}

/**
 * Minimal read model for a system channel that already established tenant and
 * clinic scope. The relation predicate proves both pieces of scope in the same
 * query; a sibling-clinic or cross-tenant id is indistinguishable from missing.
 */
export async function getAppointmentDoctorForScope(
  input: AppointmentAvailabilityScope & { doctorId: string },
): Promise<AppointmentDoctorOption | null> {
  return prisma.doctor.findFirst({
    where: {
      id: input.doctorId,
      clinicId: input.clinicId,
      clinic: { tenantId: input.tenantId },
    },
    select: { id: true, name: true, department: true },
  });
}

export async function listAppointmentDoctorsForClinic(
  input: AppointmentAvailabilityScope,
): Promise<AppointmentDoctorOption[]> {
  return prisma.doctor.findMany({
    where: {
      clinicId: input.clinicId,
      clinic: { tenantId: input.tenantId },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, department: true },
  });
}

export async function getAppointmentTypeForScope(
  input: AppointmentAvailabilityScope & { appointmentTypeId: string },
): Promise<AppointmentTypeOption | null> {
  const appointmentType = await prisma.appointmentType.findFirst({
    where: { id: input.appointmentTypeId, tenantId: input.tenantId },
    select: {
      id: true,
      tenantId: true,
      clinicId: true,
      name: true,
      durationMinutes: true,
      isActive: true,
    },
  });

  if (
    !appointmentType ||
    !isAppointmentTypeUsableAt(
      appointmentType,
      input.tenantId,
      input.clinicId,
    )
  ) {
    return null;
  }

  return {
    id: appointmentType.id,
    name: appointmentType.name,
    durationMinutes: appointmentType.durationMinutes,
  };
}

export async function listAppointmentTypesForClinic(
  input: AppointmentAvailabilityScope,
): Promise<AppointmentTypeOption[]> {
  return prisma.appointmentType.findMany({
    where: {
      tenantId: input.tenantId,
      isActive: true,
      OR: [{ clinicId: null }, { clinicId: input.clinicId }],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, durationMinutes: true },
  });
}

/**
 * Trusted appointment availability read core.
 *
 * This does not perform human RBAC. It accepts scope only from a caller that
 * has already established it, then re-proves every requested entity inside
 * that scope before loading the exact-date schedule and invoking the same pure
 * slot engine used by the authenticated UI.
 */
export async function getAppointmentSlotsForScope(
  input: ScopedAppointmentAvailabilityInput,
): Promise<AppointmentSlotsResult> {
  const [doctor, appointmentType] = await Promise.all([
    getAppointmentDoctorForScope(input),
    getAppointmentTypeForScope(input),
  ]);

  if (!doctor || !appointmentType) {
    throw new ScopeError();
  }

  const date = parseDateOnly(input.date);
  const dayStart = parseDateTime(input.date, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const [availability, leave, booked] = await Promise.all([
    prisma.doctorAvailability.findMany({
      where: { doctorId: doctor.id, date },
      orderBy: [{ startTime: "asc" }, { endTime: "asc" }],
      select: { date: true, startTime: true, endTime: true },
    }),
    prisma.doctorLeave.findMany({
      where: {
        doctorId: doctor.id,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { startDate: true, endDate: true },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        status: { in: [...OCCUPYING_STATUSES] },
        slotStart: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, slotStart: true, slotEnd: true, status: true },
    }),
  ]);

  const computed = computeAppointmentSlots({
    date: input.date,
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
    booked: booked.map((appointment) => ({
      id: appointment.id,
      start: appointment.slotStart,
      end: appointment.slotEnd,
      status: appointment.status,
    })),
  });

  return {
    date: input.date,
    clinicId: input.clinicId,
    doctorId: doctor.id,
    doctorName: doctor.name,
    appointmentTypeId: appointmentType.id,
    appointmentTypeName: appointmentType.name,
    durationMinutes: appointmentType.durationMinutes,
    outcome: computed.outcome,
    slots: computed.slots.map((slot) => ({
      start: slot.startTime,
      end: slot.endTime,
      status: slot.status,
      ...(slot.bookingId === undefined ? {} : { bookingId: slot.bookingId }),
    })),
  };
}
