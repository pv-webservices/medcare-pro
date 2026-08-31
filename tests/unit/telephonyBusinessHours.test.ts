import { describe, expect, it } from "vitest";
import {
  CLINIC_BUSINESS_WEEKDAYS,
  normalizeClinicBusinessHours,
  resolveClinicBusinessState,
  updateClinicBusinessHoursSchema,
  type ClinicBusinessHoursDay,
} from "@/lib/telephony/businessHours";
import { resolveEffectiveTelephonyRoute } from "@/lib/telephony/routing";

function week(
  open: Partial<Record<(typeof CLINIC_BUSINESS_WEEKDAYS)[number], [string, string]>> = {},
): ClinicBusinessHoursDay[] {
  return CLINIC_BUSINESS_WEEKDAYS.map((dayOfWeek) => {
    const interval = open[dayOfWeek];
    return interval
      ? {
          dayOfWeek,
          isClosed: false,
          openTime: interval[0],
          closeTime: interval[1],
        }
      : { dayOfWeek, isClosed: true, openTime: null, closeTime: null };
  });
}

function parseWeek(hours = week({ MONDAY: ["09:00", "17:00"] })) {
  return updateClinicBusinessHoursSchema.parse({ hours }).hours;
}

describe("Stage 7 weekly business-hours validation", () => {
  it("accepts one ordered open interval and six closed days", () => {
    expect(parseWeek()).toHaveLength(7);
  });

  it("canonicalizes meaningless times on a closed day to null", () => {
    const input = week();
    input[0] = {
      dayOfWeek: "MONDAY",
      isClosed: true,
      openTime: "09:00",
      closeTime: "17:00",
    };
    expect(parseWeek(input)[0]).toEqual({
      dayOfWeek: "MONDAY",
      isClosed: true,
      openTime: null,
      closeTime: null,
    });
  });

  it.each([
    ["non-clock opening", "9am", "17:00"],
    ["out-of-range opening", "25:00", "17:00"],
    ["out-of-range closing", "09:00", "12:99"],
    ["missing opening", null, "17:00"],
    ["missing closing", "09:00", null],
    ["equal times", "09:00", "09:00"],
    ["overnight/reversed times", "22:00", "06:00"],
  ])("rejects %s", (_case, openTime, closeTime) => {
    const input = week();
    input[0] = {
      dayOfWeek: "MONDAY",
      isClosed: false,
      openTime,
      closeTime,
    } as ClinicBusinessHoursDay;
    expect(() => parseWeek(input)).toThrow();
  });

  it("rejects a duplicate weekday and therefore a missing weekday", () => {
    const input = week();
    input[6] = { ...input[6], dayOfWeek: "MONDAY" };
    expect(() => parseWeek(input)).toThrow();
  });

  it("returns weekdays in stable Monday-to-Sunday order", () => {
    const input = [...week()].reverse();
    expect(parseWeek(input).map((day) => day.dayOfWeek)).toEqual(
      CLINIC_BUSINESS_WEEKDAYS,
    );
  });

  it("fails closed for malformed legacy stored hours", () => {
    const result = normalizeClinicBusinessHours([
      {
        dayOfWeek: "MONDAY",
        isClosed: false,
        openTime: "17:00",
        closeTime: "09:00",
      },
    ]);
    expect(result[0].isClosed).toBe(true);
  });
});

describe("Stage 7 clinic-local open and next-opening resolver", () => {
  const monday = week({
    MONDAY: ["09:00", "17:00"],
    TUESDAY: ["09:00", "17:00"],
  });

  it.each([
    ["one minute before opening", "2026-08-31T03:29:00.000Z", false],
    ["the exact opening minute", "2026-08-31T03:30:00.000Z", true],
    ["during the interval", "2026-08-31T07:00:00.000Z", true],
    ["one minute before closing", "2026-08-31T11:29:00.000Z", true],
    ["the exact closing minute", "2026-08-31T11:30:00.000Z", false],
    ["after closing", "2026-08-31T12:30:00.000Z", false],
  ])("uses half-open interval semantics at %s", (_case, instant, isOpen) => {
    expect(
      resolveClinicBusinessState({
        now: new Date(instant),
        timezone: "Asia/Kolkata",
        hours: monday,
      }).isOpen,
    ).toBe(isOpen);
  });

  it("returns later today as the next opening before the clinic opens", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-08-31T03:29:00.000Z"),
      timezone: "Asia/Kolkata",
      hours: monday,
    });
    expect(state.nextOpening).toEqual({
      dayOfWeek: "MONDAY",
      dayOffset: 0,
      openTime: "09:00",
    });
  });

  it("returns tomorrow after today's closing", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-08-31T12:30:00.000Z"),
      timezone: "Asia/Kolkata",
      hours: monday,
    });
    expect(state.nextOpening).toMatchObject({
      dayOfWeek: "TUESDAY",
      dayOffset: 1,
    });
  });

  it("crosses the Sunday/Monday and week boundary", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-09-06T12:30:00.000Z"),
      timezone: "Asia/Kolkata",
      hours: week({ MONDAY: ["09:00", "17:00"] }),
    });
    expect(state.localWeekday).toBe("SUNDAY");
    expect(state.nextOpening).toMatchObject({
      dayOfWeek: "MONDAY",
      dayOffset: 1,
    });
  });

  it("finds the same weekday one week later within one cycle", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-08-31T12:30:00.000Z"),
      timezone: "Asia/Kolkata",
      hours: week({ MONDAY: ["09:00", "17:00"] }),
    });
    expect(state.nextOpening?.dayOffset).toBe(7);
  });

  it("returns null without looping when every day is closed", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-08-31T03:30:00.000Z"),
      timezone: "Asia/Kolkata",
      hours: week(),
    });
    expect(state).toMatchObject({
      isOpen: false,
      hasRegularHours: false,
      nextOpening: null,
    });
  });

  it("uses a timezone behind UTC across month and year boundaries", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2027-01-01T02:00:00.000Z"),
      timezone: "America/Los_Angeles",
      hours: week({ THURSDAY: ["17:00", "19:00"] }),
    });
    expect(state).toMatchObject({
      localWeekday: "THURSDAY",
      localTime: "18:00",
      isOpen: true,
    });
  });

  it("handles a DST-zone instant without machine-local timezone dependence", () => {
    const state = resolveClinicBusinessState({
      now: new Date("2026-03-08T13:30:00.000Z"),
      timezone: "America/New_York",
      hours: week({ SUNDAY: ["09:00", "10:00"] }),
    });
    expect(state).toMatchObject({
      localWeekday: "SUNDAY",
      localTime: "09:30",
      isOpen: true,
    });
  });

  it("can route the same instant differently for different clinic timezones", () => {
    const instant = new Date("2027-01-01T02:00:00.000Z");
    const hours = week({ FRIDAY: ["07:00", "08:00"] });
    const kolkata = resolveClinicBusinessState({
      now: instant,
      timezone: "Asia/Kolkata",
      hours,
    });
    const losAngeles = resolveClinicBusinessState({
      now: instant,
      timezone: "America/Los_Angeles",
      hours,
    });
    expect(kolkata.isOpen).toBe(true);
    expect(losAngeles.isOpen).toBe(false);
  });
});

describe("Stage 7 effective routing policy", () => {
  it("forces IVR in AFTER_HOURS even when business state is open", () => {
    expect(
      resolveEffectiveTelephonyRoute({
        routingMode: "AFTER_HOURS",
        businessState: { isOpen: true },
      }),
    ).toBe("IVR");
  });

  it("forces reception in OPEN even when business state is closed", () => {
    expect(
      resolveEffectiveTelephonyRoute({
        routingMode: "OPEN",
        businessState: { isOpen: false },
      }),
    ).toBe("RECEPTION");
  });

  it.each([
    [true, "RECEPTION"],
    [false, "IVR"],
  ] as const)("routes AUTO isOpen=%s to %s", (isOpen, expected) => {
    expect(
      resolveEffectiveTelephonyRoute({
        routingMode: "AUTO",
        businessState: { isOpen },
      }),
    ).toBe(expected);
  });
});
