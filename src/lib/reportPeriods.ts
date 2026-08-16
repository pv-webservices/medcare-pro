/**
 * Period windows and bucketing for the revenue report — PRD §6.6 (FR-6.1).
 *
 * Pure date maths, no Prisma. Everything is computed in UTC, because that is
 * how `registrations.visit_date` is stored: the wall-clock time the front desk
 * typed, tagged UTC (see src/lib/dates.ts). Doing the arithmetic in local time
 * would put a visit in a different day from the one it was entered as.
 *
 * Ranges are half-open — `[start, end)` — so a visit at 23:59 on the last day
 * of a month belongs to that month and to no other. Every range in the report
 * is built here so that boundary is decided once.
 */

export const REPORT_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** What "the period before this one" is called in the growth comparison. */
export const PREVIOUS_PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: "yesterday",
  weekly: "last week",
  monthly: "last month",
  yearly: "last year",
};

/**
 * How many buckets the growth graph plots, per granularity — enough to show a
 * trend, few enough that every bucket stays wide enough to hover.
 */
const SERIES_LENGTH: Record<ReportPeriod, number> = {
  daily: 14,
  weekly: 12,
  monthly: 12,
  yearly: 5,
};

/** Half-open: `start` is included, `end` is not. */
export interface DateRange {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Exact in UTC — no daylight-saving discontinuity to trip over. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMonths(date: Date, months: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function addYears(date: Date, years: number): Date {
  return utcDate(date.getUTCFullYear() + years, 0, 1);
}

function startOfDay(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** ISO weeks start on Monday. */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return addDays(day, -mondayOffset);
}

function startOfMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfYear(date: Date): Date {
  return utcDate(date.getUTCFullYear(), 0, 1);
}

/** The start of the bucket `date` falls in, for the given granularity. */
export function startOfPeriod(period: ReportPeriod, date: Date): Date {
  switch (period) {
    case "daily":
      return startOfDay(date);
    case "weekly":
      return startOfWeek(date);
    case "monthly":
      return startOfMonth(date);
    case "yearly":
      return startOfYear(date);
  }
}

/** One bucket forward from a bucket start. */
function nextBucket(period: ReportPeriod, start: Date): Date {
  switch (period) {
    case "daily":
      return addDays(start, 1);
    case "weekly":
      return addDays(start, 7);
    case "monthly":
      return addMonths(start, 1);
    case "yearly":
      return addYears(start, 1);
  }
}

/** One bucket back from a bucket start. */
function previousBucket(period: ReportPeriod, start: Date): Date {
  switch (period) {
    case "daily":
      return addDays(start, -1);
    case "weekly":
      return addDays(start, -7);
    case "monthly":
      return addMonths(start, -1);
    case "yearly":
      return addYears(start, -1);
  }
}

/** FR-6.1 — the period the report is reporting on: the one containing `now`. */
export function currentRange(period: ReportPeriod, now: Date): DateRange {
  const start = startOfPeriod(period, now);
  return { start, end: nextBucket(period, start) };
}

/** The equivalent window immediately before, for the growth comparison. */
export function previousRange(period: ReportPeriod, range: DateRange): DateRange {
  return { start: previousBucket(period, range.start), end: range.start };
}

/** FR-6.3 — the window the growth graph covers, ending with the current bucket. */
export function seriesRange(period: ReportPeriod, now: Date): DateRange {
  const current = currentRange(period, now);
  let start = current.start;

  for (let step = 1; step < SERIES_LENGTH[period]; step += 1) {
    start = previousBucket(period, start);
  }

  return { start, end: current.end };
}

/** "YYYY-MM-DD" — the key a bucket is identified by, matching the SQL grouping. */
export function bucketKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Every bucket key in a range, in order.
 *
 * The graph is built from this rather than from whatever the database returned,
 * so a period with no visits shows as a zero rather than vanishing and letting
 * the line skip a week.
 */
export function bucketKeysIn(period: ReportPeriod, range: DateRange): string[] {
  const keys: string[] = [];

  for (
    let cursor = range.start;
    cursor < range.end;
    cursor = nextBucket(period, cursor)
  ) {
    keys.push(bucketKey(cursor));
  }

  return keys;
}

function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  // en-GB and an explicit UTC zone: the label must name the stored day, not the
  // day it happens to be wherever the page is being rendered or read.
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    date,
  );
}

/** Short form, for an axis tick where space is tight. */
export function bucketLabel(period: ReportPeriod, key: string): string {
  const date = parseKey(key);

  switch (period) {
    case "daily":
      return format(date, { day: "numeric", month: "short" });
    case "weekly":
      return format(date, { day: "numeric", month: "short" });
    case "monthly":
      return format(date, { month: "short" });
    case "yearly":
      return format(date, { year: "numeric" });
  }
}

/** Unambiguous form, for tooltips and the table view. */
export function bucketFullLabel(period: ReportPeriod, key: string): string {
  const date = parseKey(key);

  switch (period) {
    case "daily":
      return format(date, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    case "weekly":
      return `Week of ${format(date, { day: "numeric", month: "short", year: "numeric" })}`;
    case "monthly":
      return format(date, { month: "long", year: "numeric" });
    case "yearly":
      return format(date, { year: "numeric" });
  }
}

/** Names the window the KPIs cover, e.g. "August 2026". */
export function rangeLabel(period: ReportPeriod, range: DateRange): string {
  return bucketFullLabel(period, bucketKey(range.start));
}
