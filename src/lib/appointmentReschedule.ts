import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  appointmentTransitionRefusal,
  parseSlotInstant,
  type RescheduleAppointmentInput,
} from "@/lib/appointmentInput";
import {
  appointmentTransaction,
  findOccupyingClash,
  isUniqueConstraintError,
  lockAppointmentRow,
  SLOT_TAKEN_MESSAGE,
  takeDoctorDayLocks,
  type DoctorDayLockKey,
} from "@/lib/appointmentLocks";
import {
  activeSlotStartForStatus,
  appointmentIntervalProblem,
  appointmentLockDate,
  isAppointmentStatus,
  matchesDuration,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  appointmentAuditShape,
  blankReasonToNull,
  getAppointmentForActor,
  toAppointmentStateView,
  APPOINTMENT_ROW_SELECT,
  type AppointmentStateView,
} from "@/lib/appointmentLifecycle";
import { computeAppointmentSlots } from "@/lib/appointmentSlots";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";

/**
 * Rescheduling — AP-4.
 *
 * A MOVE IS A NEW ROW, NOT AN EDIT. This is rule 2 from the schema header and
 * it is not negotiable: `slot_start` and `slot_end` are never updated after
 * insert. The original is marked RESCHEDULED — which releases its slot — and a
 * new appointment is created pointing back at it through `rescheduled_from_id`.
 * An appointment moved N times is a linked list ending in the one live row, and
 * every step of it is still there to be read.
 *
 * The alternative — moving the times on the existing row — would lose the
 * history, and would also break `active_slot_start`, which is only a pure
 * function of status because the times underneath it never change.
 *
 * TWO LOCKS, IN ORDER. A move touches the doctor-day being vacated and the one
 * being taken, and they may be different doctors on different dates. Two
 * reschedules that are each other's mirror image would deadlock without a
 * deterministic order, so lib/appointmentLocks.ts sorts every key set ascending
 * by (doctorId, date) before taking anything.
 *
 * Kept apart from lib/appointmentLifecycle.ts because it is a genuinely
 * different operation: that file changes one row in place under one lock, this
 * one creates a row under two.
 */

export interface RescheduleResult {
  /** The new live appointment. */
  appointment: AppointmentStateView;
  /** The original, now RESCHEDULED and no longer occupying its slot. */
  previous: AppointmentStateView;
}

/**
 * Moves an appointment to a different slot, and optionally a different doctor.
 *
 * WHAT CANNOT CHANGE, and why:
 *
 *   - The clinic. A move to another site is a different booking, not a move,
 *     and it would take the appointment outside the scope the permission was
 *     checked against.
 *   - The appointment type. Changing the service changes the duration and the
 *     price; that is a cancel-and-rebook, and pretending otherwise would let
 *     `appointment:reschedule` silently do the work of `appointment:create`.
 *   - The price. The patient keeps the amount they were quoted, exactly as
 *     re-pricing a type never rewrites an appointment already booked. The new
 *     row copies the original's `amount` rather than re-reading the type's.
 *   - The patient, and every one of their details. This endpoint accepts no
 *     patient fields at all, so it can never become an unaudited back door into
 *     someone's record. Correcting those is `appointment:update`.
 *
 * The doctor MAY change, within the same clinic, because the commonest real
 * reason to move an appointment is that the original doctor has gone on leave.
 */
export async function rescheduleAppointment(
  actor: ActorContext,
  appointmentId: string,
  input: RescheduleAppointmentInput,
): Promise<RescheduleResult> {
  // 1. The organisation must have Appointments at all. First, so a plan problem
  //    never reads as a permission problem.
  await requireModule(actor, MODULE_FEATURES.appointments);

  // 2. Load within the caller's read scope — unreachable is a 404 that does not
  //    confirm the appointment exists.
  const original = await getAppointmentForActor(actor, appointmentId);

  // 3. The permission, against the appointment's OWN clinic. No clinic id is
  //    accepted from the request, so there is nothing here to spoof.
  await requirePermission(actor, "appointment:reschedule", original.clinicId);

  // 4. Can this appointment be moved at all? Checked before the transaction so
  //    an already cancelled or converted one is refused cheaply, with a message
  //    naming the state it is actually in.
  const refusal = appointmentTransitionRefusal(original.status, "RESCHEDULED");

  if (refusal) {
    throw new ConflictError(refusal);
  }

  const clinicWhere = await clinicWhereForActor(
    actor,
    "appointment:reschedule",
    original.clinicId,
  );

  if (!clinicWhere) {
    throw new ScopeError();
  }

  // 5. The target doctor: the original's unless another was named, and either
  //    way re-derived against the appointment's own clinic and the actor's
  //    scope. A doctor at a sibling clinic is a 404, not a 403.
  const targetDoctorId = input.doctorId?.trim() || original.doctorId;

  const doctor = await prisma.doctor.findFirst({
    where: {
      id: targetDoctorId,
      clinicId: original.clinicId,
      clinic: clinicWhere,
    },
    select: { id: true, name: true, clinicId: true },
  });

  if (!doctor) {
    throw new ScopeError();
  }

  // 6. The type is the original's, looked up only for its duration. Its tenant
  //    is filtered in the query, so another organisation's row is never loaded.
  //
  //    NOT REQUIRED TO BE ACTIVE. Retiring a service must not strand the people
  //    already booked into it — they were sold that appointment and moving it is
  //    exactly what a clinic would do next. `isActive` gates NEW bookings, which
  //    is where lib/appointments.ts checks it.
  const appointmentType = await prisma.appointmentType.findFirst({
    where: { id: original.appointmentTypeId, tenantId: actor.tenantId },
    select: { id: true, name: true, durationMinutes: true },
  });

  if (!appointmentType) {
    throw new ScopeError();
  }

  // 7. A valid interval: real dates, end after start, one calendar day. The
  //    single-day rule is what makes (doctorId, date) a complete lock key.
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

  // 8. The new slot must match the type's CURRENT duration, because that is the
  //    grid the slot picker just offered. If the type was re-timed since the
  //    original booking, the original's own length is history — the move has to
  //    land on the grid that exists now.
  if (!matchesDuration(slotStart, slotEnd, appointmentType.durationMinutes)) {
    throw new BadRequestError(
      `A ${appointmentType.name} appointment is ${appointmentType.durationMinutes} minutes long.`,
    );
  }

  // 9. Moving something to where it already is would create a second row that
  //    differs from the first in nothing but its id, and leave a reschedule in
  //    the trail that did not reschedule anything.
  if (
    doctor.id === original.doctorId &&
    slotStart.getTime() === original.slotStart.getTime() &&
    slotEnd.getTime() === original.slotEnd.getTime()
  ) {
    throw new BadRequestError(
      "This appointment is already in that slot. Choose a different time.",
    );
  }

  const fromDate = appointmentLockDate(original.slotStart);
  const toDate = appointmentLockDate(slotStart);
  const date = formatDateOnly(slotStart);
  const reason = blankReasonToNull(input.reason);
  const status: AppointmentStatus = "SCHEDULED";

  const lockKeys: DoctorDayLockKey[] = [
    { doctorId: original.doctorId, date: fromDate },
    { doctorId: doctor.id, date: toDate },
  ];

  const before = appointmentAuditShape(original);

  try {
    const moved = await appointmentTransaction(prisma, async (tx) => {
      // 10. Both doctor-days, ascending by (doctorId, date). Collapses to one
      //     lock when the move stays inside the same doctor's day.
      await takeDoctorDayLocks(tx, lockKeys);

      // 11. The authoritative status, under a row lock. Without this, two
      //     receptionists moving the same appointment at once would both pass
      //     the advisory check in step 4 and create TWO live rows from one
      //     original — a double booking made of a single appointment.
      const locked = await lockAppointmentRow(tx, appointmentId);

      if (!locked) {
        throw new ScopeError();
      }

      if (!isAppointmentStatus(locked.status)) {
        throw new ConflictError(
          "This appointment is in a state that cannot be changed.",
        );
      }

      const liveRefusal = appointmentTransitionRefusal(
        locked.status,
        "RESCHEDULED",
      );

      if (liveRefusal) {
        throw new ConflictError(liveRefusal);
      }

      // 12. Re-read the TARGET doctor's schedule inside the lock. Not because a
      //     booking could change it — those are serialised by the lock above —
      //     but because an admin could, concurrently, through the availability
      //     and leave endpoints. Not taken FOR UPDATE, deliberately: locking
      //     availability rows would make every move block every schedule edit
      //     for that doctor. Under READ COMMITTED this plain read still sees the
      //     latest committed rows, which closes the stale-read window.
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
      // "which slots are there?". `booked: []` because occupancy is the locking
      // query's job below — this is only about whether the doctor works then.
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

      // 13. RELEASE THE ORIGINAL FIRST, then look for a clash.
      //
      //     Order matters and this is the reason: a move within the same
      //     doctor's day very often overlaps the slot being vacated —
      //     09:00-09:30 shifting to 09:15-09:45 is the ordinary case. If the
      //     overlap query ran first, the appointment being moved would be found
      //     as its own conflict. Releasing it first makes the question the
      //     honest one: with this appointment out of the way, is the target slot
      //     free? The row keeps its original times; only its status and its
      //     occupancy sentinel change.
      const released = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: "RESCHEDULED",
          activeSlotStart: activeSlotStartForStatus(
            "RESCHEDULED",
            original.slotStart,
          ),
        },
        select: APPOINTMENT_ROW_SELECT,
      });

      // 14. The overlap check, as a locking read. The exclusion is belt and
      //     braces — the row above no longer occupies anything — but it keeps
      //     this correct if the order in this transaction is ever changed.
      const clash = await findOccupyingClash(tx, {
        doctorId: doctor.id,
        slotStart,
        slotEnd,
        excludeAppointmentId: appointmentId,
      });

      if (clash) {
        throw new ConflictError(SLOT_TAKEN_MESSAGE);
      }

      // 15. The new row. Every patient field is copied from the original, not
      //     taken from the request — the request has no vocabulary for them.
      const created = await tx.appointment.create({
        data: {
          tenantId: original.tenantId,
          clinicId: original.clinicId,
          doctorId: doctor.id,
          appointmentTypeId: original.appointmentTypeId,
          patientId: original.patientId,

          name: original.name,
          mobileNumber: original.mobileNumber,
          age: original.age,
          gender: original.gender,
          address: original.address,
          city: original.city,

          // The quoted price travels with the patient, not with the price list.
          amount: original.amount,
          slotStart,
          slotEnd,
          activeSlotStart: activeSlotStartForStatus(status, slotStart),
          status,
          // Whoever moved it booked this row. The original's own bookedById is
          // untouched, so the trail of who did what stays intact on both rows.
          bookedById: actor.userId,
          // The backward link. Walking it gives the whole history of a move.
          rescheduledFromId: appointmentId,
        },
        select: APPOINTMENT_ROW_SELECT,
      });

      // 16. ONE audit row, on the appointment that was acted upon.
      //
      //     `targetId` is the ORIGINAL, because that is what somebody asks about
      //     when they ask what happened to an appointment, and `newAppointmentId`
      //     in the metadata leads forward. The reverse direction does not need a
      //     second row: the new appointment carries `rescheduled_from_id`, which
      //     the schema designed as the authoritative link and which survives
      //     independently of the trail.
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
        targetType: "Appointment",
        targetId: appointmentId,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        beforeValue: before,
        afterValue: {
          ...appointmentAuditShape(created),
          newAppointmentId: created.id,
          // Recorded because a move between doctors is the interesting case for
          // anybody auditing a schedule, and comparing two ids in one row is
          // easier than pairing this against the before-value by hand.
          doctorChanged: created.doctorId !== original.doctorId,
        },
        reason,
      });

      return { created, released };
    });

    return {
      appointment: toAppointmentStateView(moved.created),
      previous: toAppointmentStateView(moved.released),
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
