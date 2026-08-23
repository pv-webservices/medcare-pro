import {
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import type { TemplateValues } from "@/lib/whatsappTemplateText";

/**
 * When an appointment reminder may be sent, and what it says — AP-8, and PURE.
 *
 * Same split this module family has kept since AP-2: the rules about whether a
 * thing is allowed live apart from the code that does it, so they can be tested
 * without a database, a session or a gateway. lib/appointmentReminders.ts does
 * the sending and reaches all three.
 *
 * A REMINDER IS FOR A SLOT STILL AHEAD OF THE PATIENT. That is the whole rule
 * below, and every refusal is a way of not being that: they have already
 * arrived, the visit already happened, or the slot is void.
 */

/**
 * The two states worth reminding someone about.
 *
 * Derived from nothing — stated. `OCCUPYING_STATUSES` would be the tempting
 * shortcut and it is wrong: it includes CHECKED_IN and CONVERTED, and texting
 * "don't forget your appointment" to somebody sitting in the waiting room is
 * exactly the kind of message that gets a sending number reported.
 */
export const REMINDABLE_STATUSES: readonly AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
];

export function isRemindableStatus(status: AppointmentStatus): boolean {
  return REMINDABLE_STATUSES.includes(status);
}

export const NO_PATIENT_MESSAGE =
  "This booking has no patient record yet, so a message cannot be filed against it. Register the patient, or re-book them as an existing patient, and the reminder becomes available.";

/**
 * Why a reminder cannot go, phrased for the person at the desk — or null when
 * it can.
 *
 * STATUS IS JUDGED BEFORE THE PATIENT RECORD. Both can be wrong at once, and
 * the status is the fact that will not change: telling somebody to register a
 * patient whose appointment was cancelled last week sends them to do a thing
 * that will not help.
 */
export function reminderRefusal(
  status: AppointmentStatus,
  hasPatientRecord: boolean,
): string | null {
  if (!isRemindableStatus(status)) {
    return NOT_REMINDABLE[status];
  }

  if (!hasPatientRecord) {
    return NO_PATIENT_MESSAGE;
  }

  return null;
}

/**
 * One sentence per state that cannot be reminded. Every state that is not in
 * REMINDABLE_STATUSES needs an entry, and the unit test holds that.
 */
const NOT_REMINDABLE: Readonly<Record<AppointmentStatus, string>> = {
  // The two remindable ones never reach this table; entries kept so the Record
  // stays exhaustive and a new status cannot be added without a decision.
  SCHEDULED: "",
  CONFIRMED: "",
  CHECKED_IN:
    "This patient has already arrived, so a reminder would reach them in the waiting room.",
  CONVERTED:
    "This appointment has already been registered as a visit. There is nothing left to remind them about.",
  CANCELLED: "This appointment is cancelled, so there is nothing to remind them about.",
  NO_SHOW:
    "This appointment is already marked as missed. Book a new one rather than reminding them about this.",
  RESCHEDULED:
    "This appointment has been moved. Send the reminder from the slot that replaced it.",
};

/** Every status that is not remindable, for the tests and for the UI. */
export const NON_REMINDABLE_STATUSES: readonly AppointmentStatus[] =
  APPOINTMENT_STATUSES.filter((status) => !isRemindableStatus(status));

/** What an appointment reminder knows about the booking it is reminding of. */
export interface ReminderFacts {
  patientName: string;
  patientCode: string | null;
  clinicName: string;
  doctorName: string;
  department: string;
  serviceName: string;
  /** "YYYY-MM-DD", read back off the slot by the caller. */
  slotDate: string;
  /** "HH:mm", likewise. */
  slotTime: string;
}

/**
 * The values a reminder template renders against.
 *
 * THE VISIT GROUP IS DELIBERATELY ABSENT. `visitDate`, `visitTime` and `amount`
 * describe a registration that has already happened; this message is about a
 * slot that has not. Filling them from the patient's last visit would put a
 * date in a reminder that is real, plausible and wrong — so a template using
 * them here renders MISSING_VALUE instead, which is visible.
 *
 * `department` and `doctorName` come from the appointment's own doctor, not
 * from any past visit, so they are safe to fill and are what the patient needs
 * in order to know where to go.
 */
export function reminderTemplateValues(facts: ReminderFacts): TemplateValues {
  return {
    patientName: facts.patientName,
    // Undefined rather than empty: renderTemplate turns a known placeholder
    // with no value into an em dash, which is the honest rendering.
    patientCode: facts.patientCode ?? undefined,
    clinicName: facts.clinicName,
    doctorName: facts.doctorName,
    department: facts.department,
    appointmentDate: facts.slotDate,
    appointmentTime: facts.slotTime,
    serviceName: facts.serviceName,
  };
}
