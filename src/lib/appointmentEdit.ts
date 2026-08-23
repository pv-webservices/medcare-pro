import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  applyAppointmentEdit,
  diffAppointmentEdit,
  editRefusal,
  formatChangedFields,
  NO_CHANGES_MESSAGE,
  type AppointmentEditPatch,
  type AppointmentEditSnapshot,
  type EditableField,
} from "@/lib/appointmentEditRules";
import {
  APPOINTMENT_ROW_SELECT,
  appointmentAuditShape,
  getAppointmentForActor,
  toAppointmentStateView,
  type AppointmentRow,
  type AppointmentStateView,
} from "@/lib/appointmentLifecycle";
import { appointmentTransaction, lockAppointmentRow } from "@/lib/appointmentLocks";
import { isAppointmentStatus } from "@/lib/appointmentRules";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";

/**
 * Correcting one booking's details — AP-9, and the call site that finally makes
 * `appointment:update` a live permission.
 *
 * SEPARATE FROM lib/appointmentLifecycle.ts ON PURPOSE, and the reason is the
 * lock. Every write in that module changes `status`, so every one of them has
 * to serialise against the whole doctor-day: a cancellation racing a booking is
 * a real collision over the same slot. An edit changes no status and no times,
 * so it cannot affect occupancy at all — and taking the doctor-day lock for it
 * would serialise a name correction against every booking being taken for that
 * doctor that day, buying nothing. This takes the ROW lock only, which is the
 * narrowest thing that still makes the read-modify-write safe.
 *
 * WHAT IT CANNOT DO. Not the slot, the doctor, the service, the clinic, the
 * patient link or the status — see `updateAppointmentSchema`, which has no
 * vocabulary for any of them, and LOCKED_FIELDS, which lists them so a test can
 * hold the line.
 */

/**
 * The receipt, plus what actually changed.
 *
 * `changedFields` is echoed back because the desk has just saved a form and
 * "Saved. Mobile number and amount updated." is a better confirmation than a
 * bare tick — and because a field the client thought it was changing but which
 * was already that value will be visibly absent from this list.
 */
export interface EditedAppointment extends AppointmentStateView {
  changedFields: EditableField[];
}

/** The editable columns of a loaded row, in the pure module's shape. */
function toEditSnapshot(row: AppointmentRow): AppointmentEditSnapshot {
  return {
    name: row.name,
    mobileNumber: row.mobileNumber,
    age: row.age,
    gender: row.gender,
    address: row.address,
    city: row.city,
    amount: row.amount.toFixed(2),
  };
}

/**
 * Corrects a booking's own details.
 *
 * ORDER, and it is the same order every AP-4/AP-5/AP-8 mutation uses:
 *
 *   1. the module gate, so an unentitled organisation is told that rather than
 *      told it lacks a permission it may well hold;
 *   2. the scoped read, so an appointment this actor cannot see is a 404 that
 *      does not confirm it exists;
 *   3. `appointment:update` AT THIS APPOINTMENT'S OWN CLINIC — never a clinic
 *      id from the request, which this endpoint does not accept;
 *   4. the status refusal, checked before the transaction opens so a converted
 *      or cancelled booking is refused cheaply and told where its live record
 *      actually is;
 *   5. everything after that inside one READ COMMITTED transaction: the row
 *      lock, an authoritative re-read, the diff, the write and the audit row.
 *
 * THE DIFF IS COMPUTED TWICE, and the second one is the one that counts. The
 * pre-transaction diff exists only to refuse an empty save without opening a
 * transaction; the row may have changed underneath us between the two, and the
 * audit row must describe what this write actually did rather than what it
 * expected to do.
 */
export async function updateAppointment(
  actor: ActorContext,
  appointmentId: string,
  patch: AppointmentEditPatch,
): Promise<EditedAppointment> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const current = await getAppointmentForActor(actor, appointmentId);

  await requirePermission(actor, "appointment:update", current.clinicId);

  if (!isAppointmentStatus(current.status)) {
    throw new ConflictError(
      "This appointment is in a state this version does not recognise.",
    );
  }

  const refusal = editRefusal(current.status);

  if (refusal) {
    // A 409, matching every other refusal that turns on the appointment's
    // state: the request was well formed, and it is the row that says no.
    throw new ConflictError(refusal);
  }

  // Advisory. Refuses `{}` and "typed the same values back" before any lock is
  // taken; the authoritative diff happens under the lock below.
  if (
    diffAppointmentEdit(
      toEditSnapshot(current),
      applyAppointmentEdit(toEditSnapshot(current), patch),
    ).length === 0
  ) {
    throw new BadRequestError(NO_CHANGES_MESSAGE);
  }

  const result = await appointmentTransaction(prisma, async (tx) => {
    // The row lock, and nothing wider. Two receptionists correcting the same
    // booking at once is the race this closes: without it both read the old
    // row, both write, and the second silently discards the first's change
    // while its audit row claims it changed something it did not.
    const locked = await lockAppointmentRow(tx, appointmentId);

    if (!locked) {
      throw new ScopeError();
    }

    if (!isAppointmentStatus(locked.status)) {
      throw new ConflictError(
        "This appointment is in a state this version does not recognise.",
      );
    }

    // The authoritative status. Another request may have cancelled, converted
    // or moved this appointment since the check above — and an edit landing on
    // a row that has just been converted is exactly the disagreement between
    // booking and registration that EDITABLE_STATUSES exists to prevent.
    const liveRefusal = editRefusal(locked.status);

    if (liveRefusal) {
      throw new ConflictError(liveRefusal);
    }

    // Re-read the values under the lock rather than trusting the pre-lock read:
    // `lockAppointmentRow` returns the id and status only, and the fields being
    // corrected are precisely the ones another edit could have changed.
    const live = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: APPOINTMENT_ROW_SELECT,
    });

    if (!live) {
      throw new ScopeError();
    }

    const before = toEditSnapshot(live);
    const after = applyAppointmentEdit(before, patch);
    const changed = diffAppointmentEdit(before, after);

    if (changed.length === 0) {
      // Reachable: the other writer made the same correction first. Their audit
      // row already records it, and a second row claiming the same change would
      // be a false entry in an append-only table.
      throw new BadRequestError(NO_CHANGES_MESSAGE);
    }

    const row = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        name: after.name,
        mobileNumber: after.mobileNumber,
        age: after.age,
        gender: after.gender,
        address: after.address,
        city: after.city,
        amount: after.amount,
      },
      select: APPOINTMENT_ROW_SELECT,
    });

    // Atomic with the change it describes. `changedFields` names columns and
    // never their values — the trail records that a mobile number was
    // corrected, not what it was corrected to. `amount` is the one exception,
    // carried on both sides, because it is a commercial fact this table already
    // records at booking and becomes revenue at conversion.
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.APPOINTMENT_UPDATED,
      targetType: "Appointment",
      targetId: appointmentId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { ...appointmentAuditShape(live), amount: before.amount },
      afterValue: {
        ...appointmentAuditShape(row),
        amount: after.amount,
        changedFields: formatChangedFields(changed),
      },
    });

    return { row, changed };
  });

  // NO NOTIFICATION, deliberately. AP-8 chose four appointment events an Admin
  // reviews — booked, cancelled, missed, moved — and a correction is not one of
  // them: most edits are a misheard name, and a feed row for each would bury
  // the four that matter. The audit trail is the record of a correction, and it
  // is the right one, being append-only and queryable by action.
  return {
    ...toAppointmentStateView(result.row),
    changedFields: result.changed,
  };
}
