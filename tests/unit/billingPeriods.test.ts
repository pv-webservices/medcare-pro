import { describe, expect, it } from "vitest";
import {
  billingBucketKey,
  billingCurrentWindow,
  billingPreviousWindow,
  billingSeriesWindow,
  bucketKeyForIndiaDay,
  fromIndiaWallClock,
  toIndiaWallClock,
} from "@/lib/billing/billingPeriods";
import { bucketKeysIn } from "@/lib/reportPeriods";

/** An instant from an India clock reading, e.g. ist("2026-09-30T23:59"). */
const ist = (local: string) => new Date(`${local}:00+05:30`);

describe("India-time billing buckets", () => {
  it("round-trips instants and wall-clock readings", () => {
    const instant = ist("2026-10-01T00:01");
    expect(toIndiaWallClock(instant).toISOString()).toBe("2026-10-01T00:01:00.000Z");
    expect(fromIndiaWallClock(toIndiaWallClock(instant)).getTime()).toBe(instant.getTime());
  });

  it("splits a day at India midnight, not UTC midnight", () => {
    expect(billingBucketKey("daily", ist("2026-09-14T23:59"))).toBe("2026-09-14");
    expect(billingBucketKey("daily", ist("2026-09-15T00:01"))).toBe("2026-09-15");
    // 00:01 IST is still the previous day in UTC.
    expect(ist("2026-09-15T00:01").toISOString().slice(0, 10)).toBe("2026-09-14");
  });

  it("splits a month at India midnight", () => {
    expect(billingBucketKey("monthly", ist("2026-09-30T23:59"))).toBe("2026-09-01");
    expect(billingBucketKey("monthly", ist("2026-10-01T00:01"))).toBe("2026-10-01");
  });

  it("splits 31 March / 1 April at India midnight", () => {
    expect(billingBucketKey("daily", ist("2027-03-31T23:59"))).toBe("2027-03-31");
    expect(billingBucketKey("daily", ist("2027-04-01T00:01"))).toBe("2027-04-01");
    expect(billingBucketKey("monthly", ist("2027-03-31T23:59"))).toBe("2027-03-01");
    expect(billingBucketKey("monthly", ist("2027-04-01T00:01"))).toBe("2027-04-01");
  });

  it("splits a year and an ISO week at India midnight", () => {
    expect(billingBucketKey("yearly", ist("2026-12-31T23:59"))).toBe("2026-01-01");
    expect(billingBucketKey("yearly", ist("2027-01-01T00:01"))).toBe("2027-01-01");
    // Sunday 20 Sep 2026 ends the week of Monday 14 Sep.
    expect(billingBucketKey("weekly", ist("2026-09-20T23:59"))).toBe("2026-09-14");
    expect(billingBucketKey("weekly", ist("2026-09-21T00:01"))).toBe("2026-09-21");
  });

  it("rolls India days into the same buckets as instants", () => {
    expect(bucketKeyForIndiaDay("weekly", "2026-09-20")).toBe("2026-09-14");
    expect(bucketKeyForIndiaDay("monthly", "2027-03-31")).toBe("2027-03-01");
    expect(bucketKeyForIndiaDay("yearly", "2027-04-01")).toBe("2027-01-01");
    expect(bucketKeyForIndiaDay("daily", "2027-04-01")).toBe("2027-04-01");
  });

  it("queries India-midnight instants for the current period", () => {
    const window = billingCurrentWindow("monthly", ist("2026-10-01T00:01"));
    expect(window.wallClock.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(window.instants.start.getTime()).toBe(ist("2026-10-01T00:00").getTime());
    expect(window.instants.end.getTime()).toBe(ist("2026-11-01T00:00").getTime());
    // Half-open: 23:59 IST on 30 Sep is before the window, 00:01 IST on 1 Oct inside it.
    expect(ist("2026-09-30T23:59") < window.instants.start).toBe(true);
    expect(ist("2026-10-01T00:01") >= window.instants.start).toBe(true);
  });

  it("uses India's date for 'today' when UTC is still yesterday", () => {
    const window = billingCurrentWindow("daily", ist("2027-04-01T00:01"));
    expect(window.wallClock.start.toISOString().slice(0, 10)).toBe("2027-04-01");
    expect(window.instants.start.toISOString()).toBe("2027-03-31T18:30:00.000Z");
    expect(window.instants.end.toISOString()).toBe("2027-04-01T18:30:00.000Z");
  });

  it("builds the previous and series windows from the same boundaries", () => {
    const current = billingCurrentWindow("monthly", ist("2027-04-01T00:01"));
    const previous = billingPreviousWindow("monthly", current);
    expect(previous.instants.end.getTime()).toBe(current.instants.start.getTime());
    expect(previous.instants.start.getTime()).toBe(ist("2027-03-01T00:00").getTime());
    const series = billingSeriesWindow("monthly", ist("2027-04-01T00:01"));
    const keys = bucketKeysIn("monthly", series.wallClock);
    expect(keys).toHaveLength(12);
    expect(keys.at(-1)).toBe("2027-04-01");
    expect(series.instants.end.getTime()).toBe(current.instants.end.getTime());
  });
});
