import type { DuesAgeBucket } from "./invoiceValidation";

/** FR-11.18 ages count India calendar days since issue, not elapsed 24-hour spans. */
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;

function istDayNumber(instant: Date): number {
  return Math.floor((instant.getTime() + IST_OFFSET_MS) / DAY_MS);
}
function istMidnightDaysAgo(now: Date, days: number): Date {
  return new Date((istDayNumber(now) - days) * DAY_MS - IST_OFFSET_MS);
}

export function daysSinceIssue(issuedAt: Date, now: Date): number {
  return Math.max(0, istDayNumber(now) - istDayNumber(issuedAt));
}
export function duesAgeBucket(days: number): DuesAgeBucket {
  return days <= 7 ? "0-7" : days <= 30 ? "8-30" : "31+";
}
/** The issued_at window whose India-time age falls in the bucket. */
export function issuedAtRangeForBucket(bucket: DuesAgeBucket, now: Date): { gte?: Date; lt?: Date } {
  if (bucket === "0-7") return { gte: istMidnightDaysAgo(now, 7) };
  if (bucket === "8-30") return { gte: istMidnightDaysAgo(now, 30), lt: istMidnightDaysAgo(now, 7) };
  return { lt: istMidnightDaysAgo(now, 30) };
}
