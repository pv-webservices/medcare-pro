/**
 * The appointment lifecycle and interval rules — AP-1.
 *
 * PURE: no Prisma, no Auth.js, no Next.js, no database, no environment. Same
 * reasoning as lib/moduleFeatures.ts — the rules encoded here are exactly the
 * sort that break silently. A status transition that should have been refused
 * does not throw, it just corrupts a doctor's day; an occupancy mapping that
 * disagrees with itself in two places does not throw either, it double-books.
 * Keeping this free of I/O means a unit test can hold every rule on every run.
 *
 * This module is the SINGLE SOURCE of the status semantics. AP-2 computes slots
 * on top of it, AP-3 books, AP-4 moves and retires, AP-5 converts. None of them
 * should restate a rule from here; they should call it.
 *
 * Nothing here talks to the database, so nothing here is concurrency-safe on
 * its own. `intervalsOverlap` answers "do these two ranges collide?", which is
 * necessary but not sufficient: two requests can both be told "no collision"
 * and both insert. See the DoctorScheduleLock model in prisma/schema.prisma for
 * the lock that closes that window.
 */

import { formatDateOnly } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Mirrors the `AppointmentStatus` enum in prisma/schema.prisma.
 *
 * Declared here as a string-literal union rather than imported from
 * @prisma/client so this module stays pure and testable without a generated
 * client. A unit test asserts the two agree, so they cannot drift.
 */
export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "CONVERTED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";

export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "CONVERTED",
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
];

/**
 * The statuses in which an appointment still holds the doctor's time.
 *
 * CONVERTED IS HERE ON PURPOSE. A converted appointment is a patient who
 * arrived and was seen — the time was genuinely consumed. Releasing it would
 * let a second booking land in a slot where a visit demonstrably happened, and
 * would silently corrupt any doctor-utilisation figure built on this table.
 *
 * NO_SHOW is deliberately NOT here: the patient did not come, so the time is
 * free. The visible consequence is that a past slot becomes bookable again,
 * which is harmless and occasionally useful for backfilling a walk-in.
 */
export const OCCUPYING_STATUSES: readonly AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "CONVERTED",
];

/** The statuses in which the slot is released and re-bookable. */
export const RELEASING_STATUSES: readonly AppointmentStatus[] = [
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
];

/** Statuses from which no transition is allowed. An appointment ends here. */
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  "CONVERTED",
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
];

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether this status still occupies the doctor's time.
 *
 * The one place that question is answered. AP-3's overlap query filters on
 * OCCUPYING_STATUSES, and `activeSlotStartForStatus` below derives the sentinel
 * column from this same predicate, so the index and the query can never
 * disagree about what "busy" means.
 */
export function isOccupyingAppointmentStatus(
  status: AppointmentStatus,
): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/**
 * The value `appointments.active_slot_start` must hold for a given status.
 *
 * Every write that changes `status` must write this column in the same
 * statement. The pairing is what makes the partial-unique workaround correct:
 * an occupying row mirrors its start time and so collides with a duplicate; a
 * released row holds NULL, and MySQL treats NULLs as distinct, so any number of
 * retired rows may share a doctor and a start time.
 *
 * `slotStart` is passed rather than read off the row because AP-3 needs this
 * answer before the row exists.
 */
export function activeSlotStartForStatus(
  status: AppointmentStatus,
  slotStart: Date,
): Date | null {
  return isOccupyingAppointmentStatus(status) ? slotStart : null;
}

/**
 * Which statuses each status may move to.
 *
 * Read as: booked (SCHEDULED) may be confirmed by the patient; either of those
 * may become an arrival, a cancellation, a no-show, or a move to a different
 * slot; only an arrival may be converted into a registration, because
 * conversion records a visit that happened.
 *
 * The four terminal states map to empty arrays rather than being absent, so a
 * caller reading this table gets "nothing is allowed" rather than `undefined`.
 *
 * RESCHEDULED is terminal for THIS row. The move creates a new row that points
 * back at this one; it never reopens the original. See rule 2 in the schema
 * header — slot_start and slot_end are never updated after insert.
 */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW", "RESCHEDULED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW", "RESCHEDULED"],
  CHECKED_IN: ["CONVERTED", "CANCELLED", "NO_SHOW"],
  CONVERTED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

/**
 * Whether an appointment may move from one status to another.
 *
 * Self-transitions are refused: re-cancelling a cancelled appointment is a
 * no-op at best and a double-write of `cancelledAt` at worst, so callers should
 * treat it as the conflict it is rather than silently succeeding.
 */
export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export function isTerminalAppointmentStatus(
  status: AppointmentStatus,
): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

/**
 * Half-open [start, end): two appointments that touch end-to-start do NOT
 * overlap, so 09:00-09:30 and 09:30-10:00 both fit.
 *
 * The same convention lib/doctors.ts already applies to availability windows.
 * Using a different one here would make a slot computed from an availability
 * window fail to fit back inside it at the boundary.
 *
 * NOT A CONCURRENCY CONTROL. This answers a question about two known ranges;
 * it says nothing about a range some other transaction is inserting right now.
 */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/** Reasons an interval is not a valid appointment slot. */
export type AppointmentIntervalProblem =
  | "invalid-date"
  | "end-not-after-start"
  | "spans-two-days";

/**
 * Validates a slot's start/end pair, returning the problem or null.
 *
 * Returns a reason rather than a boolean so the API layer can say WHICH rule
 * was broken instead of a bare "invalid slot".
 *
 * `spans-two-days` matters more than it looks. It is what makes
 * (doctorId, date) a complete lock key: if an appointment could straddle
 * midnight, two conflicting appointments could sit on different dates and
 * serialise on different lock rows, and the DoctorScheduleLock protocol would
 * have a hole in it. DoctorAvailability cannot express an overnight window
 * anyway — its end_time tops out at 23:59 — so nothing is lost by refusing it.
 */
export function appointmentIntervalProblem(
  slotStart: Date,
  slotEnd: Date,
): AppointmentIntervalProblem | null {
  if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) {
    return "invalid-date";
  }
  // Also rejects zero-length intervals, which would occupy no time and overlap
  // nothing — an appointment nobody could ever detect a conflict with.
  if (slotEnd.getTime() <= slotStart.getTime()) {
    return "end-not-after-start";
  }
  if (formatDateOnly(slotStart) !== formatDateOnly(slotEnd)) {
    return "spans-two-days";
  }
  return null;
}

export function isValidAppointmentInterval(
  slotStart: Date,
  slotEnd: Date,
): boolean {
  return appointmentIntervalProblem(slotStart, slotEnd) === null;
}

/**
 * The calendar day an appointment belongs to — the `date` half of its
 * DoctorScheduleLock key.
 *
 * Derived from `slotStart` alone, which is only well defined because
 * `appointmentIntervalProblem` refuses an interval that spans two days. Callers
 * must validate the interval first.
 */
export function appointmentLockDate(slotStart: Date): string {
  return formatDateOnly(slotStart);
}

/**
 * Orders lock keys so two transactions competing for the same pair take them in
 * the same sequence.
 *
 * A booking touches one doctor-day and cannot deadlock. A reschedule touches
 * two — the slot being vacated and the one being taken, possibly under
 * different doctors — and would deadlock against its own mirror image without
 * a deterministic order. Ascending (doctorId, date), and a unit test pins it.
 */
export function compareLockKeys(
  a: { doctorId: string; date: string },
  b: { doctorId: string; date: string },
): number {
  if (a.doctorId !== b.doctorId) {
    return a.doctorId < b.doctorId ? -1 : 1;
  }
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }
  return 0;
}

/**
 * De-duplicates and sorts the lock keys a write needs.
 *
 * A reschedule within the same doctor-day yields one key, not two — taking the
 * same lock twice in one transaction is harmless in InnoDB but obscures how
 * many rows are actually held.
 */
export function orderLockKeys(
  keys: readonly { doctorId: string; date: string }[],
): { doctorId: string; date: string }[] {
  const seen = new Map<string, { doctorId: string; date: string }>();
  for (const key of keys) {
    seen.set(`${key.doctorId} ${key.date}`, key);
  }
  return [...seen.values()].sort(compareLockKeys);
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Duration bounds for an AppointmentType, in minutes.
 *
 * Five minutes is the shortest slot worth booking; eight hours is a full
 * working day and anything longer is a data-entry error, not a consultation.
 * Neither is enforced by the database — the column is a plain INT — so these
 * are the only guard.
 */
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 8 * 60;

export function isValidAppointmentDuration(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_DURATION_MINUTES &&
    minutes <= MAX_DURATION_MINUTES
  );
}

/**
 * The largest value a Decimal(10, 2) column holds: eight digits before the
 * point and two after. Matches the bound lib/registrations.ts applies to
 * `amount`, because the two columns are the same type and one is copied from
 * the other at conversion.
 */
export const MAX_APPOINTMENT_AMOUNT = 99_999_999.99;

/**
 * Zero is allowed — a free follow-up or a courtesy consultation is a real
 * thing a clinic books. Negative is not: a refund is not an appointment.
 */
export function isValidAppointmentAmount(amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  if (amount < 0 || amount > MAX_APPOINTMENT_AMOUNT) return false;
  // Decimal(10, 2) silently ROUNDS a third decimal place rather than refusing
  // it, so 10.005 would be quoted to the patient and stored as 10.01. This is
  // one rule stricter than lib/registrations.ts's amountSchema, which bounds
  // the range but not the scale — a price list is set once and read many times,
  // so it is worth refusing here rather than discovering the rounding later.
  return Math.round(amount * 100) / 100 === amount;
}

/**
 * Whether the minutes between start and end match the type's declared duration.
 *
 * AP-2 computes slot boundaries from the duration, so a mismatch means the slot
 * was assembled by hand or the type was re-timed after the slot was offered.
 */
export function matchesDuration(
  slotStart: Date,
  slotEnd: Date,
  durationMinutes: number,
): boolean {
  const actual = (slotEnd.getTime() - slotStart.getTime()) / 60_000;
  return actual === durationMinutes;
}

// ---------------------------------------------------------------------------
// Scope predicates
// ---------------------------------------------------------------------------

/**
 * Whether an appointment type may be used for a booking at a given clinic.
 *
 * NULL clinicId means tenant-wide — the same convention `user_roles.clinic_id`
 * uses. Note what this does NOT do: it takes the tenant id as an argument
 * rather than trusting one off the request. The caller must derive it from the
 * session, as every route in this codebase already does.
 */
export function isAppointmentTypeUsableAt(
  type: { tenantId: string; clinicId: string | null; isActive: boolean },
  actorTenantId: string,
  clinicId: string,
): boolean {
  if (type.tenantId !== actorTenantId) return false;
  if (!type.isActive) return false;
  return type.clinicId === null || type.clinicId === clinicId;
}

/**
 * The tenant/clinic consistency an appointment row must satisfy.
 *
 * `tenantId` is denormalised onto the appointment (see the schema note), so it
 * can disagree with the clinic it points at if a write sets it by hand. This is
 * the check that catches that, and the verify script runs it over real rows.
 */
export function isAppointmentScopeConsistent(input: {
  appointmentTenantId: string;
  clinicTenantId: string;
  appointmentClinicId: string;
  doctorClinicId: string;
  patientTenantId?: string | null;
}): boolean {
  if (input.appointmentTenantId !== input.clinicTenantId) return false;
  if (input.appointmentClinicId !== input.doctorClinicId) return false;
  if (
    input.patientTenantId != null &&
    input.patientTenantId !== input.appointmentTenantId
  ) {
    return false;
  }
  return true;
}
