/**
 * Date-only and clock-time helpers.
 *
 * `doctor_availability.date`, `doctor_leave.start_date` and `end_date` are SQL
 * DATE columns — a calendar day with no time and no zone. JavaScript has no
 * date-only type, so a naive `new Date("2026-08-20")` parsed in a timezone
 * behind UTC lands on the 19th once it round-trips. Everything here pins those
 * values to UTC midnight so the day a user picks is the day that gets stored.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  // Rejects real-looking but invalid days such as 2026-02-30.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && formatDateOnly(parsed) === value;
}

/** "HH:mm" on a 24-hour clock. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

/** "YYYY-MM-DD" → the Date stored in a DATE column. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A Date from a DATE column → "YYYY-MM-DD" for JSON and form inputs. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Compares "HH:mm" strings; zero-padded 24h times sort lexicographically. */
export function isBefore(startTime: string, endTime: string): boolean {
  return startTime < endTime;
}

/** Today as "YYYY-MM-DD", in UTC to match how the dates are stored. */
export function todayDateOnly(now: Date = new Date()): string {
  return formatDateOnly(now);
}
