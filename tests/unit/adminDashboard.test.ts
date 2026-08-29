import { describe, expect, it } from "vitest";
import { percentChange } from "@/lib/dashboardDateRange";
import {
  DASHBOARD_TREND_SOURCE_COLUMNS,
  dashboardBucketSql,
} from "@/lib/dashboardTrend";

describe("dashboard percentage changes", () => {
  it("returns a finite percentage for a meaningful comparison", () => {
    expect(percentChange(125, 100)).toBe(25);
    expect(percentChange(75, 100)).toBe(-25);
  });

  it("returns zero when both periods are empty", () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it("does not invent an infinite increase from no baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("dashboard trend SQL", () => {
  it("qualifies every date column with its query table alias", () => {
    expect(DASHBOARD_TREND_SOURCE_COLUMNS).toEqual({
      appointments: "a.slot_start",
      registrations: "r.visit_date",
      patients: "p.created_at",
    });
    for (const column of Object.values(DASHBOARD_TREND_SOURCE_COLUMNS)) {
      expect(column).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("uses the qualified patient column in daily and monthly SQL", () => {
    expect(dashboardBucketSql("patients", "daily").strings.join(""))
      .toBe("DATE_FORMAT(p.created_at, '%Y-%m-%d')");
    expect(dashboardBucketSql("patients", "monthly").strings.join(""))
      .toBe("DATE_FORMAT(p.created_at, '%Y-%m-01')");
  });
});
