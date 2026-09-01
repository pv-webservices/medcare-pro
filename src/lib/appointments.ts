import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  resolveListStatuses,
  type AppointmentFilters,
  type AppointmentIndicatorsQuery,
  type CreateAppointmentInput,
} from "@/lib/appointmentInput";
import {
  createAppointmentForScope,
  type BookedAppointment,
} from "@/lib/appointmentBooking";
import { notifyAppointmentBookedById } from "@/lib/appointmentNotifications";
import { clinicWhereForActor } from "@/lib/clinicScope";
import {
  formatClockTime,
  formatDateOnly,
  isDateOnly,
  nowClockTime,
  parseDateTime,
  todayDateOnly,
} from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  getAppointmentSlotsForScope,
  type AppointmentSlotsResult,
} from "@/lib/appointmentAvailability";

/**
 * Appointment data access — AP-2, READ SIDE ONLY.
 *
 * This file books and lists. It does NOT move, retire or convert: AP-4's
 * lifecycle lives in lib/appointmentLifecycle.ts and lib/appointmentReschedule.ts,
 * and AP-5's conversion will live in its own module too. All of them run the
 * same DoctorScheduleLock protocol, which AP-4 extracted into
 * lib/appointmentLocks.ts so the five paths share one implementation of it
 * rather than five copies.
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
 *
 * AP-3 adds booking and the board below. The input schemas live in
 * lib/appointmentInput.ts, which is pure, and are re-exported here so routes
 * import them from the domain module they already use.
 */

export {
  appointmentFilterSchema,
  appointmentIndicatorsQuerySchema,
  createAppointmentSchema,
  resolveListStatuses,
  type AppointmentFilters,
  type AppointmentIndicatorsQuery,
  type CreateAppointmentInput,
} from "@/lib/appointmentInput";

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
export type {
  AppointmentSlotView,
  AppointmentSlotsResult,
} from "@/lib/appointmentAvailability";
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

  return getAppointmentSlotsForScope({
    tenantId: actor.tenantId,
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    appointmentTypeId: input.appointmentTypeId,
    date: input.date,
  });
}


// ===========================================================================
// AP-3 — BOOKING
// ===========================================================================


export type { BookedAppointment } from "@/lib/appointmentBooking";

/**
 * Books a patient into a doctor's free slot — AP-3.
 *
 * There is no reschedule, cancel, check-in or no-show here — AP-4 put those in
 * lib/appointmentLifecycle.ts and lib/appointmentReschedule.ts — and no
 * conversion, which is AP-5.
 *
 * THE SHAPE OF THIS FUNCTION IS THE SAFETY ARGUMENT. Everything that can be
 * validated without a lock is validated before the transaction opens, so the
 * lock is held as briefly as possible; everything another transaction could
 * change underneath us is re-read INSIDE it, after the lock. An ordinary
 * pre-check followed by an insert would be a double booking waiting for two
 * receptionists to click at once, which is precisely what DoctorScheduleLock
 * exists to prevent.
 */
export async function createAppointment(
  actor: ActorContext,
  input: CreateAppointmentInput,
): Promise<BookedAppointment> {
  await requireModule(actor, MODULE_FEATURES.appointments);
  await requirePermission(actor, "appointment:create", input.clinicId);
  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:create",
    input.clinicId,
  );

  if (!clinicWhere) {
    throw new ScopeError();
  }
  const created = await createAppointmentForScope({
    tenantId: actor.tenantId,
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    appointmentTypeId: input.appointmentTypeId,
    patientId: input.patientId,
    patientSnapshot: {
      name: input.name,
      mobileNumber: input.mobileNumber,
      age: input.age,
      gender: input.gender,
      address: input.address,
      city: input.city,
    },
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    provenance: {
      bookingSource: "STAFF",
      bookingSourceRef: null,
      bookedById: actor.userId,
      auditActorUserId: actor.userId,
    },
  });

  // Convenience notifications remain staff-attributed. PHONE_IVR deliberately
  // has no fabricated user actor and does not pass through this wrapper.
  await notifyAppointmentBookedById(actor, created.id);
  return created;
}

// ===========================================================================
// AP-3 — THE LIST
// ===========================================================================


/** Matches lib/registrations.ts, so both lists page identically. */
const PAGE_SIZE = 25;

/**
 * One appointment as the board sees it.
 *
 * `mobileNumber` is here because a front desk whose 09:30 has not arrived needs
 * to ring them, and that is the whole job of this screen. Address, city, age and
 * gender are NOT: they belong to registration, and an appointment board has no
 * use for them. Nor is there a patient code — booking never mints one — any
 * medical information, or any audit metadata.
 */
export interface AppointmentListItem {
  id: string;
  clinicId: string;
  clinicName: string;
  doctorId: string;
  doctorName: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  patientId: string | null;
  name: string;
  mobileNumber: string;
  amount: string;
  /** Split for display, each derived from one stored instant. */
  date: string;
  startTime: string;
  endTime: string;
  slotStart: string;
  slotEnd: string;
  status: AppointmentStatus;
  createdAt: string;
}

export interface AppointmentListResult {
  rows: AppointmentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The appointment board, filtered and paged — AP-3.
 *
 * Every filter is a FILTER, not an authorisation: `clinicId` and `doctorId` are
 * intersected with the caller's own scope, so naming a clinic or a doctor they
 * cannot reach returns nothing rather than widening the result.
 */
export async function listAppointments(
  actor: ActorContext,
  filters: AppointmentFilters = {},
): Promise<AppointmentListResult> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const page = filters.page ?? 1;

  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:read",
    filters.clinicId,
  );

  // Reaches no clinic at all — an empty board, not an error. Matches how
  // lib/registrations.ts answers the same situation.
  if (!clinicWhere) {
    return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  const statuses = resolveListStatuses(filters);

  const where: Prisma.AppointmentWhereInput = {
    // Belt and braces: the tenant is filtered on the appointment's own
    // denormalised column AND through the clinic relation.
    tenantId: actor.tenantId,
    clinic: clinicWhere,
    status: { in: [...statuses] },
    ...(filters.doctorId?.trim()
      ? // Scoped by the clinic relation above, so a doctor id from another
        // tenant matches nothing rather than leaking their diary.
        { doctorId: filters.doctorId.trim() }
      : {}),
    ...slotWindowFilter(filters),
  };

  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      // Deterministic: id breaks the tie, so two appointments starting in the
      // same minute cannot swap places between pages.
      orderBy: [{ slotStart: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        appointmentTypeId: true,
        patientId: true,
        name: true,
        mobileNumber: true,
        amount: true,
        slotStart: true,
        slotEnd: true,
        status: true,
        createdAt: true,
        clinic: { select: { name: true } },
        doctor: { select: { name: true } },
        appointmentType: { select: { name: true } },
      },
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      clinicId: row.clinicId,
      clinicName: row.clinic.name,
      doctorId: row.doctorId,
      doctorName: row.doctor.name,
      appointmentTypeId: row.appointmentTypeId,
      appointmentTypeName: row.appointmentType.name,


      patientId: row.patientId,
      name: row.name,
      mobileNumber: row.mobileNumber,
      amount: row.amount.toFixed(2),
      date: formatDateOnly(row.slotStart),
      startTime: formatClockTime(row.slotStart),
      endTime: formatClockTime(row.slotEnd),
      slotStart: row.slotStart.toISOString(),
      slotEnd: row.slotEnd.toISOString(),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * The day or range filter, as a half-open window on `slotStart`.
 *
 * Half-open at the top — "before the day after" rather than "on or before that
 * day" — so the whole of the last day is included whatever time its appointments
 * start at. An appointment cannot span midnight, so filtering on `slotStart`
 * alone catches every appointment belonging to a day.
 */
function slotWindowFilter(
  filters: AppointmentFilters,
): Prisma.AppointmentWhereInput {
  if (filters.view === "upcoming") {
    const now = parseDateTime(todayDateOnly(), nowClockTime());
    const window: Prisma.DateTimeFilter = { gte: now };
    if (filters.dateTo?.trim()) {
      window.lt = new Date(
        parseDateTime(filters.dateTo.trim(), "00:00").getTime() + DAY_MS,
      );
    }
    return { slotStart: window };
  }

  const exact = filters.date?.trim();

  if (exact) {
    const start = parseDateTime(exact, "00:00");
    return {
      slotStart: { gte: start, lt: new Date(start.getTime() + DAY_MS) },
    };
  }

  const from = filters.dateFrom?.trim();
  const to = filters.dateTo?.trim();

  if (!from && !to) {
    return {};
  }

  const window: { gte?: Date; lt?: Date } = {};

  if (from) {
    window.gte = parseDateTime(from, "00:00");
  }

  if (to) {
    window.lt = new Date(parseDateTime(to, "00:00").getTime() + DAY_MS);
  }

  return { slotStart: window };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppointmentDateIndicator {
  count: number;
}

/**
 * Returns appointment counts grouped by calendar date for the date picker.
 *
 * Bounded query: scoped to tenant/clinic/doctor/status, querying only slotStart
 * for upcoming dates (or a bounded date window) to provide date indicator dots.
 */
export async function getAppointmentDateIndicators(
  actor: ActorContext,
  query: AppointmentIndicatorsQuery = {},
): Promise<Record<string, AppointmentDateIndicator>> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:read",
    query.clinicId,
  );

  if (!clinicWhere) {
    return {};
  }

  const now = parseDateTime(todayDateOnly(), nowClockTime());
  const statuses = resolveListStatuses({
    status: query.status,
    includeHistory: query.includeHistory,
  });

  const fromInstant = query.dateFrom?.trim()
    ? parseDateTime(query.dateFrom.trim(), "00:00")
    : now;
  const effectiveGte = query.includeHistory
    ? fromInstant
    : fromInstant > now
      ? fromInstant
      : now;

  const window: Prisma.DateTimeFilter = { gte: effectiveGte };
  if (query.dateTo?.trim()) {
    window.lt = new Date(
      parseDateTime(query.dateTo.trim(), "00:00").getTime() + DAY_MS,
    );
  }

  const where: Prisma.AppointmentWhereInput = {
    tenantId: actor.tenantId,
    clinic: clinicWhere,
    status: { in: [...statuses] },
    slotStart: window,
    ...(query.doctorId?.trim() ? { doctorId: query.doctorId.trim() } : {}),
  };

  const rows = await prisma.appointment.findMany({
    where,
    select: { slotStart: true },
  });

  const result: Record<string, AppointmentDateIndicator> = {};
  for (const row of rows) {
    const dateKey = formatDateOnly(row.slotStart);
    if (!result[dateKey]) {
      result[dateKey] = { count: 0 };
    }
    result[dateKey].count += 1;
  }

  return result;
}
