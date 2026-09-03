import { describe, expect, it } from "vitest";
import {
  getStartOfDayInTimeZone,
  resolveMessageHistoryDateRange,
  shiftDateString,
} from "@/lib/messageHistoryFilter";

describe("messageHistoryFilter helpers", () => {
  // Fixed reference date: Thursday Sep 3, 2026 10:00:00 UTC (15:30 IST)
  const refDateUtc = new Date(Date.UTC(2026, 8, 3, 10, 0, 0));

  describe("shiftDateString", () => {
    it("shifts dates across days correctly", () => {
      expect(shiftDateString("2026-09-03", 1)).toBe("2026-09-04");
      expect(shiftDateString("2026-09-03", -1)).toBe("2026-09-02");
    });

    it("handles month boundaries correctly", () => {
      expect(shiftDateString("2026-08-31", 1)).toBe("2026-09-01");
      expect(shiftDateString("2026-09-01", -1)).toBe("2026-08-31");
    });

    it("handles year boundaries correctly", () => {
      expect(shiftDateString("2026-12-31", 1)).toBe("2027-01-01");
      expect(shiftDateString("2027-01-01", -1)).toBe("2026-12-31");
    });

    it("handles leap years correctly", () => {
      expect(shiftDateString("2028-02-28", 1)).toBe("2028-02-29");
      expect(shiftDateString("2028-02-29", 1)).toBe("2028-03-01");
      expect(shiftDateString("2028-03-01", -1)).toBe("2028-02-29");
    });
  });

  describe("getStartOfDayInTimeZone", () => {
    it("computes exact midnight in Asia/Kolkata (+05:30)", () => {
      const instant = getStartOfDayInTimeZone("2026-09-03", "Asia/Kolkata");
      // 00:00 IST on Sep 3 is 18:30 UTC on Sep 2
      expect(instant.toISOString()).toBe("2026-09-02T18:30:00.000Z");
    });

    it("computes exact midnight in UTC", () => {
      const instant = getStartOfDayInTimeZone("2026-09-03", "UTC");
      expect(instant.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    });
  });

  describe("resolveMessageHistoryDateRange", () => {
    it("returns all history when range is 'all' or absent", () => {
      const res1 = resolveMessageHistoryDateRange({ range: "all", now: refDateUtc });
      expect(res1.range).toBe("all");
      expect(res1.hasActiveFilter).toBe(false);
      expect(res1.sentFrom).toBeUndefined();
      expect(res1.sentToExclusive).toBeUndefined();

      const res2 = resolveMessageHistoryDateRange({ now: refDateUtc });
      expect(res2.range).toBe("all");
      expect(res2.hasActiveFilter).toBe(false);
    });

    it("resolves 'today' boundaries in UTC", () => {
      const res = resolveMessageHistoryDateRange({
        range: "today",
        now: refDateUtc,
        timeZone: "UTC",
      });

      expect(res.range).toBe("today");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
      expect(res.formattedFrom).toBe("2026-09-03");
      expect(res.formattedTo).toBe("2026-09-03");
    });

    it("resolves 'today' boundaries in Asia/Kolkata", () => {
      const res = resolveMessageHistoryDateRange({
        range: "today",
        now: refDateUtc,
        timeZone: "Asia/Kolkata",
      });

      expect(res.range).toBe("today");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-02T18:30:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-03T18:30:00.000Z");
      expect(res.formattedFrom).toBe("2026-09-03");
      expect(res.formattedTo).toBe("2026-09-03");
    });

    it("resolves 'yesterday' boundaries in UTC", () => {
      const res = resolveMessageHistoryDateRange({
        range: "yesterday",
        now: refDateUtc,
        timeZone: "UTC",
      });

      expect(res.range).toBe("yesterday");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
      expect(res.formattedFrom).toBe("2026-09-02");
      expect(res.formattedTo).toBe("2026-09-02");
    });

    it("resolves 'this-week' (Monday through Sunday) in UTC", () => {
      // Sep 3, 2026 is Thursday. Monday is Aug 31, 2026.
      const res = resolveMessageHistoryDateRange({
        range: "this-week",
        now: refDateUtc,
        timeZone: "UTC",
      });

      expect(res.range).toBe("this-week");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-07T00:00:00.000Z");
      expect(res.formattedFrom).toBe("2026-08-31");
      expect(res.formattedTo).toBe("2026-09-06");
    });

    it("resolves 'custom' date range with both from and to in UTC", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        from: "2026-09-01",
        to: "2026-09-03",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
      expect(res.formattedFrom).toBe("2026-09-01");
      expect(res.formattedTo).toBe("2026-09-03");
    });

    it("resolves single day custom range (from == to)", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        from: "2026-09-03",
        to: "2026-09-03",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    });

    it("supports FROM ONLY custom filter", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        from: "2026-09-01",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(res.sentToExclusive).toBeUndefined();
    });

    it("supports TO ONLY custom filter", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        to: "2026-09-03",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom).toBeUndefined();
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    });

    it("flags error when from > to without crashing", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        from: "2026-09-05",
        to: "2026-09-01",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.error).toBe("From date cannot be later than To date.");
      expect(res.sentFrom).toBeUndefined();
      expect(res.sentToExclusive).toBeUndefined();
    });

    it("ignores malformed dates safely", () => {
      const res = resolveMessageHistoryDateRange({
        range: "custom",
        from: "not-a-date",
        to: "2026-09-03",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom).toBeUndefined();
      expect(res.sentToExclusive?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    });

    it("automatically selects custom mode if from or to is provided without range", () => {
      const res = resolveMessageHistoryDateRange({
        from: "2026-09-02",
        timeZone: "UTC",
      });

      expect(res.range).toBe("custom");
      expect(res.hasActiveFilter).toBe(true);
      expect(res.sentFrom?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    });
  });
});
