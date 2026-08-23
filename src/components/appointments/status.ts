import type { StatusTone } from "@/components/ui/StatusPill";
import type { AppointmentStatus } from "@/lib/appointmentRules";

/**
 * How each appointment status reads and looks — AP-6.
 *
 * One table, imported by the board, the detail page and every action strip, so
 * a status cannot be worded one way in a list and another way on the page it
 * links to. The enum values themselves never reach the screen: SCREAMING_SNAKE
 * is the database's vocabulary, not the front desk's.
 *
 * TONES CARRY MEANING, not taste — the status vocabulary in
 * .claude/skills/admin-dashboard-ui:
 *
 *   warn     booked and still ahead of us, or waiting in the room — the states
 *            with something outstanding for the desk to do.
 *   ok       converted. The visit happened and is on the register.
 *   alert    cancelled, or nobody came. An outcome the desk may need to chase.
 *   neutral  moved to another slot: a fact about this row, with the action now
 *            living on its replacement.
 */
export const APPOINTMENT_STATUS_LABELS: Readonly<
  Record<AppointmentStatus, string>
> = {
  SCHEDULED: "Booked",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Arrived",
  CONVERTED: "Registered",
  CANCELLED: "Cancelled",
  NO_SHOW: "Did not attend",
  RESCHEDULED: "Moved",
};

export const APPOINTMENT_STATUS_TONES: Readonly<
  Record<AppointmentStatus, StatusTone>
> = {
  SCHEDULED: "warn",
  CONFIRMED: "warn",
  CHECKED_IN: "warn",
  CONVERTED: "ok",
  CANCELLED: "alert",
  NO_SHOW: "alert",
  RESCHEDULED: "neutral",
};

/**
 * The order the status filter offers them in: the live states first, in the
 * sequence an appointment actually passes through, then the three outcomes.
 */
export const APPOINTMENT_STATUS_ORDER: readonly AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "CONVERTED",
  "CANCELLED",
  "NO_SHOW",
  "RESCHEDULED",
];

/** "21 Dec 2026" from a "YYYY-MM-DD" the server already split out. */
export function formatAppointmentDate(date: string): string {
  // Parsed as UTC to match how the instant is stored, so the label cannot slip
  // a day for a reader west of Greenwich.
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
