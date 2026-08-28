/**
 * Dashboard date-range presets and utilities.
 *
 * All ranges are half-open [start, end) in UTC, matching the convention in
 * reportPeriods.ts. The "previous" period for comparison is always the
 * immediately preceding window of equal duration.
 */

export const DASHBOARD_PRESETS = [
  "today",
  "last7",
  "last30",
  "thisMonth",
  "lastMonth",
  "thisYear",
] as const;

export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

export const PRESET_LABELS: Record<DashboardPreset, string> = {
  today: "Today",
  last7: "Last 7 days",
  last30: "Last 30 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  thisYear: "This year",
};

export interface DateRange {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function startOfDay(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfYear(date: Date): Date {
  return utcDate(date.getUTCFullYear(), 0, 1);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMonths(date: Date, months: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

export function presetRange(
  preset: DashboardPreset,
  now: Date = new Date(),
): DateRange {
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { start: today, end: addDays(today, 1) };
    case "last7":
      return { start: addDays(today, -6), end: addDays(today, 1) };
    case "last30":
      return { start: addDays(today, -29), end: addDays(today, 1) };
    case "thisMonth": {
      const ms = startOfMonth(now);
      return { start: ms, end: addMonths(ms, 1) };
    }
    case "lastMonth": {
      const ms = startOfMonth(now);
      return { start: addMonths(ms, -1), end: ms };
    }
    case "thisYear": {
      const ys = startOfYear(now);
      return { start: ys, end: addMonths(ys, 12) };
    }
  }
}

export function previousPeriod(range: DateRange): DateRange {
  const durationMs = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: range.start,
  };
}

export function comparisonLabel(preset: DashboardPreset): string {
  switch (preset) {
    case "today":
      return "vs yesterday";
    case "last7":
      return "vs previous 7 days";
    case "last30":
      return "vs previous 30 days";
    case "thisMonth":
      return "vs last month";
    case "lastMonth":
      return "vs month before";
    case "thisYear":
      return "vs last year";
  }
}

export type TrendInterval = "daily" | "monthly";

export function trendInterval(preset: DashboardPreset): TrendInterval {
  return preset === "thisYear" ? "monthly" : "daily";
}

export function parsePreset(
  value: string | null | undefined,
): DashboardPreset {
  if (
    value &&
    (DASHBOARD_PRESETS as readonly string[]).includes(value)
  ) {
    return value as DashboardPreset;
  }
  return "thisMonth";
}

/**
 * Every bucket key in a range for the given interval. Keys are "YYYY-MM-DD".
 * Zero-fills: a date with no data still appears so the chart line is continuous.
 */
export function bucketKeysInRange(
  interval: TrendInterval,
  range: DateRange,
): string[] {
  const keys: string[] = [];
  let cursor = range.start;

  while (cursor < range.end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor =
      interval === "daily" ? addDays(cursor, 1) : addMonths(cursor, 1);
  }

  return keys;
}

function fmt(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: "UTC",
  }).format(date);
}

export function bucketLabel(
  interval: TrendInterval,
  key: string,
): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (interval === "monthly") {
    return fmt(date, { month: "short" });
  }
  return fmt(date, { day: "numeric", month: "short" });
}
