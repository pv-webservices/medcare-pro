import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  ALLOWED_STATUS_TRANSITIONS,
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  RELEASING_STATUSES,
  TERMINAL_STATUSES,
  activeSlotStartForStatus,
  canTransitionAppointment,
  compareLockKeys,
  orderLockKeys,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  MAX_CANCELLATION_REASON,
  appointmentTransitionRefusal,
  cancelAppointmentSchema,
  rescheduleAppointmentSchema,
} from "@/lib/appointmentInput";
import { doctorDayLockId, isDeadlockError } from "@/lib/appointmentLocks";

/**
 * AP-4 — the lifecycle rules that can be checked without a database.
 *
 * The same split AP-2 and AP-3 used, for the same reason: what a request may
 * contain, which transitions are legal, and how a refusal is phrased are all
 * decisions worth holding on every run, and none of them needs MySQL. What
 * genuinely needs a database — the locks, the overlap query, two receptionists
 * cancelling at once — is proved against real racing transactions in
 * scripts/verify-ap4-appointment-lifecycle.mts instead.
 */

const ALL: readonly AppointmentStatus[] = APPOINTMENT_STATUSES;

const A_SLOT = {
  slotStart: "2026-11-09T09:00:00.000Z",
  slotEnd: "2026-11-09T09:30:00.000Z",
};

// ---------------------------------------------------------------------------
// Cancelling and no-shows: the same body
// ---------------------------------------------------------------------------

describe("cancelAppointmentSchema", () => {
  it("accepts an empty body, because cancelling without a reason is ordinary", () => {
    expect(cancelAppointmentSchema.parse({})).toEqual({});
  });

  it("accepts a reason", () => {
    expect(cancelAppointmentSchema.parse({ reason: "Patient rang, unwell" })).toEqual(
      { reason: "Patient rang, unwell" },
    );
  });

  it("trims a reason", () => {
    expect(cancelAppointmentSchema.parse({ reason: "  double booked  " })).toEqual({
      reason: "double booked",
    });
  });

  it("accepts a reason of exactly the maximum length", () => {
    const reason = "x".repeat(MAX_CANCELLATION_REASON);
    expect(cancelAppointmentSchema.parse({ reason }).reason).toHaveLength(
      MAX_CANCELLATION_REASON,
    );
  });

  it("refuses a reason longer than the maximum", () => {
    const reason = "x".repeat(MAX_CANCELLATION_REASON + 1);
    expect(() => cancelAppointmentSchema.parse({ reason })).toThrow();
  });

  it("bounds the reason well short of the TEXT column, so it stays a note", () => {
    // The column would take megabytes. The cap is what keeps a cancellation
    // note from becoming a case history in a table that is not a clinical
    // record and must not turn into one.
    expect(MAX_CANCELLATION_REASON).toBeLessThanOrEqual(1000);
    expect(MAX_CANCELLATION_REASON).toBeGreaterThan(100);
  });

  it("STRIPS a client-supplied status", () => {
    // Which outcome happened is decided by which endpoint was called. If this
    // survived, one permission check would stand in front of two different
    // results and a caller could pick between them.
    const parsed = cancelAppointmentSchema.parse({
      reason: "no answer",
      status: "CONVERTED",
    });
    expect(parsed).not.toHaveProperty("status");
  });

  it("STRIPS cancelledById, cancelledAt and appointmentId", () => {
    const parsed = cancelAppointmentSchema.parse({
      cancelledById: "someone-else",
      cancelledAt: "2020-01-01T00:00:00.000Z",
      appointmentId: "another-appointment",
    });
    expect(parsed).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

describe("rescheduleAppointmentSchema", () => {
  it("accepts a bare slot move", () => {
    expect(rescheduleAppointmentSchema.parse({ ...A_SLOT })).toEqual({ ...A_SLOT });
  });

  it("accepts a move to a different doctor", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      doctorId: "doctor-2",
    });
    expect(parsed.doctorId).toBe("doctor-2");
  });

  it("trims the doctor id", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      doctorId: "  doctor-2  ",
    });
    expect(parsed.doctorId).toBe("doctor-2");
  });

  it("refuses a blank doctor id rather than reading it as 'keep the same one'", () => {
    // Absent means keep the current doctor. An empty string is a form that
    // failed to fill itself in, and treating the two the same would hide it.
    expect(() =>
      rescheduleAppointmentSchema.parse({ ...A_SLOT, doctorId: "   " }),
    ).toThrow();
  });

  it("requires both ends of the new slot", () => {
    expect(() =>
      rescheduleAppointmentSchema.parse({ slotStart: A_SLOT.slotStart }),
    ).toThrow();
    expect(() =>
      rescheduleAppointmentSchema.parse({ slotEnd: A_SLOT.slotEnd }),
    ).toThrow();
  });

  it("accepts both spellings of a whole-minute Z instant", () => {
    expect(() =>
      rescheduleAppointmentSchema.parse({
        slotStart: "2026-11-09T09:00Z",
        slotEnd: "2026-11-09T09:30:00.000Z",
      }),
    ).not.toThrow();
  });

  it("refuses a time with no timezone at all", () => {
    // "2026-11-09 09:00" is local time in some engines and invalid in others.
    // This project tags wall-clock times as UTC and never converts them.
    expect(() =>
      rescheduleAppointmentSchema.parse({
        slotStart: "2026-11-09T09:00:00",
        slotEnd: "2026-11-09T09:30:00",
      }),
    ).toThrow();
  });

  it("refuses a non-Z offset", () => {
    expect(() =>
      rescheduleAppointmentSchema.parse({
        slotStart: "2026-11-09T09:00:00+05:30",
        slotEnd: "2026-11-09T09:30:00+05:30",
      }),
    ).toThrow();
  });

  it("refuses sub-minute precision", () => {
    // No availability window can align with 09:00:30, so accepting one would
    // accept a boundary the slot engine can never offer.
    expect(() =>
      rescheduleAppointmentSchema.parse({
        slotStart: "2026-11-09T09:00:30.000Z",
        slotEnd: "2026-11-09T09:30:30.000Z",
      }),
    ).toThrow();
  });

  it("STRIPS the clinic, so a move cannot cross sites", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      clinicId: "another-clinic",
    });
    expect(parsed).not.toHaveProperty("clinicId");
  });

  it("STRIPS the appointment type, so a move cannot change the service", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      appointmentTypeId: "a-longer-and-dearer-one",
    });
    expect(parsed).not.toHaveProperty("appointmentTypeId");
  });

  it("STRIPS the amount, so a move cannot re-price the appointment", () => {
    const parsed = rescheduleAppointmentSchema.parse({ ...A_SLOT, amount: 0 });
    expect(parsed).not.toHaveProperty("amount");
  });

  it("STRIPS every patient field, so a move is not a back door into a record", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      patientId: "someone-else",
      name: "Someone Else",
      mobileNumber: "+91 90000 00000",
      age: 44,
      gender: "F",
      address: "Elsewhere",
      city: "Elsewhere",
    });
    expect(parsed).toEqual({ ...A_SLOT });
  });

  it("STRIPS status, activeSlotStart, tenantId and bookedById", () => {
    const parsed = rescheduleAppointmentSchema.parse({
      ...A_SLOT,
      status: "CONVERTED",
      activeSlotStart: null,
      tenantId: "another-tenant",
      bookedById: "another-user",
      rescheduledFromId: "another-appointment",
    });
    expect(parsed).toEqual({ ...A_SLOT });
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("appointmentTransitionRefusal", () => {
  it("refuses exactly the transitions the rules table refuses", () => {
    // The whole 7x7 grid. This is the assertion that stops the messages and the
    // rules from drifting: a message may never permit something the table does
    // not, and the table may never permit something that then has no message.
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = canTransitionAppointment(from, to);
        const refusal = appointmentTransitionRefusal(from, to);

        if (allowed) {
          expect(refusal, `${from} -> ${to} should be allowed`).toBeNull();
        } else {
          expect(refusal, `${from} -> ${to} should be refused`).toBeTruthy();
        }
      }
    }
  });

  it("never produces a message with a hole in it", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const refusal = appointmentTransitionRefusal(from, to);
        if (refusal === null) continue;

        expect(refusal).not.toContain("undefined");
        expect(refusal).not.toContain("null");
        expect(refusal.endsWith(".")).toBe(true);
        expect(refusal.length).toBeGreaterThan(20);
      }
    }
  });

  it("names the state the appointment is actually in, and nothing else", () => {
    // No competing appointment, no colleague, no timestamp. Who cancelled it
    // and when lives on the appointment, behind appointment:read.
    const refusal = appointmentTransitionRefusal("CANCELLED", "CHECKED_IN");
    expect(refusal).toContain("cancelled");
    expect(refusal).toMatch(/cannot be checked in/);
  });

  it("treats redoing something already done as a refusal, not a silent success", () => {
    // Re-cancelling would be a no-op at best and a second write of cancelledAt
    // and cancelledById at worst — quietly rewriting who did it.
    for (const status of ALL) {
      const refusal = appointmentTransitionRefusal(status, status);
      expect(refusal, `${status} -> itself`).toBeTruthy();
      expect(refusal).toMatch(/already/i);
    }
  });

  it("refuses everything out of the four terminal states", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL) {
        expect(appointmentTransitionRefusal(from, to)).toBeTruthy();
      }
      expect(ALLOWED_STATUS_TRANSITIONS[from]).toEqual([]);
    }
  });

  it("allows the three AP-4 operations from a booked appointment", () => {
    expect(appointmentTransitionRefusal("SCHEDULED", "CANCELLED")).toBeNull();
    expect(appointmentTransitionRefusal("SCHEDULED", "NO_SHOW")).toBeNull();
    expect(appointmentTransitionRefusal("SCHEDULED", "CHECKED_IN")).toBeNull();
    expect(appointmentTransitionRefusal("SCHEDULED", "RESCHEDULED")).toBeNull();
  });

  it("allows them from a confirmed appointment too", () => {
    expect(appointmentTransitionRefusal("CONFIRMED", "CANCELLED")).toBeNull();
    expect(appointmentTransitionRefusal("CONFIRMED", "NO_SHOW")).toBeNull();
    expect(appointmentTransitionRefusal("CONFIRMED", "CHECKED_IN")).toBeNull();
    expect(appointmentTransitionRefusal("CONFIRMED", "RESCHEDULED")).toBeNull();
  });

  it("will not move a patient who has already arrived", () => {
    // Rescheduling somebody standing at the desk is not a reschedule; they are
    // here. Cancel or no-show, then book again.
    expect(appointmentTransitionRefusal("CHECKED_IN", "RESCHEDULED")).toBeTruthy();
    expect(appointmentTransitionRefusal("CHECKED_IN", "CANCELLED")).toBeNull();
    expect(appointmentTransitionRefusal("CHECKED_IN", "CONVERTED")).toBeNull();
  });

  it("will not check in an appointment that was moved elsewhere", () => {
    expect(appointmentTransitionRefusal("RESCHEDULED", "CHECKED_IN")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Occupancy, which the lifecycle is really about
// ---------------------------------------------------------------------------

describe("what each AP-4 outcome does to the doctor's time", () => {
  const slotStart = new Date("2026-11-09T09:00:00.000Z");

  it("releases the slot on cancel", () => {
    expect(activeSlotStartForStatus("CANCELLED", slotStart)).toBeNull();
  });

  it("releases the slot on a no-show, because the patient did not come", () => {
    expect(activeSlotStartForStatus("NO_SHOW", slotStart)).toBeNull();
  });

  it("releases the slot on the ORIGINAL row of a reschedule", () => {
    expect(activeSlotStartForStatus("RESCHEDULED", slotStart)).toBeNull();
  });

  it("KEEPS the slot on check-in — a patient in the waiting room is not free time", () => {
    expect(activeSlotStartForStatus("CHECKED_IN", slotStart)).toEqual(slotStart);
  });

  it("keeps the slot on the NEW row of a reschedule", () => {
    expect(activeSlotStartForStatus("SCHEDULED", slotStart)).toEqual(slotStart);
  });

  it("agrees with the occupying/releasing split for every status", () => {
    for (const status of ALL) {
      const sentinel = activeSlotStartForStatus(status, slotStart);
      if (OCCUPYING_STATUSES.includes(status)) {
        expect(sentinel, status).toEqual(slotStart);
      } else {
        expect(RELEASING_STATUSES.includes(status), status).toBe(true);
        expect(sentinel, status).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

describe("doctorDayLockId", () => {
  it("is the exact format AP-3's booking path already writes", () => {
    // Character for character. A second format for the same doctor-day would
    // insert a second row, the unique index would reject it, and a booking and
    // a cancellation could end up serialising on nothing.
    expect(doctorDayLockId({ doctorId: "doc-1", date: "2026-11-09" })).toBe(
      "lock-doc-1-2026-11-09",
    );
  });

  it("is deterministic", () => {
    const key = { doctorId: "doc-1", date: "2026-11-09" };
    expect(doctorDayLockId(key)).toBe(doctorDayLockId({ ...key }));
  });

  it("separates doctors and dates", () => {
    const ids = new Set([
      doctorDayLockId({ doctorId: "doc-1", date: "2026-11-09" }),
      doctorDayLockId({ doctorId: "doc-2", date: "2026-11-09" }),
      doctorDayLockId({ doctorId: "doc-1", date: "2026-11-10" }),
    ]);
    expect(ids.size).toBe(3);
  });
});

describe("lock ordering, which is what keeps a reschedule from deadlocking", () => {
  it("collapses a same-doctor same-day move to one lock", () => {
    const keys = orderLockKeys([
      { doctorId: "doc-1", date: "2026-11-09" },
      { doctorId: "doc-1", date: "2026-11-09" },
    ]);
    expect(keys).toHaveLength(1);
  });

  it("gives two reschedules that mirror each other the SAME order", () => {
    // This is the whole point. Without it, one transaction takes doc-1 then
    // doc-2 while the other takes doc-2 then doc-1, and they deadlock.
    const a = { doctorId: "doc-1", date: "2026-11-09" };
    const b = { doctorId: "doc-2", date: "2026-11-09" };

    expect(orderLockKeys([a, b])).toEqual(orderLockKeys([b, a]));
  });

  it("orders by doctor first, then date", () => {
    expect(
      compareLockKeys(
        { doctorId: "doc-1", date: "2026-12-31" },
        { doctorId: "doc-2", date: "2026-01-01" },
      ),
    ).toBeLessThan(0);

    expect(
      compareLockKeys(
        { doctorId: "doc-1", date: "2026-11-10" },
        { doctorId: "doc-1", date: "2026-11-09" },
      ),
    ).toBeGreaterThan(0);
  });

  it("keeps a two-doctor move to two locks", () => {
    const keys = orderLockKeys([
      { doctorId: "doc-2", date: "2026-11-10" },
      { doctorId: "doc-1", date: "2026-11-09" },
    ]);
    expect(keys.map((key) => key.doctorId)).toEqual(["doc-1", "doc-2"]);
  });
});

describe("isDeadlockError", () => {
  const known = (code: string, meta?: Record<string, unknown>, message = "boom") =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: "test",
      meta,
    });

  it("recognises the query engine's own write-conflict code", () => {
    expect(isDeadlockError(known("P2034"))).toBe(true);
  });

  it("recognises MySQL 1213 arriving through a raw query", () => {
    expect(isDeadlockError(known("P2010", { code: "1213" }))).toBe(true);
    expect(isDeadlockError(known("P2010", { code: 1213 }))).toBe(true);
  });

  it("recognises it by message when the code is missing", () => {
    expect(
      isDeadlockError(
        known("P2010", undefined, "Deadlock found when trying to get lock"),
      ),
    ).toBe(true);
  });

  it("does NOT retry a unique-constraint violation", () => {
    // P2002 means the slot is genuinely taken. Retrying would take longer to
    // say the same thing.
    expect(isDeadlockError(known("P2002"))).toBe(false);
  });

  it("does NOT retry an ordinary error", () => {
    expect(isDeadlockError(new Error("deadlock"))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
    expect(isDeadlockError("deadlock")).toBe(false);
  });
});
