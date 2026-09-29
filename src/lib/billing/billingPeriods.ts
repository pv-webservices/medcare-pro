import {
  bucketKey,
  currentRange,
  previousRange,
  seriesRange,
  startOfPeriod,
  type DateRange,
  type ReportPeriod,
} from "@/lib/reportPeriods";

/**
 * India-time report windows for billing instants — FR-11.23.
 *
 * reportPeriods.ts buckets `registrations.visit_date`, which is a wall-clock
 * time tagged UTC. `invoices.issued_at` and `invoice_payments.received_at` are
 * real instants, so they are moved to India wall-clock first (+5:30; India has
 * no daylight saving) and the SAME period helpers then decide the bucket. Range
 * bounds go the other way (−5:30) before they reach the database. Every billing
 * report boundary is decided here, once.
 */

export const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** The India wall-clock reading of an instant, tagged UTC like visit_date. */
export function toIndiaWallClock(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MS);
}

/** The instant at which India's clocks show `wallClock`. */
export function fromIndiaWallClock(wallClock: Date): Date {
  return new Date(wallClock.getTime() - IST_OFFSET_MS);
}

/** "YYYY-MM-DD" key of the India-time bucket an instant falls in. */
export function billingBucketKey(period: ReportPeriod, instant: Date): string {
  return bucketKey(startOfPeriod(period, toIndiaWallClock(instant)));
}

/**
 * The bucket key of an India calendar day ("YYYY-MM-DD"). The database groups
 * instants by India day (instant + IST_OFFSET_MINUTES); this rolls those days
 * into weeks, months and years with the same helper.
 */
export function bucketKeyForIndiaDay(period: ReportPeriod, dayKey: string): string {
  return bucketKey(startOfPeriod(period, new Date(`${dayKey}T00:00:00.000Z`)));
}

/** A window both ways: wall-clock for keys and labels, instants for queries. */
export interface BillingWindow {
  wallClock: DateRange;
  instants: DateRange;
}

function billingWindow(wallClock: DateRange): BillingWindow {
  return {
    wallClock,
    instants: { start: fromIndiaWallClock(wallClock.start), end: fromIndiaWallClock(wallClock.end) },
  };
}

/** The reported period containing `now` in India. */
export function billingCurrentWindow(period: ReportPeriod, now: Date): BillingWindow {
  return billingWindow(currentRange(period, toIndiaWallClock(now)));
}

/** The equivalent period immediately before, for the comparison. */
export function billingPreviousWindow(period: ReportPeriod, current: BillingWindow): BillingWindow {
  return billingWindow(previousRange(period, current.wallClock));
}

/** The chart's window, ending with the current India-time bucket. */
export function billingSeriesWindow(period: ReportPeriod, now: Date): BillingWindow {
  return billingWindow(seriesRange(period, toIndiaWallClock(now)));
}
