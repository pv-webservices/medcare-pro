import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/lib/apiHandler";
import {
  appointmentTransitionRefusal,
  type CancelAppointmentInput,
} from "@/lib/appointmentInput";
import {
  appointmentTransaction,
  lockAppointmentRow,
  takeDoctorDayLocks,
} from "@/lib/appointmentLocks";
import {
  activeSlotStartForStatus,
  appointmentLockDate,
  isAppointmentStatus,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  notifyAppointmentCancelledById,
  notifyAppointmentNoShowById,
} from "@/lib/appointmentNotifications";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { formatClockTime, formatDateOnly } from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";

/**
 * The appointment lifecycle — AP-4: cancel, no-show and check-in.
 *
 * Rescheduling lives in lib/appointmentReschedule.ts, because it is a different
 * kind of operation: these three change one row's status in place, while a
 * reschedule creates a second row and takes two locks. Putting them together
 * would mean one file where half the code paths do not apply to half the
 * operations.
 *
 * THE THREE RULES FROM AP-1 GOVERN EVERYTHING HERE:
 *
 *   1. No appointment row is ever deleted. Cancel and no-show are STATUS
 *      TRANSITIONS, so the record survives and any later utilisation figure can
 *      still see that the slot was booked and what became of it.
 *   2. slot_start / slot_end are never updated. Nothing in this file writes
 *      them, and a "move" is a reschedule, not an edit.
 *   3. Occupancy is derived from status, in exactly one column.
 *      `activeSlotStartForStatus` is the only thing that decides
 *      `active_slot_start`, so the unique index and the overlap query cannot
 *      disagree about what busy means.
 *
 * WHAT IS NOT HERE. There is no conversion — that is AP-5 and
 * `appointment:convert` — and no detail edit: correcting a booking's patient
 * details is `appointment:update`, which lives in lib/appointmentEdit.ts
 * because it changes no status and so needs no doctor-day lock.
 *
 * AP-9 ADDED THE FOURTH TRANSITION. `confirmAppointment` below is the one
 * status change AP-4 deferred, on the grounds that a patient-side
 * acknowledgement belonged with the messaging work. AP-8 shipped the reminder
 * that prompts it and the acknowledgement still arrives by phone, so it is
 * recorded here with the rest of the desk's controls — through the same
 * `applyStatusChange` path, carrying nothing but a different spec.
 */

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * One appointment as a lifecycle write leaves it.
 *
 * Carries no address, city, age or gender, and no patient code — this is the
 * receipt for a state change, not a patient record. `name` is here because the
 * caller has just acted on a named person's appointment and the confirmation
 * needs to say whose.
 */
export interface AppointmentStateView {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  patientId: string | null;
  name: string;
  /** Split for display, each derived from one stored instant. */
  date: string;
  startTime: string;
  endTime: string;
  slotStart: string;
  slotEnd: string;
  status: AppointmentStatus;
  /** 2-decimal string, matching the Decimal(10,2) column. */
  amount: string;
  /** Set on a row created BY a reschedule, pointing at the row it replaced. */
  rescheduledFromId: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

// ---------------------------------------------------------------------------
// The shared read
// ---------------------------------------------------------------------------

/**
 * Everything a lifecycle write needs about the appointment it is acting on.
 *
 * The patient snapshot fields are selected because a reschedule copies them
 * onto the new row verbatim — they are the appointment's own record of who it
 * is for, and a move must not silently lose or alter them.
 */
export const APPOINTMENT_ROW_SELECT = {
  id: true,
  tenantId: true,
  clinicId: true,
  doctorId: true,
  appointmentTypeId: true,
  patientId: true,
  name: true,
  mobileNumber: true,
  age: true,
  gender: true,
  address: true,
  city: true,
  amount: true,
  slotStart: true,
  slotEnd: true,
  status: true,
  rescheduledFromId: true,
  checkedInAt: true,
  cancelledAt: true,
  cancellationReason: true,
} as const;

export type AppointmentRow = Prisma.AppointmentGetPayload<{
  select: typeof APPOINTMENT_ROW_SELECT;
}>;

/**
 * Loads one appointment, or refuses with a 404.
 *
 * SCOPED BY `appointment:read`, then each caller checks its OWN permission
 * against the clinic this returns. That is the shape lib/registrations.ts
 * already uses for an edit — `getRegistrationForActor` then
 * `requirePermission(..., "registration:edit", current.clinicId)` — and it is
 * what produces the right two answers: an appointment the caller cannot see at
 * all is a 404 that does not confirm it exists, while one they can see but may
 * not act on is a 403 that tells them to ask for the permission.
 *
 * The consequence is deliberate: acting on an appointment requires being able
 * to read it. Every seeded role that can cancel or check in also holds
 * `appointment:read`, and a permission to change something you cannot see is
 * not a permission anybody should be granted.
 */
export async function getAppointmentForActor(
  actor: ActorContext,
  appointmentId: string,
): Promise<AppointmentRow> {
  const clinicWhere = await clinicWhereForActor(actor, "appointment:read");

  if (!clinicWhere) {
    throw new ScopeError();
  }

  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      // Belt and braces: the tenant is filtered on the appointment's own
      // denormalised column AND through the clinic relation.
      tenantId: actor.tenantId,
      clinic: clinicWhere,
    },
    select: APPOINTMENT_ROW_SELECT,
  });

  if (!appointment) {
    throw new ScopeError();
  }

  return appointment;
}

/** The public shape of a row. One place, so every AP-4 response agrees. */
export function toAppointmentStateView(
  row: AppointmentRow,
): AppointmentStateView {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    appointmentTypeId: row.appointmentTypeId,
    patientId: row.patientId,
    name: row.name,
    date: formatDateOnly(row.slotStart),
    startTime: formatClockTime(row.slotStart),
    endTime: formatClockTime(row.slotEnd),
    slotStart: row.slotStart.toISOString(),
    slotEnd: row.slotEnd.toISOString(),
    status: row.status,
    amount: row.amount.toFixed(2),
    rescheduledFromId: row.rescheduledFromId,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
  };
}

/**
 * The audit snapshot of an appointment.
 *
 * WHAT IS ABSENT IS THE POINT, and it is the same rule AP-3's booking audit
 * follows: no name, mobile number, address, age, gender or patient id. The
 * trail is append-only and is read during support work, so it records that a
 * slot changed state, whose diary it was in, and when — never who it was for.
 * The appointment itself carries that, behind `appointment:read`.
 */
export function appointmentAuditShape(
  row: Pick<
    AppointmentRow,
    "clinicId" | "doctorId" | "appointmentTypeId" | "slotStart" | "slotEnd" | "status"
  >,
): Record<string, string | number | boolean | null> {
  return {
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    appointmentTypeId: row.appointmentTypeId,
    date: formatDateOnly(row.slotStart),
    startTime: formatClockTime(row.slotStart),
    endTime: formatClockTime(row.slotEnd),
    status: row.status,
  };
}

/**
 * Blank is how an HTML form says "not filled in", which is null in the database
 * and an absent reason in the trail — not an empty string pretending to be one.
 */
export function blankReasonToNull(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// The three in-place transitions
// ---------------------------------------------------------------------------

/**
 * Cancels an appointment and frees the slot — AP-4.
 *
 * The row survives with its original times intact, per rule 1. What changes is
 * the status and the occupancy sentinel, which is what makes the slot bookable
 * again the moment this commits.
 *
 * NO TIME RULE. Cancelling something in the past is allowed, because a front
 * desk tidying yesterday's board is ordinary work and nothing downstream reads
 * a cancellation as a prediction. If a clinic ever wants a cut-off, that is a
 * policy decision to be asked for, not one to be invented here.
 */
export async function cancelAppointment(
  actor: ActorContext,
  appointmentId: string,
  input: CancelAppointmentInput = {},
): Promise<AppointmentStateView> {
  return applyStatusChange(actor, appointmentId, {
    to: "CANCELLED",
    permission: "appointment:cancel",
    auditAction: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
    reason: blankReasonToNull(input.reason),
    // The only one of the three that writes the cancellation columns, because
    // it is the only one they are named for.
    writesCancellationColumns: true,
  });
}

/**
 * Marks a patient as not having arrived — AP-4.
 *
 * Under the same permission as cancelling (`appointment:cancel`), because it is
 * the same authority: deciding that a booked slot is not going to be used. The
 * catalogue entry says so in as many words.
 *
 * THE CANCELLATION COLUMNS ARE DELIBERATELY LEFT NULL. A no-show is not a
 * cancellation, and writing `cancelled_at` / `cancelled_by_id` for one would
 * make every later reader that asks "was this cancelled?" the obvious way get
 * the wrong answer for a row whose status plainly says NO_SHOW. Who marked it
 * and when is recorded in the audit trail, which the schema already designates
 * the authoritative record of who did what; any reason typed at the desk goes
 * there too. The alternative — reusing the columns as a generic "released
 * at/by" pair — is one comment away if that is preferred, but it means storing
 * something in a column it is not named for.
 *
 * NO_SHOW RELEASES THE SLOT. The patient did not come, so the time is free, and
 * a past slot becoming bookable again is occasionally useful for backfilling a
 * walk-in. That is AP-1's rule, encoded once in `activeSlotStartForStatus`.
 */
export async function markAppointmentNoShow(
  actor: ActorContext,
  appointmentId: string,
  input: CancelAppointmentInput = {},
): Promise<AppointmentStateView> {
  return applyStatusChange(actor, appointmentId, {
    to: "NO_SHOW",
    permission: "appointment:cancel",
    auditAction: AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
    reason: blankReasonToNull(input.reason),
    writesCancellationColumns: false,
  });
}

/**
 * Records that the patient has arrived — AP-4.
 *
 * THE SLOT STAYS OCCUPIED. CHECKED_IN is an occupying status, so
 * `active_slot_start` keeps mirroring `slot_start` and the time remains
 * unbookable — a patient sitting in the waiting room has not released anything.
 * This is the one transition here that does not change occupancy at all, and it
 * still runs the full lock protocol: the schema requires check-in to, and the
 * row lock is what stops a check-in and a cancellation of the same appointment
 * from both succeeding.
 *
 * Only a booked or confirmed appointment can be checked in, and CHECKED_IN is
 * the only state AP-5 will convert from — arriving is what makes a visit real.
 */
export async function checkInAppointment(
  actor: ActorContext,
  appointmentId: string,
): Promise<AppointmentStateView> {
  return applyStatusChange(actor, appointmentId, {
    to: "CHECKED_IN",
    permission: "appointment:checkin",
    auditAction: AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
    reason: null,
    writesCancellationColumns: false,
    // Denormalised display pointers. The audit row remains authoritative for
    // who did it — these exist so the board can show "arrived 09:51" without a
    // second query.
    writesCheckInColumns: true,
  });
}

/**
 * Records that the patient has acknowledged the booking — AP-9.
 *
 * UNDER `appointment:update`, not a key of its own. Confirming is the desk
 * writing down something a patient said, and the roles that may correct a
 * booking are exactly the roles that should be able to record that — Admin and
 * Receptionist hold it, Doctor (read-only) and Staff do not. A ninth
 * appointment permission would mean a new stage list, a backfill for every
 * existing role and two widened catalogue tests, all for one button, and would
 * leave every organisation that already granted the eight with a control
 * nobody could use until an admin noticed.
 *
 * NOTHING ABOUT THE DOCTOR'S DAY CHANGES. CONFIRMED occupies the slot exactly
 * as SCHEDULED did, so `activeSlotStartForStatus` returns the same value it
 * already held and the write is a no-op as far as occupancy is concerned. The
 * doctor-day lock is still taken, because this goes through the shared path and
 * a confirm racing a cancellation of the same row is a real collision that the
 * row lock inside it settles.
 *
 * ONLY FROM SCHEDULED. AP-1's transition table allows nothing else into
 * CONFIRMED — an arrived patient is past confirming, and a cancelled one has
 * nothing to confirm. `appointmentTransitionRefusal` says which, in words.
 */
export async function confirmAppointment(
  actor: ActorContext,
  appointmentId: string,
): Promise<AppointmentStateView> {
  return applyStatusChange(actor, appointmentId, {
    to: "CONFIRMED",
    permission: "appointment:update",
    auditAction: AUDIT_ACTIONS.APPOINTMENT_CONFIRMED,
    reason: null,
    writesCancellationColumns: false,
  });
}

interface StatusChangeSpec {
  to: AppointmentStatus;
  permission: string;
  auditAction: string;
  reason: string | null;
  writesCancellationColumns: boolean;
  writesCheckInColumns?: boolean;
}

/**
 * The one path all three in-place transitions take.
 *
 * Written once rather than three times because the ORDER of these steps is the
 * safety argument, and three copies would be three chances for one of them to
 * drift. What differs between the three is data — a target status, a
 * permission, an audit action and which timestamp columns to write — so that is
 * what the spec carries.
 *
 * ORDER, and why each step is where it is:
 *
 *   1. Feature first, so someone whose organisation does not have Appointments
 *      is told that rather than told they lack a permission they may hold.
 *   2. Load within the caller's read scope: unreachable is a 404.
 *   3. The operation's own permission, against the appointment's OWN clinic —
 *      never a clinic id from the request, which this endpoint does not accept.
 *   4. The transition, checked before the transaction opens, so an already
 *      cancelled appointment is refused cheaply and with a message that names
 *      the state it is actually in.
 *   5. Everything after this is inside one READ COMMITTED transaction: the
 *      doctor-day lock, an authoritative re-read of the status under a row
 *      lock, the write, and the audit row.
 */
async function applyStatusChange(
  actor: ActorContext,
  appointmentId: string,
  spec: StatusChangeSpec,
): Promise<AppointmentStateView> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const current = await getAppointmentForActor(actor, appointmentId);

  await requirePermission(actor, spec.permission, current.clinicId);

  const refusal = appointmentTransitionRefusal(current.status, spec.to);

  if (refusal) {
    throw new ConflictError(refusal);
  }

  const before = appointmentAuditShape(current);
  const lockDate = appointmentLockDate(current.slotStart);

  const updated = await appointmentTransaction(prisma, async (tx) => {
    // Serialise against every other write touching this doctor's day, so a
    // cancellation cannot interleave with a booking reading occupancy.
    await takeDoctorDayLocks(tx, [{ doctorId: current.doctorId, date: lockDate }]);

    // The authoritative status. The check above was advisory — another request
    // may have cancelled or checked in this same appointment since. A second
    // cancel would otherwise overwrite the first's cancelledAt and
    // cancelledById, rewriting who did it.
    const locked = await lockAppointmentRow(tx, appointmentId);

    if (!locked) {
      throw new ScopeError();
    }

    // Defensive: the column is a native enum, so this cannot fail unless the
    // enum and lib/appointmentRules.ts have drifted — which a unit test forbids.
    if (!isAppointmentStatus(locked.status)) {
      throw new ConflictError(
        "This appointment is in a state that cannot be changed.",
      );
    }

    const liveRefusal = appointmentTransitionRefusal(locked.status, spec.to);

    if (liveRefusal) {
      throw new ConflictError(liveRefusal);
    }

    const now = new Date();

    const row = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: spec.to,
        // The single source of occupancy. Never written by hand, so the unique
        // index and the overlap query cannot disagree about what busy means.
        activeSlotStart: activeSlotStartForStatus(spec.to, current.slotStart),
        ...(spec.writesCancellationColumns
          ? {
              cancelledAt: now,
              cancelledById: actor.userId,
              cancellationReason: spec.reason,
            }
          : {}),
        ...(spec.writesCheckInColumns
          ? { checkedInAt: now, checkedInById: actor.userId }
          : {}),
      },
      select: APPOINTMENT_ROW_SELECT,
    });

    // Atomic with the change it describes. A state change that commits without
    // its audit row, or a row describing a change that rolled back, is worse
    // than either alone.
    await writeAuditLog(tx, {
      action: spec.auditAction,
      targetType: "Appointment",
      targetId: appointmentId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: before,
      afterValue: appointmentAuditShape(row),
      // Operator-entered free text, stored verbatim in the column the audit
      // trail already keeps for exactly this — the same one a platform decision
      // uses. Not metadata, so it is not subject to the key checks, and not a
      // place for anything clinical.
      reason: spec.reason,
    });

    return row;
  });

  // AP-8. After the commit, never inside it, and only for the outcomes an Admin
  // reviews. CHECKED_IN is deliberately absent: it happens to every patient who
  // turns up and would bury the two events below — see NOTIFICATION_TYPES in
  // lib/notifications.ts. Both calls swallow their own errors, so a feed row
  // can never turn a completed status change into an error on screen.
  if (spec.to === "CANCELLED") {
    await notifyAppointmentCancelledById(actor, appointmentId, spec.reason);
  } else if (spec.to === "NO_SHOW") {
    await notifyAppointmentNoShowById(actor, appointmentId);
  }

  return toAppointmentStateView(updated);
}
