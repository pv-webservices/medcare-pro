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

/**
 * "YYYY-MM-DD" + "HH:mm" → the Date stored in `registrations.visit_date`.
 *
 * The wall-clock time the front desk types is stored verbatim, tagged UTC — the
 * same treatment the DATE columns get above. A clinic runs on one local clock,
 * so converting to a real UTC instant would only introduce drift between what
 * was typed, what is stored, and what every list and report reads back.
 */
export function parseDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

/** A Date from `visit_date` → "HH:mm" for JSON and form inputs. */
export function formatClockTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/** The current wall-clock time as "HH:mm". */
export function nowClockTime(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** Compares "HH:mm" strings; zero-padded 24h times sort lexicographically. */
export function isBefore(startTime: string, endTime: string): boolean {
  return startTime < endTime;
}

export function todayDateOnly(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The effective "now" used by appointment queries.
 *
 * Appointment slots are clinic wall-clock values tagged as UTC, not real UTC
 * instants. Rebuild the server's local calendar date and clock as that tagged
 * value before comparing it with `slotStart`; comparing a raw `new Date()`
 * would shift the operational day by the host's UTC offset.
 */
export function appointmentWallClockNow(now: Date = new Date()): Date {
  return parseDateTime(todayDateOnly(now), nowClockTime(now));
}

/** Half-open bounds for the complete appointment wall-clock day. */
export function appointmentDayBounds(now: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const start = parseDateTime(todayDateOnly(now), "00:00");
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Calendar date at an instant in an explicit IANA timezone. */
export function dateOnlyInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");

  if (!year || !month || !day) {
    throw new Error("Could not resolve the clinic-local date.");
  }

  return `${year}-${month}-${day}`;
}

/** Tomorrow as a calendar date in an explicit IANA timezone. */
export function tomorrowDateOnlyInTimeZone(
  now: Date,
  timeZone: string,
): string {
  const localDate = dateOnlyInTimeZone(now, timeZone);
  const nextDay = parseDateOnly(localDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return formatDateOnly(nextDay);
}
