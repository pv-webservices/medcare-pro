import { describe, expect, it } from "vitest";
import {
  dateOnlyInTimeZone,
  tomorrowDateOnlyInTimeZone,
} from "@/lib/dates";

describe("clinic-local appointment dates", () => {
  it("uses the Asia/Kolkata calendar date across a UTC boundary", () => {
    const now = new Date("2026-08-31T20:00:00.000Z");

    expect(dateOnlyInTimeZone(now, "Asia/Kolkata")).toBe("2026-09-01");
    expect(tomorrowDateOnlyInTimeZone(now, "Asia/Kolkata")).toBe(
      "2026-09-02",
    );
  });

  it("uses a timezone behind UTC instead of the server calendar", () => {
    const now = new Date("2026-09-01T02:00:00.000Z");

    expect(dateOnlyInTimeZone(now, "America/Los_Angeles")).toBe(
      "2026-08-31",
    );
    expect(tomorrowDateOnlyInTimeZone(now, "America/Los_Angeles")).toBe(
      "2026-09-01",
    );
  });

  it.each([
    ["month", "2026-04-30T12:00:00.000Z", "UTC", "2026-05-01"],
    ["year", "2026-12-31T12:00:00.000Z", "UTC", "2027-01-01"],
    ["leap year", "2028-02-28T12:00:00.000Z", "UTC", "2028-02-29"],
    ["after leap day", "2028-02-29T12:00:00.000Z", "UTC", "2028-03-01"],
  ] as const)("crosses a %s boundary", (_label, instant, zone, expected) => {
    expect(tomorrowDateOnlyInTimeZone(new Date(instant), zone)).toBe(expected);
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      dateOnlyInTimeZone(new Date("2026-08-31T00:00:00.000Z"), "Not/AZone"),
    ).toThrow();
  });
});
