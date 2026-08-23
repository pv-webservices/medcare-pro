import {
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from "@/lib/appointmentRules";

/**
 * Correcting a booking's details — AP-9.
 *
 * PURE: no Prisma, no Next.js, no database, no environment. Same reasoning as
 * lib/appointmentRules.ts, and it applies with extra force here. An edit rule
 * that is wrong does not throw — it quietly rewrites a field it should have
 * left alone, or leaves one it should have changed, and nobody finds out until
 * a patient is phoned on a number that was corrected in the wrong row.
 *
 * WHAT AN EDIT IS FOR. The desk took the booking over the phone and misheard a
 * name, or typed a digit wrong, or quoted the wrong price. That is a
 * correction of the SNAPSHOT this appointment carries. It is not a move
 * (`appointment:reschedule`), not a change of service or doctor (a re-book),
 * and not a change of state (`applyStatusChange`).
 *
 * THE THREE AP-1 RULES ARE WHY THE EDITABLE SET IS SO SMALL:
 *
 *   1. No row is ever deleted — nothing here deletes, and an edit leaves the
 *      same row with the same id.
 *   2. slot_start / slot_end are NEVER updated. This is the rule that keeps
 *      `doctorId`, `appointmentTypeId`, `slotStart` and `slotEnd` out of the
 *      editable set: changing any of them changes when or with whom the
 *      patient is seen, and that is a reschedule, which creates a second row.
 *   3. Occupancy is derived from status in exactly one column. Nothing here
 *      touches `status` or `active_slot_start`, so an edit cannot change
 *      whether the slot is busy — which is what lets it skip the doctor-day
 *      lock entirely. See lib/appointmentEdit.ts.
 */

// ---------------------------------------------------------------------------
// What may be corrected
// ---------------------------------------------------------------------------

export type EditableField =
  | "name"
  | "mobileNumber"
  | "age"
  | "gender"
  | "address"
  | "city"
  | "amount";

/**
 * Canonical order — the order the fields appear on the booking form, so an
 * audit row's `changedFields` reads the way the screen does rather than in
 * whatever order the client happened to send.
 */
export const EDITABLE_FIELDS: readonly EditableField[] = [
  "name",
  "mobileNumber",
  "age",
  "gender",
  "address",
  "city",
  "amount",
];

/**
 * Everything an edit must never touch, listed so a unit test can assert the
 * two sets together account for every column a correction could plausibly aim
 * at — an omission here is a field silently becoming editable later.
 *
 * `patientId` is on this list and it is the one worth explaining: re-pointing a
 * booking at a different patient record is not a typo fix, it is re-assigning
 * a visit to another person, and it would move the money with it at
 * conversion. If a booking is against the wrong patient, cancel it and book
 * again.
 */
export const LOCKED_FIELDS: readonly string[] = [
  "id",
  "tenantId",
  "clinicId",
  "doctorId",
  "appointmentTypeId",
  "patientId",
  "slotStart",
  "slotEnd",
  "activeSlotStart",
  "status",
  "bookedById",
  "checkedInAt",
  "checkedInById",
  "cancelledAt",
  "cancelledById",
  "cancellationReason",
  "rescheduledFromId",
];

/** The editable columns of one appointment, as they read back from the row. */
export interface AppointmentEditSnapshot {
  name: string;
  mobileNumber: string;
  age: number | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  /** 2-decimal string, matching how the Decimal(10,2) column reads back. */
  amount: string;
}

/**
 * A partial correction, as it arrives from the client.
 *
 * ABSENT MEANS UNCHANGED. A blank string on one of the optional text fields
 * means CLEARED, which is the same thing a blank means on the booking form
 * (`blankToNull` in lib/appointments.ts), and an explicit null on `age` means
 * cleared too. Written as its own interface rather than imported from the zod
 * schema so this module stays free of the input layer; tsc checks the two
 * agree at the one call site, and a unit test pins it.
 */
export interface AppointmentEditPatch {
  name?: string;
  mobileNumber?: string;
  age?: number | null;
  gender?: string;
  address?: string;
  city?: string;
  amount?: number;
}

// ---------------------------------------------------------------------------
// When it may be corrected
// ---------------------------------------------------------------------------

/**
 * The states in which a booking may still be corrected.
 *
 * This is the OCCUPYING set minus CONVERTED, and the subtraction is the whole
 * rule: a converted appointment has already produced a Registration that
 * copied its name, number and amount, so editing the booking afterwards would
 * leave the visit on the register disagreeing with the booking it came from,
 * with nothing able to detect it. Corrections after conversion belong to
 * `registration:edit`, which writes a per-field before/after row into
 * `registration_edit_log` — a better trail than this one can offer.
 *
 * CHECKED_IN is included deliberately. Noticing a misspelt name is exactly
 * what happens when the patient walks up to the desk and reads it.
 */
export const EDITABLE_STATUSES: readonly AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
];

export function isEditableStatus(status: AppointmentStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export const NON_EDITABLE_STATUSES: readonly AppointmentStatus[] =
  APPOINTMENT_STATUSES.filter((status) => !EDITABLE_STATUSES.includes(status));

/**
 * Why a correction was refused, phrased for the person at the desk and — where
 * there is one — naming the place the correction should be made instead.
 *
 * A refusal that only says no leaves somebody re-clicking. Each of these says
 * where the live record actually is.
 */
const NOT_EDITABLE: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "",
  CONFIRMED: "",
  CHECKED_IN: "",
  CONVERTED:
    "This appointment has already been registered as a visit. Correct the details on the registration instead — changing the booking now would leave the two disagreeing about the same patient.",
  CANCELLED:
    "This appointment is cancelled, so there is nothing left to correct. Book the patient again if they still need to be seen.",
  NO_SHOW:
    "This appointment is marked as not attended, so there is nothing left to correct. Book the patient again if they still need to be seen.",
  RESCHEDULED:
    "This booking was moved to another slot. Open the appointment that replaced it and correct that one — a change here would never reach the patient's live booking.",
};

export const NO_CHANGES_MESSAGE =
  "Nothing was changed. Edit at least one detail before saving.";

/** Null when this appointment may be corrected; otherwise the reason it may not. */
export function editRefusal(status: AppointmentStatus): string | null {
  return isEditableStatus(status) ? null : NOT_EDITABLE[status];
}

// ---------------------------------------------------------------------------
// Applying and diffing
// ---------------------------------------------------------------------------

/** Blank is how an HTML form says "not filled in", which is null in the database. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The snapshot a patch would produce, without touching anything absent from it.
 *
 * ONE PLACE decides what "absent", "blank" and "null" each mean, so the API,
 * the diff and the audit row cannot disagree about whether a field was cleared
 * or simply not sent.
 *
 * `amount` is fixed to two decimals here rather than at the database, because
 * the comparison in `diffAppointmentEdit` is a string comparison against a
 * column that reads back as `"500.00"` — leaving it as `500` would report a
 * change on every save.
 */
export function applyAppointmentEdit(
  before: AppointmentEditSnapshot,
  patch: AppointmentEditPatch,
): AppointmentEditSnapshot {
  return {
    name: patch.name === undefined ? before.name : patch.name.trim(),
    mobileNumber:
      patch.mobileNumber === undefined
        ? before.mobileNumber
        : patch.mobileNumber.trim(),
    // Nullish rather than undefined-only: an explicit null clears the age,
    // where an absent key leaves whatever was there.
    age: patch.age === undefined ? before.age : patch.age,
    gender: patch.gender === undefined ? before.gender : blankToNull(patch.gender),
    address:
      patch.address === undefined ? before.address : blankToNull(patch.address),
    city: patch.city === undefined ? before.city : blankToNull(patch.city),
    amount: patch.amount === undefined ? before.amount : patch.amount.toFixed(2),
  };
}

/**
 * Which fields a correction actually changes, in canonical order.
 *
 * An empty result is the caller's signal to refuse rather than write: a save
 * that changes nothing should not leave an audit row claiming an edit
 * happened, and `{}` and "typed the same name back" are the same non-event.
 */
export function diffAppointmentEdit(
  before: AppointmentEditSnapshot,
  after: AppointmentEditSnapshot,
): EditableField[] {
  return EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);
}

/**
 * The changed fields as one audit-safe string.
 *
 * FIELD NAMES, NEVER VALUES, and that is the AP-3 rule holding: `audit_log` is
 * append-only and is read during support work, so it records that a booking's
 * mobile number was corrected — never what it was corrected from or to. The
 * literal word "name" appearing here is the name of a COLUMN, not a patient's.
 *
 * `amount` is the deliberate exception, and it is the caller that logs it: a
 * price is a commercial fact this trail already carries from AP-3's booking
 * row, and "who changed the price?" is unanswerable without the two numbers.
 */
export function formatChangedFields(changed: readonly EditableField[]): string {
  return changed.join(", ");
}
