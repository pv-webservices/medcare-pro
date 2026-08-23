import type { StatusTone } from "@/components/ui/StatusPill";

/**
 * How a bookable service reads on screen — AP-7.
 *
 * Pure, and separate from the table that renders it, for the same reason
 * components/appointments/status.ts is separate from the board: these are
 * decisions about words and numbers, and they are worth testing without a DOM.
 *
 * THE SCREEN SAYS "SERVICE", THE DATABASE SAYS "APPOINTMENT TYPE". AP-6's
 * booking form already asks the desk to "Choose a service", and the two screens
 * must not name one thing twice. The domain keeps its own word — the table is
 * `appointment_types`, the audit trail writes APPOINTMENT_TYPE_CREATED — and
 * nothing in this file leaks it to the front desk.
 */

/** What a service with no clinic is offered at: every clinic in the account. */
export const ALL_CLINICS_LABEL = "All clinics";

/**
 * A NULL clinic means tenant-wide, the same nullable-clinic convention
 * `user_roles.clinic_id` uses. Saying "All clinics" rather than leaving the
 * cell blank matters: blank reads as missing data, and this is a deliberate
 * setting somebody chose.
 */
export function scopeLabel(clinicName: string | null): string {
  return clinicName ?? ALL_CLINICS_LABEL;
}

const MINUTES_PER_HOUR = 60;

/**
 * 30 → "30 min", 60 → "1 hr", 90 → "1 hr 30 min".
 *
 * Durations run from 5 minutes to 8 hours (MIN_DURATION_MINUTES and
 * MAX_DURATION_MINUTES in lib/appointmentRules.ts), and past an hour a bare
 * minute count stops being readable at a glance — "480 min" is a number the
 * reader has to do arithmetic on before they know it means a full day.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "—";
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/**
 * Live or retired.
 *
 * NOT "deleted", because nothing here is: appointments point at a service under
 * a Restrict foreign key, so retiring is the only way to stop it being booked
 * and the bookings already made stay readable. "Retired" is the word that says
 * that; "inactive" and "disabled" both sound like something that could be
 * missing instead.
 */
export function serviceStatus(isActive: boolean): {
  label: string;
  tone: StatusTone;
} {
  return isActive
    ? { label: "Bookable", tone: "ok" }
    : { label: "Retired", tone: "neutral" };
}
