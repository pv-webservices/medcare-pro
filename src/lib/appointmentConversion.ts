import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  ALREADY_CONVERTED_MESSAGE,
  DEPARTMENT_REQUIRED_MESSAGE,
  PATIENT_CODE_EXHAUSTED_MESSAGE,
  conversionAuditMetadata,
  conversionRefusal,
  departmentForConversion,
  isAppointmentLinkConflict,
  visitTypeForConversion,
} from "@/lib/appointmentConversionRules";
import {
  APPOINTMENT_ROW_SELECT,
  appointmentAuditShape,
  getAppointmentForActor,
  toAppointmentStateView,
  type AppointmentRow,
  type AppointmentStateView,
} from "@/lib/appointmentLifecycle";
import {
  appointmentTransaction,
  isUniqueConstraintError,
  lockAppointmentRow,
  takeDoctorDayLocks,
} from "@/lib/appointmentLocks";
import {
  activeSlotStartForStatus,
  appointmentLockDate,
  isAppointmentStatus,
} from "@/lib/appointmentRules";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { formatClockTime, formatDateOnly } from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { notifyRegistrationCreated } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  resolveRoleNameAtTime,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  buildCreationSnapshot,
  insertRegistrationWithin,
  MAX_PATIENT_CODE_ATTEMPTS,
  type CreateRegistrationInput,
} from "@/lib/registrations";

// Re-exported so a route or a verify script imports the operation and the
// rules it enforces from one place — the same convenience lib/features.ts
// offers for its guard and its feature keys.
export {
  ALREADY_CONVERTED_MESSAGE,
  CONVERTIBLE_STATUSES,
  DEPARTMENT_REQUIRED_MESSAGE,
  PATIENT_CODE_EXHAUSTED_MESSAGE,
  canConvertAppointment,
  conversionRefusal,
  departmentForConversion,
  isAppointmentLinkConflict,
  visitTypeForConversion,
} from "@/lib/appointmentConversionRules";

/**
 * Conversion: an arrived appointment becomes a real Registration — AP-5.
 *
 * Its own file rather than an addition to lib/appointments.ts, for the reason
 * AP-4 split the lifecycle out: this is the only appointment path that writes
 * to a DIFFERENT aggregate. Everything else in the feature moves an appointment
 * around inside its own table; this one creates a Patient, mints a
 * `PT-YYYY-####` code, writes a Registration and its first edit-log row, and
 * only then touches the appointment. Filing that beside slot computation would
 * put two unrelated sets of invariants in one place.
 *
 * WHAT THIS FILE DOES NOT CONTAIN, on purpose:
 *
 *   - No patient creation, no code generation, no retry policy and no
 *     edit-log write. All four already exist in lib/registrations.ts, are
 *     already tested, and are CALLED here via `insertRegistrationWithin`. A
 *     second copy would be a second place for FR-3.1's rules to drift.
 *   - No lock protocol. lib/appointmentLocks.ts owns it, and its own header
 *     anticipated this stage.
 *   - No transition table. lib/appointmentRules.ts owns it, and the set of
 *     convertible statuses below is DERIVED from it rather than restated.
 *
 * THE ONE RULE THIS STAGE ADDS: a converted appointment keeps occupying the
 * doctor's time. CONVERTED is in OCCUPYING_STATUSES, so `active_slot_start`
 * still mirrors `slot_start` afterwards — a visit that demonstrably happened
 * consumed the slot, and releasing it would let a second booking land on top of
 * it. That decision is AP-1's; this file only must not undo it.
 */

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ConvertedAppointment {
  /** The appointment as conversion left it — CONVERTED, slot still occupied. */
  appointment: AppointmentStateView;
  registrationId: string;
  patientId: string;
  /** `PT-YYYY-####`. Fine in a response; never in audit metadata. */
  patientCode: string;
  isNewPatient: boolean;
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

/**
 * Turns an arrived appointment into a Registration — AP-5.
 *
 * ORDER, and why each step is where it is. It mirrors AP-4's
 * `applyStatusChange`, so the two cannot drift into answering the same question
 * differently:
 *
 *   1. Feature first, so someone whose organisation does not have Appointments
 *      is told that rather than told they lack a permission they may hold.
 *   2. Load within the caller's READ scope: unreachable is a 404 that does not
 *      confirm the appointment exists. `assertClinicInTenant` is deliberately
 *      absent — it guards routes that accept a client-supplied clinic id, and
 *      this one accepts only the appointment id, so the clinic comes off a row
 *      step 2 has already proved is in scope.
 *   3. `appointment:convert` against the appointment's OWN clinic. The only
 *      permission this path checks; see the catalogue note in lib/permissions.
 *   4. Everything derived server-side: the doctor, the department, the amount
 *      the patient was actually quoted, the visit time. The route accepts no
 *      registration fields at all.
 *   5. Advisory refusals — wrong status, already linked — before the
 *      transaction, so the ordinary mistakes are cheap and well worded.
 *   6. One READ COMMITTED transaction: the doctor-day lock, an authoritative
 *      status re-read under FOR UPDATE, the registration, the status change and
 *      the audit row. Any failure rolls back all five.
 *   7. The notification, after the commit, exactly as `createRegistration` does
 *      it: the log row is what has to be atomic with the write (PRD §9); a feed
 *      entry is not worth failing a receptionist's save over.
 */
export async function convertAppointmentToRegistration(
  actor: ActorContext,
  appointmentId: string,
): Promise<ConvertedAppointment> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const current = await getAppointmentForActor(actor, appointmentId);

  await requirePermission(actor, "appointment:convert", current.clinicId);

  // Advisory. The authoritative check is the locked re-read inside the
  // transaction; this one exists so the common mistakes cost no locks.
  const refusal = conversionRefusal(current.status);

  if (refusal) {
    throw new ConflictError(refusal);
  }

  // The doctor supplies the department, and the clinic supplies the name the
  // notification needs. Read together because both hang off the same row.
  const doctor = await prisma.doctor.findFirst({
    where: { id: current.doctorId, clinicId: current.clinicId },
    select: {
      id: true,
      name: true,
      department: true,
      clinic: { select: { id: true, name: true, tenantId: true } },
    },
  });

  // Neither can normally happen: getAppointmentForActor already filtered on the
  // tenant and the clinic relation. Refused as a 404 rather than trusted,
  // because the alternative is writing a registration under a scope nobody
  // checked.
  if (!doctor || doctor.clinic.tenantId !== actor.tenantId) {
    throw new ScopeError();
  }

  const department = departmentForConversion(doctor.department);

  if (!department) {
    throw new BadRequestError(DEPARTMENT_REQUIRED_MESSAGE);
  }

  // Defence in depth on top of the unique index. A linked appointment whose
  // status somehow was not CONVERTED would slip past the transition check.
  const alreadyLinked = await prisma.registration.findUnique({
    where: { appointmentId },
    select: { id: true },
  });

  if (alreadyLinked) {
    throw new ConflictError(ALREADY_CONVERTED_MESSAGE);
  }

  const visitType = visitTypeForConversion(current.patientId);
  const roleAtTime = await resolveRoleNameAtTime(actor, current.clinicId);
  const input = registrationInputFrom(current, department);
  const snapshot = buildCreationSnapshot(input, doctor.name, visitType);
  const before = appointmentAuditShape(current);
  const lockDate = appointmentLockDate(current.slotStart);

  // A return visit mints no code, so it cannot collide and needs no retry —
  // the same asymmetry lib/registrations.ts already applies.
  const attempts = current.patientId ? 1 : MAX_PATIENT_CODE_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await appointmentTransaction(prisma, async (tx) => {
        // Serialise against every other write touching this doctor's day. This
        // conversion changes no occupancy, and neither does check-in, yet AP-4
        // takes the lock for the same reason: it is what stops a conversion and
        // a cancellation of the same appointment from both succeeding, each
        // having read a status the other was about to change.
        await takeDoctorDayLocks(tx, [
          { doctorId: current.doctorId, date: lockDate },
        ]);

        // THE PRIMARY DOUBLE-CONVERSION GUARD. The pre-transaction checks above
        // are a check-then-act race on their own; this re-read is authoritative
        // and it is a locking read, so a competing conversion blocks here and
        // then sees CONVERTED rather than proceeding from the same stale row.
        // The unique index on registrations.appointment_id is the backstop
        // behind it, not the mechanism.
        const locked = await lockAppointmentRow(tx, appointmentId);

        if (!locked) {
          throw new ScopeError();
        }

        // Defensive: the column is a native enum, so this cannot fail unless it
        // and lib/appointmentRules.ts have drifted, which a unit test forbids.
        if (!isAppointmentStatus(locked.status)) {
          throw new ConflictError(
            "This appointment is in a state that cannot be changed.",
          );
        }

        const liveRefusal = conversionRefusal(locked.status);

        if (liveRefusal) {
          throw new ConflictError(liveRefusal);
        }

        // FR-3.1's whole creation path, called rather than copied: the Patient
        // if this is a first visit, the PT-YYYY-#### code, the Registration and
        // its first registration_edit_log row.
        const inserted = await insertRegistrationWithin(tx, actor, input, {
          existingPatientId: current.patientId,
          doctorId: current.doctorId,
          visitType,
          roleAtTime,
          snapshot,
          // Set in the SAME statement that creates the row. A follow-up update
          // would open the window the unique index exists to close.
          appointmentId,
        });

        const row = await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            status: "CONVERTED",
            // Unchanged in value — CONVERTED occupies, so this is still
            // slot_start. Written anyway because the schema's rule is that
            // every write touching `status` writes this column in the same
            // statement, and `activeSlotStartForStatus` is the only thing
            // allowed to decide it.
            activeSlotStart: activeSlotStartForStatus(
              "CONVERTED",
              current.slotStart,
            ),
          },
          select: APPOINTMENT_ROW_SELECT,
        });

        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.APPOINTMENT_CONVERTED,
          targetType: "Appointment",
          targetId: appointmentId,
          actorUserId: actor.userId,
          actorTenantId: actor.tenantId,
          beforeValue: before,
          afterValue: conversionAuditMetadata(
            appointmentAuditShape(row),
            inserted.registrationId,
          ),
        });

        return { inserted, row };
      });

      const converted: ConvertedAppointment = {
        appointment: toAppointmentStateView(result.row),
        registrationId: result.inserted.registrationId,
        patientId: result.inserted.patientId,
        patientCode: result.inserted.patientCode,
        isNewPatient: current.patientId === null,
      };

      // FR-7.1, after the commit and outside the transaction — the same trade
      // createRegistration makes, for the same reason.
      await notifyRegistrationCreated(actor, {
        registrationId: converted.registrationId,
        clinicId: current.clinicId,
        clinicName: doctor.clinic.name,
        patientName: current.name,
        patientCode: converted.patientCode,
        isNewPatient: converted.isNewPatient,
      });

      return converted;
    } catch (error: unknown) {
      // Somebody else converted this appointment between the lock and the
      // insert. Settled, not retryable.
      if (isAppointmentLinkConflict(error)) {
        throw new ConflictError(ALREADY_CONVERTED_MESSAGE);
      }

      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      // A P2002 the driver did not name. On the return-visit path no code is
      // minted, so nothing else in this transaction can collide and it is the
      // appointment link reported without a target.
      if (current.patientId) {
        throw new ConflictError(ALREADY_CONVERTED_MESSAGE);
      }

      if (attempt < attempts) {
        continue;
      }

      throw new ConflictError(PATIENT_CODE_EXHAUSTED_MESSAGE);
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has
  // one exit type rather than an implicit undefined.
  throw new ConflictError(PATIENT_CODE_EXHAUSTED_MESSAGE);
}

/**
 * The appointment's own record of the visit, in the shape FR-3.1's creation
 * path already accepts.
 *
 * EVERY FIELD COMES OFF THE APPOINTMENT. The route accepts no body, so there is
 * nothing here a caller could have supplied. Two are worth naming:
 *
 *   - `amount` is the appointment's, NOT a fresh AppointmentType lookup. The
 *     patient was quoted a price when they booked, and re-pricing the type
 *     afterwards must not silently rewrite what they owe. AP-1 copied the
 *     amount onto the appointment for exactly this moment.
 *   - `visitDate` / `visitTime` are split back out of `slot_start` with the
 *     same helpers that stored it. Both columns hold wall-clock time tagged UTC
 *     (see lib/dates.ts), so formatDateOnly + formatClockTime → parseDateTime
 *     round-trips the instant exactly, with no conversion anywhere.
 *
 * Not re-parsed through `createRegistrationSchema`: every value here was
 * validated when the appointment was booked, and re-validating stored data
 * against a schema that has since moved on would refuse a conversion for a
 * booking the system itself accepted.
 */
function registrationInputFrom(
  appointment: AppointmentRow,
  department: string,
): CreateRegistrationInput {
  return {
    clinicId: appointment.clinicId,
    patientId: appointment.patientId,
    name: appointment.name,
    age: appointment.age,
    gender: appointment.gender ?? undefined,
    mobileNumber: appointment.mobileNumber,
    address: appointment.address ?? undefined,
    city: appointment.city ?? undefined,
    doctorId: appointment.doctorId,
    department,
    amount: appointment.amount.toNumber(),
    visitDate: formatDateOnly(appointment.slotStart),
    visitTime: formatClockTime(appointment.slotStart),
    visitType: visitTypeForConversion(appointment.patientId),
  };
}
