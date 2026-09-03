import { dateOnlyInTimeZone, isDateOnly } from "@/lib/dates";

export const DEFAULT_HISTORY_TIMEZONE = "Asia/Kolkata";

export const MESSAGE_HISTORY_RANGES = [
  "all",
  "today",
  "yesterday",
  "this-week",
  "custom",
] as const;

export type MessageHistoryRange = (typeof MESSAGE_HISTORY_RANGES)[number];

export interface MessageHistoryFilterInput {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
  timeZone?: string;
}

export interface ResolvedMessageHistoryFilter {
  range: MessageHistoryRange;
  sentFrom?: Date;
  sentToExclusive?: Date;
  formattedFrom?: string; // YYYY-MM-DD
  formattedTo?: string;   // YYYY-MM-DD
  error?: string;
  hasActiveFilter: boolean;
}

/**
 * Shifts a "YYYY-MM-DD" calendar date by whole days using UTC calendar arithmetic.
 * Correctly handles month boundaries, year boundaries, and leap years.
 */
export function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 0, 0, 0));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolves the exact UTC instant corresponding to 00:00:00 on the given
 * calendar day in the specified IANA timezone.
 */
export function getStartOfDayInTimeZone(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(utcGuess);
  const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  const localAsUtc = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
  );

  const offsetMs = localAsUtc - utcGuess.getTime();
  let adjusted = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);

  // DST refinement step
  const checkParts = formatter.formatToParts(adjusted);
  const getCheckPart = (type: string) =>
    Number(checkParts.find((p) => p.type === type)?.value);
  const checkAsUtc = Date.UTC(
    getCheckPart("year"),
    getCheckPart("month") - 1,
    getCheckPart("day"),
    getCheckPart("hour"),
    getCheckPart("minute"),
    getCheckPart("second"),
  );
  const diff = checkAsUtc - Date.UTC(y, m - 1, d, 0, 0, 0);
  if (diff !== 0) {
    adjusted = new Date(adjusted.getTime() - diff);
  }

  return adjusted;
}

/**
 * Resolves a date filter for Message History into server-side query boundaries.
 * All ranges are half-open: [sentFrom, sentToExclusive).
 */
export function resolveMessageHistoryDateRange(
  input: MessageHistoryFilterInput,
): ResolvedMessageHistoryFilter {
  const timeZone = input.timeZone || DEFAULT_HISTORY_TIMEZONE;
  const now = input.now ?? new Date();

  const rawRange = input.range?.trim().toLowerCase();
  const rawFrom = input.from?.trim();
  const rawTo = input.to?.trim();

  const validFrom = rawFrom && isDateOnly(rawFrom) ? rawFrom : undefined;
  const validTo = rawTo && isDateOnly(rawTo) ? rawTo : undefined;

  let range: MessageHistoryRange = "all";

  if (rawRange && MESSAGE_HISTORY_RANGES.includes(rawRange as MessageHistoryRange)) {
    range = rawRange as MessageHistoryRange;
  } else if (validFrom || validTo) {
    range = "custom";
  }

  if (range === "all") {
    return {
      range: "all",
      hasActiveFilter: false,
    };
  }

  if (range === "today") {
    const localToday = dateOnlyInTimeZone(now, timeZone);
    const sentFrom = getStartOfDayInTimeZone(localToday, timeZone);
    const nextDay = shiftDateString(localToday, 1);
    const sentToExclusive = getStartOfDayInTimeZone(nextDay, timeZone);

    return {
      range: "today",
      sentFrom,
      sentToExclusive,
      formattedFrom: localToday,
      formattedTo: localToday,
      hasActiveFilter: true,
    };
  }

  if (range === "yesterday") {
    const localToday = dateOnlyInTimeZone(now, timeZone);
    const localYesterday = shiftDateString(localToday, -1);
    const sentFrom = getStartOfDayInTimeZone(localYesterday, timeZone);
    const sentToExclusive = getStartOfDayInTimeZone(localToday, timeZone);

    return {
      range: "yesterday",
      sentFrom,
      sentToExclusive,
      formattedFrom: localYesterday,
      formattedTo: localYesterday,
      hasActiveFilter: true,
    };
  }

  if (range === "this-week") {
    // ISO calendar week: Monday through Sunday
    const localToday = dateOnlyInTimeZone(now, timeZone);
    const parsedUtc = new Date(`${localToday}T00:00:00.000Z`);
    // getUTCDay: Sunday = 0, Monday = 1, ..., Saturday = 6
    const dayOfWeek = (parsedUtc.getUTCDay() + 6) % 7; // Monday = 0, ..., Sunday = 6
    const monday = shiftDateString(localToday, -dayOfWeek);
    const nextMonday = shiftDateString(monday, 7);
    const sunday = shiftDateString(monday, 6);

    const sentFrom = getStartOfDayInTimeZone(monday, timeZone);
    const sentToExclusive = getStartOfDayInTimeZone(nextMonday, timeZone);

    return {
      range: "this-week",
      sentFrom,
      sentToExclusive,
      formattedFrom: monday,
      formattedTo: sunday,
      hasActiveFilter: true,
    };
  }

  // range === "custom"
  if (validFrom && validTo && validFrom > validTo) {
    return {
      range: "custom",
      formattedFrom: validFrom,
      formattedTo: validTo,
      error: "From date cannot be later than To date.",
      hasActiveFilter: true,
    };
  }

  const sentFrom = validFrom
    ? getStartOfDayInTimeZone(validFrom, timeZone)
    : undefined;
  const sentToExclusive = validTo
    ? getStartOfDayInTimeZone(shiftDateString(validTo, 1), timeZone)
    : undefined;

  const hasActiveFilter = Boolean(sentFrom || sentToExclusive);

  return {
    range: "custom",
    sentFrom,
    sentToExclusive,
    formattedFrom: validFrom,
    formattedTo: validTo,
    hasActiveFilter,
  };
}
