import { Prisma } from "@prisma/client";
import { z } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  parseSlotInstant,
  resolveListStatuses,
  type AppointmentFilters,
  type CreateAppointmentInput,
} from "@/lib/appointmentInput";
import {
  isUniqueConstraintError,
  SLOT_TAKEN_MESSAGE,
} from "@/lib/appointmentLocks";
import { notifyAppointmentBookedById } from "@/lib/appointmentNotifications";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { clinicWhereForActor } from "@/lib/clinicScope";
import {
  formatClockTime,
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
  activeSlotStartForStatus,
  appointmentIntervalProblem,
  appointmentLockDate,
  isAppointmentTypeUsableAt,
  matchesDuration,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  computeAppointmentSlots,
  type SlotOutcome,
  type SlotStatus,
} from "@/lib/appointmentSlots";

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
  createAppointmentSchema,
  resolveListStatuses,
  type AppointmentFilters,
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


// ===========================================================================
// AP-3 — BOOKING
// ===========================================================================


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
  /** 2-decimal string, matching the Decimal(10,2) column. */
  amount: string;
}

/** Empty strings from an HTML form mean "not set", which is null in the database. */
function blankToNull(value: string | undefined | null): string | null {
  return value === undefined || value === null || value.trim() === ""
    ? null
    : value.trim();
}

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
  // Steps 1-2 happen in the route: requireActor() and the Zod parse.

  // 3. The organisation must have Appointments at all. First, so someone whose
  //    plan does not include it is told that, rather than told they lack a
  //    permission they may well hold.
  await requireModule(actor, MODULE_FEATURES.appointments);

  // 4-5. Clinic belongs to the tenant (404 if not) and the actor may book in
  //      THAT clinic (403 if not) — one call covers both.
  await requirePermission(actor, "appointment:create", input.clinicId);

  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:create",
    input.clinicId,
  );

  if (!clinicWhere) {
    throw new ScopeError();
  }

  // 6. Doctor exists, belongs to the REQUESTED clinic, and that clinic is inside
  //    the actor's scope. Doctor has no `isActive` column in this schema, so
  //    existence within the right clinic is the whole liveness test.
  const doctor = await prisma.doctor.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, clinic: clinicWhere },
    select: {
      id: true,
      clinicId: true,
      name: true,
      clinic: { select: { id: true, tenantId: true } },
    },
  });

  if (!doctor) {
    throw new ScopeError();
  }

  // 7-9. Type belongs to this tenant, is active, and is offered at this clinic
  //      (NULL clinicId = offered everywhere in the organisation).
  const appointmentType = await prisma.appointmentType.findFirst({
    where: { id: input.appointmentTypeId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      clinicId: true,
      name: true,
      durationMinutes: true,
      defaultAmount: true,
      isActive: true,
    },
  });

  if (
    !appointmentType ||
    !isAppointmentTypeUsableAt(appointmentType, actor.tenantId, input.clinicId)
  ) {
    throw new ScopeError();
  }

  // 10. An existing patient must belong to this organisation and be reachable at
  //     this clinic. Resolved server-side from the id alone: the client's
  //     demographic fields are the appointment's own snapshot (AP-1's design),
  //     never a way to rewrite the authoritative Patient row — booking does not
  //     edit patient records.
  const patientId = await resolveBookingPatient(
    actor,
    input.patientId,
    input.clinicId,
  );

  // 11. The price comes from the type. Never from the request.
  const amount = appointmentType.defaultAmount.toFixed(2);

  // 12. A valid interval: real dates, end after start, one calendar day. The
  //     single-day rule is what makes (doctorId, date) a complete lock key.
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

  if (problem) {
    throw new BadRequestError("Choose a valid appointment time.");
  }

  // 13. The slot must be exactly as long as the type says. A mismatch means it
  //     was assembled by hand, or the type was re-timed after it was offered;
  //     either way the grid it came from no longer applies.
  if (!matchesDuration(slotStart, slotEnd, appointmentType.durationMinutes)) {
    throw new BadRequestError(
      `A ${appointmentType.name} appointment is ${appointmentType.durationMinutes} minutes long.`,
    );
  }

  const date = formatDateOnly(slotStart);
  const lockDate = appointmentLockDate(slotStart);
  const lockId = `lock-${doctor.id}-${lockDate}`;
  const status: AppointmentStatus = "SCHEDULED";

  try {
    // 14. One transaction, READ COMMITTED.
    const created = await prisma.$transaction(
      async (tx) => {
        // 16. Ensure the lock row EXISTS and is exclusively locked.
        //
        //     ON DUPLICATE KEY UPDATE, never INSERT IGNORE. This is the single
        //     most important line in the protocol, and AP-1 proved it by racing
        //     real transactions: INSERT IGNORE takes a SHARED lock on the
        //     conflicting index record, so two bookings for the same doctor-day
        //     both take an S lock and both then try to upgrade to the X lock the
        //     next step needs — a lock-upgrade deadlock (MySQL 1213) in which
        //     neither booking succeeds and the loser is not even a clean
        //     conflict. ON DUPLICATE KEY UPDATE takes the X lock directly, so
        //     the second transaction blocks and waits.
        //
        //     Setting updated_at to itself is a deliberate no-op: the row's
        //     contents are irrelevant, only the lock on it matters.
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO doctor_schedule_locks
              (id, doctor_id, date, created_at, updated_at)
            VALUES (${lockId}, ${doctor.id}, ${lockDate}, NOW(3), NOW(3))
            ON DUPLICATE KEY UPDATE updated_at = updated_at
          `,
        );

        // 16b. Hold it explicitly. The step above already took the X lock, so
        //      this is belt-and-braces — but it states the serialisation point
        //      in the code, and keeps the lock held if that step is ever
        //      rewritten.
        await tx.$queryRaw(
          Prisma.sql`
            SELECT id FROM doctor_schedule_locks
            WHERE doctor_id = ${doctor.id} AND date = ${lockDate}
            FOR UPDATE
          `,
        );

        // 15. Re-read the schedule INSIDE the lock.
        //
        //     Not because a booking could change it — bookings are serialised
        //     by the lock above — but because an ADMIN could, concurrently,
        //     through the availability and leave endpoints. A window read before
        //     the transaction opened can be stale by the time we insert, and
        //     booking a patient into hours that were just deleted is a real
        //     failure a receptionist would discover on the day.
        //
        //     NOT taken FOR UPDATE, deliberately: locking availability rows
        //     would make every booking block every schedule edit for that
        //     doctor. Under READ COMMITTED this plain read still sees the latest
        //     committed rows, which closes the stale-read window. The residual
        //     race — an edit committing between this read and our commit — is a
        //     schedule-management conflict, not a double booking.
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

        // The offer is regenerated by AP-2's engine rather than re-derived here,
        // so "is this a real slot?" is answered by the same code that answered
        // "which slots are there?". `booked: []` because occupancy is the
        // locking query's job below — this call is only about whether the doctor
        // works then.
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

        // 17. The overlap check, AS A LOCKING READ.
        //
        //     Half-open [start, end): an existing appointment ending exactly
        //     when this one starts is not a conflict. Filtered to the statuses
        //     that actually occupy the doctor — CONVERTED among them, because a
        //     completed visit consumed the time just as surely as a booked one.
        //
        //     BY DOCTOR, not by clinic: a doctor's time is occupied wherever the
        //     appointment was filed, and narrowing by clinic could hide a
        //     conflict. FOR UPDATE because a plain read cannot see a competitor
        //     that commits between the lock and the insert.
        const clash = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`
            SELECT id FROM appointments
            WHERE doctor_id = ${doctor.id}
              AND status IN (${Prisma.join([...OCCUPYING_STATUSES])})
              AND slot_start < ${slotEnd}
              AND slot_end > ${slotStart}
            FOR UPDATE
          `,
        );

        if (clash.length > 0) {
          throw new ConflictError(SLOT_TAKEN_MESSAGE);
        }

        // 18. Only now insert.
        const row = await tx.appointment.create({
          data: {
            // Denormalised from the CLINIC's tenant rather than the session, so
            // the row satisfies isAppointmentScopeConsistent by construction.
            tenantId: doctor.clinic.tenantId,
            clinicId: doctor.clinicId,
            doctorId: doctor.id,
            appointmentTypeId: appointmentType.id,
            patientId,

            name: input.name.trim(),
            mobileNumber: input.mobileNumber.trim(),
            age: input.age ?? null,
            gender: blankToNull(input.gender),
            address: blankToNull(input.address),
            city: blankToNull(input.city),

            amount,
            slotStart,
            slotEnd,
            // Derived from the status by the one helper, so the unique index and
            // the overlap query cannot disagree about what "busy" means.
            activeSlotStart: activeSlotStartForStatus(status, slotStart),
            status,
            bookedById: actor.userId,
          },
          select: { id: true },
        });

        // 19. Atomic with the booking. An appointment that commits without its
        //     audit row, or a row describing a booking that rolled back, is
        //     worse than either alone.
        //
        //     No patient name, phone, address, age or gender: the trail is
        //     append-only and is read during support work. Who the appointment
        //     is FOR lives on the appointment; what the trail records is that a
        //     slot was taken, by whom, and at what price.
        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
          targetType: "Appointment",
          targetId: row.id,
          actorUserId: actor.userId,
          actorTenantId: actor.tenantId,
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
            /** Whether it was booked for an existing patient — not WHICH one. */
            existingPatient: patientId !== null,
          },
        });

        return row;
        // 20. Commit.
      },
      {
        /**
         * READ COMMITTED, and the reason is specific.
         *
         * Under MySQL's default REPEATABLE READ the locking overlap query takes
         * GAP LOCKS over the range it scans even when it matches nothing, so two
         * bookings for DIFFERENT doctors at the same time of day can deadlock
         * each other on the same index gap. READ COMMITTED takes no gap locks,
         * and gives every statement the latest committed data rather than a
         * snapshot pinned at the transaction's first read — which is also what
         * makes the re-read above meaningful.
         */
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    // AP-8. AFTER the commit and never inside it: a feed row is a convenience,
    // and it must not be able to roll back a booking that succeeded. The call
    // swallows its own errors — see lib/appointmentNotifications.ts.
    await notifyAppointmentBookedById(actor, created.id);

    return {
      id: created.id,
      clinicId: doctor.clinicId,
      doctorId: doctor.id,
      appointmentTypeId: appointmentType.id,
      patientId,
      name: input.name.trim(),
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      startTime: formatClockTime(slotStart),
      endTime: formatClockTime(slotEnd),
      date,
      status,
      amount,
    };
  } catch (error: unknown) {
    // The backstop firing. @@unique([doctorId, activeSlotStart]) catches an
    // exact duplicate start that somehow reached the insert — a double-submitted
    // form being the ordinary cause. Mapped to the SAME message as a detected
    // overlap: the caller learns the slot is gone, never the constraint name nor
    // that a row already exists.
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(SLOT_TAKEN_MESSAGE);
    }
    throw error;
  }
}

/**
 * Resolves an optional existing patient, or returns null for a new one.
 *
 * Booking NEVER creates a Patient row, a Registration or a PT-YYYY-#### code.
 * That is AP-5's job at conversion, and doing it here would fill the patient
 * register — and burn code numbers — for people who only ever cancelled.
 */
async function resolveBookingPatient(
  actor: ActorContext,
  patientId: string | null | undefined,
  clinicId: string,
): Promise<string | null> {
  if (!patientId) {
    return null;
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      // Tenant from the session. A patient belonging to another organisation is
      // simply not found — a 404, never a 403 that would confirm they exist.
      tenantId: actor.tenantId,
      clinicId,
    },
    select: { id: true },
  });

  if (!patient) {
    throw new ScopeError();
  }

  return patient.id;
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
