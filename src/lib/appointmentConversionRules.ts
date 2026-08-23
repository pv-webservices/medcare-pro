import { Prisma } from "@prisma/client";
import { appointmentTransitionRefusal } from "@/lib/appointmentInput";
import {
  APPOINTMENT_STATUSES,
  canTransitionAppointment,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
// Type-only, and therefore erased at compile time: this module stays free of
// lib/registrations.ts's Prisma import, which is what lets the unit suite load
// it with no database. VISIT_TYPES stays the single source of the closed list.
import type { VisitType } from "@/lib/registrations";

/**
 * The conversion rules that can be decided without a database — AP-5.
 *
 * PURE: no Prisma client, no session, no Next.js. The same split
 * lib/appointmentRules.ts already draws, and the reason is the same — these are
 * the rules that fail silently. A department that quietly became empty does not
 * throw, it drops a visit out of every FR-6.4 departmental total; a convertible
 * status set that drifts from the transition table does not throw either, it
 * lets a cancelled appointment become revenue.
 *
 * lib/appointmentConversion.ts holds the operation: the locks, the transaction,
 * the writes. Everything here is a question about values, so a unit test can
 * hold every one of them on every run with nothing stood up.
 */

/**
 * The statuses an appointment may be converted FROM.
 *
 * DERIVED from ALLOWED_STATUS_TRANSITIONS, never hand-listed. That table is the
 * single source of the lifecycle, and a literal here would be a second one free
 * to disagree with it — the exact failure the rules module exists to prevent. A
 * unit test pins the derived value at ["CHECKED_IN"], so widening the table is
 * a deliberate, visible change rather than a silent one.
 *
 * Today that is CHECKED_IN alone: CHECK-IN IS MANDATORY. Conversion records a
 * visit that happened, and arriving is what makes a visit real. Letting a
 * receptionist convert a walk-through in one motion is a change to AP-1's
 * transition table, not something this stage may decide on its own.
 */
export const CONVERTIBLE_STATUSES: readonly AppointmentStatus[] =
  APPOINTMENT_STATUSES.filter((status) =>
    canTransitionAppointment(status, "CONVERTED"),
  );

export function canConvertAppointment(status: AppointmentStatus): boolean {
  return CONVERTIBLE_STATUSES.includes(status);
}

/**
 * Why this appointment cannot be converted, or null if it can.
 *
 * Delegates to the shared refusal builder, so a receptionist reads the same
 * sentence structure here as when a cancellation is refused, and an already
 * converted booking is named as such rather than described by enum value.
 */
export function conversionRefusal(status: AppointmentStatus): string | null {
  return appointmentTransitionRefusal(status, "CONVERTED");
}

/**
 * The message a loser sees, whichever guard catches it.
 *
 * Deliberately the same sentence `appointmentTransitionRefusal` produces for an
 * already-CONVERTED source, so the two racing receptionists and the one who
 * clicked twice are told the same thing — a unit test pins them equal.
 */
export const ALREADY_CONVERTED_MESSAGE =
  "This appointment has already been converted to a registration.";

/** Said when every attempt at a fresh `PT-YYYY-####` lost a race. */
export const PATIENT_CODE_EXHAUSTED_MESSAGE =
  "Could not allocate a Patient ID just now. Try saving again.";

export const DEPARTMENT_REQUIRED_MESSAGE =
  "This doctor has no department set. Add one before converting the appointment.";

/**
 * The registration's department, taken from the doctor seeing the patient — or
 * null when there is none to take.
 *
 * NEVER DEFAULTED. `registrations.department` is a required column and FR-6.4
 * breaks revenue down by it, so a blank one would be a row that quietly falls
 * out of every departmental total. `doctors.department` is NOT NULL in the
 * schema and lib/doctors.ts validates it non-empty, so no supported path
 * produces one — this exists for a row that reached the table another way, and
 * it reports the absence rather than inventing a value.
 *
 * Returns null instead of throwing so this module stays free of the API error
 * classes, which pull in next/server. The caller turns null into a 400.
 */
export function departmentForConversion(
  doctorDepartment: string | null | undefined,
): string | null {
  const department = doctorDepartment?.trim();

  return department ? department : null;
}

/**
 * NEW for a first visit, FOLLOW_UP for someone already on the register.
 *
 * The same derivation lib/registrations.ts applies at the desk, and the same
 * closed list: `visit_type` is validated against VISIT_TYPES, so conversion
 * does NOT invent an "APPOINTMENT" value to mark where a visit came from.
 * `registrations.appointment_id` already records that, and it is a foreign key
 * rather than a string every report would have to learn about.
 */
export function visitTypeForConversion(
  existingPatientId: string | null,
): VisitType {
  return existingPatientId ? "FOLLOW_UP" : "NEW";
}

/**
 * The audit row's "after" side: the scheduling fact plus ONE id.
 *
 * Takes the appointment's audit shape rather than the row, so this stays pure
 * and the shape keeps being built in the one place AP-3 and AP-4 already build
 * it — the trail must describe a conversion the same way it describes a
 * cancellation.
 *
 * No patient name, number, address, age, gender or patient id, and above all no
 * `PT-YYYY-####` code: the trail is append-only and is read during support
 * work. `assertSafeAuditMetadata` throws on a key containing "code" anyway,
 * which is the mechanism doing the remembering rather than whoever edits this
 * next — and a unit test runs the real assertion over this exact payload.
 */
export function conversionAuditMetadata(
  appointmentShape: Record<string, string | number | boolean | null>,
  registrationId: string,
): Record<string, string | number | boolean | null> {
  return { ...appointmentShape, registrationId };
}

// ---------------------------------------------------------------------------
// Telling the two unique indexes apart
// ---------------------------------------------------------------------------

/** The constraint a P2002 names, as a plain string. "" when it names none. */
export function uniqueConstraintTarget(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return "";
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;

  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.join(",");
  return "";
}

/**
 * A second conversion of the same appointment, caught by the database.
 *
 * `registrations.appointment_id` is UNIQUE, and that index is the last line of
 * defence: the status re-read under `FOR UPDATE` is the primary guard, but the
 * index is what holds even if a future path forgets the lock.
 *
 * MUST NEVER BE RETRIED, which is the whole reason this function exists. The
 * conversion transaction can raise a P2002 from two different indexes — this
 * one, and `patients(tenant_id, patient_code)` when two first visits pick the
 * same next code. The second is retryable and the first is settled, and
 * retrying a settled one would ask the database the same question five times
 * and then report it as a patient-numbering problem.
 */
export function isAppointmentLinkConflict(error: unknown): boolean {
  return uniqueConstraintTarget(error).includes("appointment_id");
}
