import { describe, expect, it } from "vitest";
import { parseDateTime } from "@/lib/dates";
import type { AppointmentStatus } from "@/lib/appointmentRules";
import {
  computeAppointmentSlots,
  isDateOnLeave,
  isDoctorOnLeave,
  type AvailabilityWindow,
  type BookedInterval,
  type SlotComputationInput,
} from "@/lib/appointmentSlots";

/**
 * The slot engine — AP-2.
 *
 * No database, no session, no clock. Every rule the engine encodes fails
 * SILENTLY in production: a remainder wrongly offered is a patient booked into
 * time the doctor does not have, and a released appointment wrongly freezing a
 * slot is capacity nobody can find. So each one is pinned here with fixed
 * values rather than checked by inspection.
 */

const DATE = "2026-08-24";

/** The convention under test: wall-clock, tagged UTC, never converted. */
const at = (time: string, date = DATE): Date => parseDateTime(date, time);

const window = (
  startTime: string,
  endTime: string,
  date = DATE,
): AvailabilityWindow => ({ date, startTime, endTime });

const booking = (
  startTime: string,
  endTime: string,
  status: AppointmentStatus = "SCHEDULED",
  id?: string,
): BookedInterval => ({
  start: at(startTime),
  end: at(endTime),
  status,
  ...(id === undefined ? {} : { id }),
});

function compute(
  overrides: Partial<SlotComputationInput> = {},
): ReturnType<typeof computeAppointmentSlots> {
  return computeAppointmentSlots({
    date: DATE,
    durationMinutes: 30,
    availability: [],
    leave: [],
    booked: [],
    ...overrides,
  });
}

/** Slot boundaries as "09:00-09:30", which is what the assertions read best. */
const ranges = (result: { slots: { startTime: string; endTime: string }[] }) =>
  result.slots.map((slot) => `${slot.startTime}-${slot.endTime}`);

const statuses = (result: { slots: { status: string }[] }) =>
  result.slots.map((slot) => slot.status);

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

describe("availability windows", () => {
  it("fills one window exactly", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      durationMinutes: 20,
    });

    expect(result.outcome).toBe("ok");
    expect(ranges(result)).toEqual([
      "09:00-09:20",
      "09:20-09:40",
      "09:40-10:00",
    ]);
  });

  it("discards a remainder shorter than the duration", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      durationMinutes: 25,
    });

    // 09:50-10:15 would run past the doctor's last minute.
    expect(ranges(result)).toEqual(["09:00-09:25", "09:25-09:50"]);
  });

  it("returns one slot when the window is exactly the duration", () => {
    const result = compute({
      availability: [window("14:00", "14:45")],
      durationMinutes: 45,
    });

    expect(ranges(result)).toEqual(["14:00-14:45"]);
  });

  it("returns nothing, with a reason, when the window is shorter than the duration", () => {
    const result = compute({
      availability: [window("09:00", "09:20")],
      durationMinutes: 30,
    });

    expect(result.outcome).toBe("ok");
    expect(result.slots).toEqual([]);
    expect(result.discardedWindows).toEqual([
      { window: window("09:00", "09:20"), reason: "too-short-for-duration" },
    ]);
  });

  it("processes several windows and returns them in one chronological run", () => {
    const result = compute({
      // Deliberately out of order on the way in.
      availability: [window("14:00", "15:00"), window("09:00", "10:00")],
      durationMinutes: 30,
    });

    expect(ranges(result)).toEqual([
      "09:00-09:30",
      "09:30-10:00",
      "14:00-14:30",
      "14:30-15:00",
    ]);
  });

  it("keeps adjacent windows separate rather than merging them", () => {
    // Merged, 09:00-10:00 at 40 minutes would give 09:00-09:40 and stop.
    // Separate — which is how the clinic entered them, and how
    // addAvailability stores them — each window is filled on its own.
    const result = compute({
      availability: [window("09:00", "09:40"), window("09:40", "10:20")],
      durationMinutes: 40,
    });

    expect(ranges(result)).toEqual(["09:00-09:40", "09:40-10:20"]);
    expect(result.overlappingWindows).toEqual([]);
  });

  it("reports overlapping windows but still offers their hours, without duplicates", () => {
    const result = compute({
      availability: [window("09:00", "10:00"), window("09:30", "11:00")],
      durationMinutes: 30,
    });

    // 09:30-10:00 is produced by both windows and appears once.
    expect(ranges(result)).toEqual([
      "09:00-09:30",
      "09:30-10:00",
      "10:00-10:30",
      "10:30-11:00",
    ]);
    expect(result.overlappingWindows).toEqual([window("09:30", "11:00")]);
  });

  it("says no-availability when the doctor has no window that day", () => {
    const result = compute({ availability: [] });

    expect(result.outcome).toBe("no-availability");
    expect(result.slots).toEqual([]);
  });

  it("never infers a window from another date", () => {
    const result = compute({
      availability: [window("09:00", "17:00", "2026-08-23")],
    });

    expect(result.outcome).toBe("no-availability");
    expect(result.slots).toEqual([]);
    expect(result.discardedWindows).toEqual([
      { window: window("09:00", "17:00", "2026-08-23"), reason: "wrong-date" },
    ]);
  });

  it("discards a window whose end is not after its start", () => {
    const result = compute({
      availability: [window("10:00", "09:00"), window("11:00", "11:00")],
    });

    expect(result.slots).toEqual([]);
    expect(result.discardedWindows.map((entry) => entry.reason)).toEqual([
      "end-not-after-start",
      "end-not-after-start",
    ]);
  });

  it("discards a window with a malformed time instead of guessing at it", () => {
    const result = compute({
      availability: [window("9:00", "10:00"), window("09:00", "25:00")],
    });

    expect(result.slots).toEqual([]);
    expect(result.discardedWindows.map((entry) => entry.reason)).toEqual([
      "malformed-time",
      "malformed-time",
    ]);
  });

  it("still fills the good windows when a bad one sits among them", () => {
    const result = compute({
      availability: [window("09:00", "10:00"), window("12:00", "11:00")],
    });

    expect(ranges(result)).toEqual(["09:00-09:30", "09:30-10:00"]);
    expect(result.discardedWindows).toHaveLength(1);
  });

  it("collapses duplicate availability rows to one set of slots", () => {
    // The model permits them: doctor_availability has no unique constraint.
    const result = compute({
      availability: [window("09:00", "10:00"), window("09:00", "10:00")],
    });

    expect(ranges(result)).toEqual(["09:00-09:30", "09:30-10:00"]);
  });

  it("does not run a slot past the end of the day", () => {
    const result = compute({
      availability: [window("23:00", "23:59")],
      durationMinutes: 30,
    });

    expect(ranges(result)).toEqual(["23:00-23:30"]);
    // The whole reason a slot can never cross midnight: end_time tops out at
    // 23:59, and a slot must fit entirely inside the window.
    expect(result.slots.every((slot) => slot.end.getTime() <= at("23:59").getTime())).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

describe("leave", () => {
  it("treats both ends of a range as inclusive", () => {
    const range = { startDate: "2026-08-24", endDate: "2026-08-26" };

    expect(isDateOnLeave(range, "2026-08-24")).toBe(true);
    expect(isDateOnLeave(range, "2026-08-25")).toBe(true);
    expect(isDateOnLeave(range, "2026-08-26")).toBe(true);
    expect(isDateOnLeave(range, "2026-08-23")).toBe(false);
    expect(isDateOnLeave(range, "2026-08-27")).toBe(false);
  });

  it("recognises a single-day range", () => {
    expect(
      isDoctorOnLeave([{ startDate: DATE, endDate: DATE }], DATE),
    ).toBe(true);
  });

  it("offers no slots on a full day of leave, and says why", () => {
    const result = compute({
      availability: [window("09:00", "17:00")],
      leave: [{ startDate: "2026-08-20", endDate: "2026-08-28" }],
    });

    expect(result.outcome).toBe("on-leave");
    expect(result.slots).toEqual([]);
  });

  it("reports leave rather than no-availability when both would be empty", () => {
    // The doctor is off AND has no window. "on-leave" is the answer that sends
    // the receptionist to the right screen.
    const result = compute({
      availability: [],
      leave: [{ startDate: DATE, endDate: DATE }],
    });

    expect(result.outcome).toBe("on-leave");
  });

  it("ignores leave that ends before the requested date", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      leave: [{ startDate: "2026-08-20", endDate: "2026-08-23" }],
    });

    expect(result.outcome).toBe("ok");
    expect(ranges(result)).toEqual(["09:00-09:30", "09:30-10:00"]);
  });

  it("ignores leave that starts after the requested date", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      leave: [{ startDate: "2026-08-25", endDate: "2026-08-30" }],
    });

    expect(result.outcome).toBe("ok");
    expect(result.slots).toHaveLength(2);
  });

  it("takes the whole day off even when only one of several ranges matches", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      leave: [
        { startDate: "2026-01-01", endDate: "2026-01-02" },
        { startDate: DATE, endDate: DATE, reason: "training" },
      ],
    });

    expect(result.outcome).toBe("on-leave");
  });
});

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

describe("variable durations", () => {
  it.each([
    [15, ["09:00-09:15", "09:15-09:30", "09:30-09:45", "09:45-10:00"]],
    [30, ["09:00-09:30", "09:30-10:00"]],
    [45, ["09:00-09:45"]],
  ])("computes its own grid for a %i-minute type", (minutes, expected) => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      durationMinutes: minutes,
    });

    expect(ranges(result)).toEqual(expected);
  });

  it("refuses a duration outside the bounds instead of returning an empty day", () => {
    for (const minutes of [0, -30, 1, 600, 12.5]) {
      const result = compute({
        availability: [window("09:00", "17:00")],
        durationMinutes: minutes,
      });

      expect(result.outcome).toBe("invalid-duration");
      expect(result.slots).toEqual([]);
    }
  });

  it("refuses a date that is not a real calendar day", () => {
    for (const date of ["", "2026-02-30", "24-08-2026", "2026-08-24T09:00"]) {
      expect(compute({ date, availability: [window("09:00", "10:00", date)] }).outcome).toBe(
        "invalid-date",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Booked intervals
// ---------------------------------------------------------------------------

describe("booked intervals", () => {
  const day = { availability: [window("09:00", "10:30")], durationMinutes: 30 };

  it("marks a slot booked by an appointment occupying exactly it", () => {
    const result = compute({ ...day, booked: [booking("09:30", "10:00")] });

    expect(ranges(result)).toEqual([
      "09:00-09:30",
      "09:30-10:00",
      "10:00-10:30",
    ]);
    expect(statuses(result)).toEqual(["available", "booked", "available"]);
  });

  it("leaves an adjacent slot free on both sides", () => {
    const result = compute({ ...day, booked: [booking("09:30", "10:00")] });

    // Half-open: 09:00-09:30 ends exactly where the booking starts, and
    // 10:00-10:30 starts exactly where it ends.
    expect(statuses(result)).toEqual(["available", "booked", "available"]);
  });

  it("books both candidates a straddling appointment touches", () => {
    const result = compute({ ...day, booked: [booking("09:15", "09:45")] });

    expect(statuses(result)).toEqual(["booked", "booked", "available"]);
  });

  it("books a candidate an appointment merely overlaps on the left", () => {
    const result = compute({ ...day, booked: [booking("08:45", "09:15")] });

    expect(statuses(result)).toEqual(["booked", "available", "available"]);
  });

  it("books a candidate an appointment merely overlaps on the right", () => {
    const result = compute({ ...day, booked: [booking("10:15", "10:45")] });

    expect(statuses(result)).toEqual(["available", "available", "booked"]);
  });

  it("books every candidate a longer appointment contains", () => {
    const result = compute({ ...day, booked: [booking("09:00", "10:30")] });

    expect(statuses(result)).toEqual(["booked", "booked", "booked"]);
  });

  it("books a candidate that contains a shorter appointment", () => {
    const result = compute({ ...day, booked: [booking("09:35", "09:50")] });

    expect(statuses(result)).toEqual(["available", "booked", "available"]);
  });

  it("handles a booked appointment of a different length from the requested type", () => {
    // A 45-minute follow-up already booked, while a 30-minute type is being
    // offered. Nothing here assumes the two share a grid.
    const result = compute({ ...day, booked: [booking("09:20", "10:05")] });

    expect(statuses(result)).toEqual(["booked", "booked", "booked"]);
  });

  it("applies several bookings at once", () => {
    const result = compute({
      ...day,
      booked: [booking("09:00", "09:30"), booking("10:00", "10:30")],
    });

    expect(statuses(result)).toEqual(["booked", "available", "booked"]);
  });

  it("is unbothered by duplicate booked intervals", () => {
    const result = compute({
      ...day,
      booked: [booking("09:30", "10:00", "SCHEDULED", "a"), booking("09:30", "10:00", "CONFIRMED", "b")],
    });

    expect(statuses(result)).toEqual(["available", "booked", "available"]);
    // Deterministic: the earlier id wins, whatever order they arrived in.
    expect(result.slots[1]?.bookingId).toBe("a");
  });

  it("ignores an interval whose end is not after its start", () => {
    const result = compute({ ...day, booked: [booking("09:30", "09:30")] });

    expect(statuses(result)).toEqual(["available", "available", "available"]);
  });

  it("ignores an unparseable booked interval rather than freezing the day", () => {
    const result = compute({
      ...day,
      booked: [{ start: new Date("nonsense"), end: at("10:00"), status: "SCHEDULED" }],
    });

    expect(statuses(result)).toEqual(["available", "available", "available"]);
  });
});

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

describe("occupancy", () => {
  const day = { availability: [window("09:00", "09:30")], durationMinutes: 30 };

  it.each(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CONVERTED"] as const)(
    "freezes the slot for a %s appointment",
    (status) => {
      const result = compute({ ...day, booked: [booking("09:00", "09:30", status)] });
      expect(statuses(result)).toEqual(["booked"]);
    },
  );

  it.each(["CANCELLED", "NO_SHOW", "RESCHEDULED"] as const)(
    "releases the slot for a %s appointment",
    (status) => {
      const result = compute({ ...day, booked: [booking("09:00", "09:30", status)] });
      expect(statuses(result)).toEqual(["available"]);
    },
  );

  it("keeps a converted appointment's slot frozen even beside a cancelled one", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      durationMinutes: 30,
      booked: [
        booking("09:00", "09:30", "CONVERTED"),
        booking("09:30", "10:00", "CANCELLED"),
      ],
    });

    expect(statuses(result)).toEqual(["booked", "available"]);
  });

  it("defensively filters statuses even when the caller did not", () => {
    // lib/appointments.ts already asks the database for occupying statuses
    // only. This is what protects a caller that forgets to.
    const result = compute({
      availability: [window("09:00", "09:30")],
      durationMinutes: 30,
      booked: [booking("09:00", "09:30", "CANCELLED")],
    });

    expect(result.slots[0]?.status).toBe("available");
    expect(result.slots[0]?.bookingId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("the slot result", () => {
  it("carries both the Date boundaries and their clock strings, in step", () => {
    const [slot] = compute({
      availability: [window("09:00", "09:30")],
    }).slots;

    expect(slot).toBeDefined();
    expect(slot!.start.getTime()).toBe(at("09:00").getTime());
    expect(slot!.end.getTime()).toBe(at("09:30").getTime());
    expect(slot!.startTime).toBe("09:00");
    expect(slot!.endTime).toBe("09:30");
  });

  it("tags slot boundaries UTC, the way the appointments table stores them", () => {
    const [slot] = compute({ availability: [window("09:00", "09:30")] }).slots;

    // No conversion anywhere: the wall-clock time typed is the instant stored.
    expect(slot!.start.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("attaches a booking id to a booked slot and nothing to a free one", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      booked: [booking("09:00", "09:30", "SCHEDULED", "appt_1")],
    });

    expect(result.slots[0]).toMatchObject({ status: "booked", bookingId: "appt_1" });
    expect(result.slots[1]!.bookingId).toBeUndefined();
  });

  it("exposes no patient information on any slot", () => {
    const result = compute({
      availability: [window("09:00", "10:00")],
      booked: [booking("09:00", "09:30", "CHECKED_IN", "appt_1")],
    });

    const allowed = ["start", "end", "startTime", "endTime", "status", "bookingId"];

    for (const slot of result.slots) {
      expect(Object.keys(slot).every((key) => allowed.includes(key))).toBe(true);
    }
    // Named explicitly, so adding one of these to the Slot type breaks a test
    // rather than quietly shipping it to a slot picker.
    const serialised = JSON.stringify(result.slots);
    for (const leaked of ["name", "mobile", "phone", "address", "gender", "age", "patient", "amount"]) {
      expect(serialised.toLowerCase()).not.toContain(leaked);
    }
  });

  it("returns exactly the same result for the same input, every time", () => {
    const input: SlotComputationInput = {
      date: DATE,
      durationMinutes: 20,
      availability: [window("14:00", "15:00"), window("09:00", "10:00")],
      leave: [{ startDate: "2026-01-01", endDate: "2026-01-02" }],
      booked: [booking("09:10", "09:35", "CONFIRMED", "b"), booking("14:00", "14:20", "CONVERTED", "a")],
    };

    const first = computeAppointmentSlots(input);
    const second = computeAppointmentSlots(input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("gives the same answer however the booked list is ordered", () => {
    const base = {
      availability: [window("09:00", "10:00")],
      durationMinutes: 30,
    };
    const bookings = [
      booking("09:00", "09:30", "SCHEDULED", "a"),
      booking("09:30", "10:00", "CONFIRMED", "b"),
    ];

    expect(JSON.stringify(compute({ ...base, booked: bookings }).slots)).toBe(
      JSON.stringify(compute({ ...base, booked: [...bookings].reverse() }).slots),
    );
  });

  it("echoes the date and duration it was asked about", () => {
    const result = compute({ availability: [window("09:00", "10:00")], durationMinutes: 20 });

    expect(result.date).toBe(DATE);
    expect(result.durationMinutes).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Independence
// ---------------------------------------------------------------------------

describe("what the engine is not", () => {
  it("computes each doctor's day from the rows it is given, and nothing else", () => {
    // Two doctors working identical hours are two separate calls with two
    // separate booked lists. Nothing in the engine is keyed by doctor, so one
    // doctor's booking cannot reach the other's board.
    const shared = { availability: [window("09:00", "10:00")], durationMinutes: 30 };

    const first = compute({ ...shared, booked: [booking("09:00", "09:30")] });
    const second = compute({ ...shared, booked: [] });

    expect(statuses(first)).toEqual(["booked", "available"]);
    expect(statuses(second)).toEqual(["available", "available"]);
  });

  it("does not mutate the arrays it is given", () => {
    const availability = [window("14:00", "15:00"), window("09:00", "10:00")];
    const booked = [booking("14:30", "15:00"), booking("09:00", "09:30")];
    const before = JSON.stringify({ availability, booked });

    compute({ availability, booked });

    expect(JSON.stringify({ availability, booked })).toBe(before);
  });
});
