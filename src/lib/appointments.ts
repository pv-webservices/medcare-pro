import { z } from "zod";
import { clinicWhereForActor } from "@/lib/clinicScope";
import {
  formatDateOnly,
  isDateOnly,
  parseDateOnly,
  parseDateTime,
} from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  OCCUPYING_STATUSES,
  isAppointmentTypeUsableAt,
} from "@/lib/appointmentRules";
import {
  computeAppointmentSlots,
  type SlotOutcome,
  type SlotStatus,
} from "@/lib/appointmentSlots";

/**
 * Appointment data access — AP-2, READ SIDE ONLY.
 *
 * There is no booking, rescheduling, cancellation, check-in or conversion in
 * this file yet. AP-3 onwards add them, under the DoctorScheduleLock protocol
 * recorded in prisma/schema.prisma and proved by
 * scripts/verify-ap1-appointments-schema.mts.
 *
 * The division of labour, and the reason for it: lib/appointmentSlots.ts owns
 * every rule about what a slot is and whether it is free, and is pure. This
 * file owns authorisation and the four queries, and knows nothing about
 * remainders, half-open intervals or leave arithmetic. Neither half can quietly
 * disagree with the other because neither restates the other's rules.
 *
 * WHAT IS NEVER TRUSTED FROM THE CLIENT. `tenantId` is not accepted at all — it
 * comes from the session, as it does everywhere in this codebase. `clinicId`,
 * `doctorId` and `appointmentTypeId` ARE accepted, and every one of them is
 * re-derived against the session before it is used: the clinic against the
 * actor's own scope, the doctor against that clinic, the type against the
 * actor's tenant. Availability and booked state are never accepted from the
 * client in any form — they are read here and only here.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const appointmentSlotQuerySchema = z.object({
  clinicId: z.string().min(1, "Choose a clinic."),
  doctorId: z.string().min(1, "Choose a doctor."),
  appointmentTypeId: z.string().min(1, "Choose an appointment type."),
  date: z.string().refine(isDateOnly, "Choose a valid date."),
});

export type AppointmentSlotQuery = z.infer<typeof appointmentSlotQuerySchema>;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * One slot as it leaves the server.
 *
 * `start` and `end` are "HH:mm" wall-clock strings, not Dates and not instants:
 * a slot picker renders times, and shipping a Date would invite a browser to
 * apply its own timezone to a value this project deliberately never converts.
 *
 * There is no patient name, phone, address, age, gender, patient id, amount or
 * audit data here, and there must never be. `bookingId` is an opaque
 * appointment id, included so a frozen slot can be opened by someone who
 * already holds `appointment:read` in this clinic.
 */
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
  /** Why the list looks the way it does — see SlotOutcome. */
  outcome: SlotOutcome;
  slots: AppointmentSlotView[];
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * The slots a doctor has on one date for one appointment type.
 *
 * BOTH GATES ARE ENFORCED HERE, not only in the route: the `appointments`
 * feature entitlement (layers 1-3) and the `appointment:read` permission
 * (layer 4), plus the clinic scope. AP-3 to AP-6 will all reach appointments
 * through this file, so the gate sits at the library boundary where every
 * future caller inherits it, rather than being something each new route has to
 * remember. The route calls `requireModule` as well, matching every other gated
 * route in the app; the duplicate resolution is a handful of indexed reads on a
 * GET and is worth the consistency.
 *
 * Order matters. The feature check runs first, so someone whose organisation
 * does not have Appointments is told that, rather than being told they lack a
 * permission they may well hold.
 */
export async function getAppointmentSlots(
  actor: ActorContext,
  input: AppointmentSlotQuery,
): Promise<AppointmentSlotsResult> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  // Also proves the clinic belongs to the actor's tenant (404 if it does not),
  // and that the actor holds the permission in THAT clinic (403 if not) — the
  // same single call lib/registrations.ts uses for a clinic-scoped read.
  await requirePermission(actor, "appointment:read", input.clinicId);

  // Belt and braces over the line above: the clinic is intersected with the
  // actor's own scope so the doctor lookup itself cannot reach outside it.
  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:read",
    input.clinicId,
  );

  if (!clinicWhere) {
    throw new ScopeError();
  }

  // One query settles four things: the doctor exists, belongs to the REQUESTED
  // clinic, that clinic is in this tenant, and it is inside the actor's scope.
  // A doctor from a sibling clinic is a 404, not a 403 — naming it must not
  // confirm it exists.
  const doctor = await prisma.doctor.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, clinic: clinicWhere },
    select: { id: true, clinicId: true, name: true },
  });

  if (!doctor) {
    throw new ScopeError();
  }

  const appointmentType = await prisma.appointmentType.findFirst({
    // Tenant-scoped in the query itself, so another organisation's type is
    // never even loaded before being judged.
    where: { id: input.appointmentTypeId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      clinicId: true,
      name: true,
      durationMinutes: true,
      isActive: true,
    },
  });

  // Covers all three refusals in one predicate: wrong tenant, retired, or
  // clinic-specific to a DIFFERENT clinic. A type with a NULL clinicId is
  // tenant-wide and usable at every site.
  if (
    !appointmentType ||
    !isAppointmentTypeUsableAt(appointmentType, actor.tenantId, input.clinicId)
  ) {
    throw new ScopeError();
  }

  const date = parseDateOnly(input.date);
  // Half-open, like everything else: [00:00 today, 00:00 tomorrow). No slot can
  // span midnight — lib/appointmentRules.ts refuses one — so a day's window on
  // `slotStart` alone catches every appointment belonging to that day.
  const dayStart = parseDateTime(input.date, "00:00");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const [availability, leave, booked] = await Promise.all([
    // EXACTLY the requested date. Availability is explicit per calendar day in
    // this model; there is no recurring weekly schedule to fall back on, and
    // inferring one from a neighbouring date would invent clinic hours.
    prisma.doctorAvailability.findMany({
      where: { doctorId: doctor.id, date },
      orderBy: [{ startTime: "asc" }, { endTime: "asc" }],
      select: { date: true, startTime: true, endTime: true },
    }),
    // Both ends inclusive, matching how lib/doctors.ts reads the same rows.
    // `reason` is deliberately NOT selected: a slot picker needs to know the
    // doctor is away, never why, and this endpoint asks only for
    // `appointment:read` while the leave reason lives behind `doctor:read`.
    prisma.doctorLeave.findMany({
      where: { doctorId: doctor.id, startDate: { lte: date }, endDate: { gte: date } },
      select: { startDate: true, endDate: true },
    }),
    prisma.appointment.findMany({
      // BY DOCTOR, not by clinic. A doctor's time is occupied wherever the
      // appointment was filed; narrowing by clinicId as well would hide a row
      // whose denormalised clinic had drifted, and hiding a conflict is how a
      // double booking gets offered.
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
      // Formatted from the ROW, never substituted with the requested date. The
      // query already filters on the exact date, so these always agree — and
      // that is the point: passing `input.date` through would disarm the
      // engine's own wrong-date guard and hide the day a filter ever slipped.
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
    clinicId: doctor.clinicId,
    doctorId: doctor.id,
    doctorName: doctor.name,
    appointmentTypeId: appointmentType.id,
    appointmentTypeName: appointmentType.name,
    durationMinutes: appointmentType.durationMinutes,
    outcome: computed.outcome,
    // Mapped down rather than passed through: the pure Slot carries Dates and
    // the diagnostics carry raw availability rows, and neither belongs in a
    // response. This is the one place the public shape is decided.
    slots: computed.slots.map((slot) => ({
      start: slot.startTime,
      end: slot.endTime,
      status: slot.status,
      ...(slot.bookingId === undefined ? {} : { bookingId: slot.bookingId }),
    })),
  };
}

