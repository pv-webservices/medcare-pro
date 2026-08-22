import { describe, expect, it } from "vitest";
import { AppointmentStatus as PrismaAppointmentStatus } from "@prisma/client";
import {
  ALLOWED_STATUS_TRANSITIONS,
  APPOINTMENT_STATUSES,
  MAX_APPOINTMENT_AMOUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  OCCUPYING_STATUSES,
  RELEASING_STATUSES,
  TERMINAL_STATUSES,
  activeSlotStartForStatus,
  appointmentIntervalProblem,
  appointmentLockDate,
  canTransitionAppointment,
  compareLockKeys,
  intervalsOverlap,
  isAppointmentScopeConsistent,
  isAppointmentStatus,
  isAppointmentTypeUsableAt,
  isOccupyingAppointmentStatus,
  isTerminalAppointmentStatus,
  isValidAppointmentAmount,
  isValidAppointmentDuration,
  isValidAppointmentInterval,
  matchesDuration,
  orderLockKeys,
  type AppointmentStatus,
} from "@/lib/appointmentRules";

/** Wall-clock time tagged UTC, the convention src/lib/dates.ts establishes. */
const at = (day: string, time: string): Date =>
  new Date(`${day}T${time}:00.000Z`);

describe("the status set", () => {
  it("matches the Prisma enum exactly", () => {
    // The union in appointmentRules.ts is hand-written so the module can stay
    // pure. This is what stops it drifting from the schema it mirrors.
    expect([...APPOINTMENT_STATUSES].sort()).toEqual(
      Object.values(PrismaAppointmentStatus).sort(),
    );
  });

  it("recognises its own members and nothing else", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(isAppointmentStatus(status)).toBe(true);
    }
    expect(isAppointmentStatus("PENDING")).toBe(false);
    expect(isAppointmentStatus("scheduled")).toBe(false);
    expect(isAppointmentStatus("")).toBe(false);
  });
});

describe("occupancy", () => {
  it("splits every status into exactly one of occupying or releasing", () => {
    // Exhaustive on purpose: a status added later cannot slip through without
    // someone deciding whether it holds the doctor's time.
    for (const status of APPOINTMENT_STATUSES) {
      const occupying = OCCUPYING_STATUSES.includes(status);
      const releasing = RELEASING_STATUSES.includes(status);
      expect(occupying !== releasing).toBe(true);
    }
    expect(OCCUPYING_STATUSES.length + RELEASING_STATUSES.length).toBe(
      APPOINTMENT_STATUSES.length,
    );
  });

  it("holds the slot for a converted appointment", () => {
    // The patient arrived and was seen; the time was genuinely consumed.
    // Releasing it would let a second booking land where a visit happened.
    expect(isOccupyingAppointmentStatus("CONVERTED")).toBe(true);
  });

  it("holds the slot while the appointment is live", () => {
    expect(isOccupyingAppointmentStatus("SCHEDULED")).toBe(true);
    expect(isOccupyingAppointmentStatus("CONFIRMED")).toBe(true);
    expect(isOccupyingAppointmentStatus("CHECKED_IN")).toBe(true);
  });

  it("frees the slot once the appointment is retired", () => {
    expect(isOccupyingAppointmentStatus("CANCELLED")).toBe(false);
    expect(isOccupyingAppointmentStatus("NO_SHOW")).toBe(false);
    expect(isOccupyingAppointmentStatus("RESCHEDULED")).toBe(false);
  });
});

describe("activeSlotStartForStatus", () => {
  const slotStart = at("2026-09-01", "09:00");

  it("mirrors slotStart for every occupying status", () => {
    for (const status of OCCUPYING_STATUSES) {
      expect(activeSlotStartForStatus(status, slotStart)).toEqual(slotStart);
    }
  });

  it("is null for every releasing status", () => {
    // This is what frees the unique index. MySQL treats NULLs as distinct, so
    // any number of retired rows may share a doctor and a start time.
    for (const status of RELEASING_STATUSES) {
      expect(activeSlotStartForStatus(status, slotStart)).toBeNull();
    }
  });

  it("agrees with isOccupyingAppointmentStatus for every status", () => {
    // The index and the overlap query must never disagree about "busy".
    for (const status of APPOINTMENT_STATUSES) {
      const sentinel = activeSlotStartForStatus(status, slotStart);
      expect(sentinel !== null).toBe(isOccupyingAppointmentStatus(status));
    }
  });
});

describe("status transitions", () => {
  it("lets a booking be confirmed, then checked in", () => {
    expect(canTransitionAppointment("SCHEDULED", "CONFIRMED")).toBe(true);
    expect(canTransitionAppointment("SCHEDULED", "CHECKED_IN")).toBe(true);
    expect(canTransitionAppointment("CONFIRMED", "CHECKED_IN")).toBe(true);
  });

  it("lets a live booking be cancelled, missed, or moved", () => {
    for (const from of ["SCHEDULED", "CONFIRMED"] as const) {
      expect(canTransitionAppointment(from, "CANCELLED")).toBe(true);
      expect(canTransitionAppointment(from, "NO_SHOW")).toBe(true);
      expect(canTransitionAppointment(from, "RESCHEDULED")).toBe(true);
    }
  });

  it("converts only an arrival", () => {
    // Conversion records a visit that happened, so the patient must have
    // actually turned up. Booking straight into a registration is not a thing.
    expect(canTransitionAppointment("CHECKED_IN", "CONVERTED")).toBe(true);
    expect(canTransitionAppointment("SCHEDULED", "CONVERTED")).toBe(false);
    expect(canTransitionAppointment("CONFIRMED", "CONVERTED")).toBe(false);
  });

  it("does not move an arrival to a different slot", () => {
    // The patient is standing at the desk. Moving them is a new booking.
    expect(canTransitionAppointment("CHECKED_IN", "RESCHEDULED")).toBe(false);
  });

  it("never reopens a terminal appointment", () => {
    for (const from of TERMINAL_STATUSES) {
      expect(ALLOWED_STATUS_TRANSITIONS[from]).toEqual([]);
      for (const to of APPOINTMENT_STATUSES) {
        expect(canTransitionAppointment(from, to)).toBe(false);
      }
    }
  });

  it("refuses every self-transition", () => {
    // Re-cancelling a cancelled appointment would rewrite cancelledAt and
    // report success for a no-op. Callers should see the conflict.
    for (const status of APPOINTMENT_STATUSES) {
      expect(canTransitionAppointment(status, status)).toBe(false);
    }
  });

  it("names a known status on both sides of every allowed edge", () => {
    for (const [from, targets] of Object.entries(ALLOWED_STATUS_TRANSITIONS)) {
      expect(isAppointmentStatus(from)).toBe(true);
      for (const to of targets) {
        expect(isAppointmentStatus(to)).toBe(true);
      }
    }
  });

  it("marks exactly the terminal statuses as terminal", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(isTerminalAppointmentStatus(status)).toBe(
        ALLOWED_STATUS_TRANSITIONS[status].length === 0,
      );
    }
  });

  it("makes every releasing status reachable from a live one", () => {
    // Otherwise a slot could be occupied with no way to free it.
    for (const releasing of RELEASING_STATUSES) {
      const reachable = APPOINTMENT_STATUSES.some(
        (from) =>
          isOccupyingAppointmentStatus(from) &&
          canTransitionAppointment(from, releasing),
      );
      expect(reachable).toBe(true);
    }
  });
});

describe("intervalsOverlap", () => {
  const day = "2026-09-01";

  it("treats adjacent intervals as free", () => {
    // Half-open [start, end) — the convention lib/doctors.ts already uses for
    // availability. A different rule here would make a slot computed from an
    // availability window fail to fit back inside it at the boundary.
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "09:30"),
        at(day, "10:00"),
      ),
    ).toBe(false);
  });

  it("catches identical intervals", () => {
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "09:00"),
        at(day, "09:30"),
      ),
    ).toBe(true);
  });

  it("catches a partial overlap with a different start time", () => {
    // This is the case the unique index CANNOT see: different slot_start
    // values, so no duplicate key. It is why the lock exists.
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "09:15"),
        at(day, "09:30"),
      ),
    ).toBe(true);
  });

  it("catches containment in both directions", () => {
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "10:00"),
        at(day, "09:15"),
        at(day, "09:30"),
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        at(day, "09:15"),
        at(day, "09:30"),
        at(day, "09:00"),
        at(day, "10:00"),
      ),
    ).toBe(true);
  });

  it("catches a left-partial and a right-partial overlap", () => {
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "08:45"),
        at(day, "09:15"),
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "09:15"),
        at(day, "09:45"),
      ),
    ).toBe(true);
  });

  it("leaves well-separated intervals alone", () => {
    expect(
      intervalsOverlap(
        at(day, "09:00"),
        at(day, "09:30"),
        at(day, "14:00"),
        at(day, "14:30"),
      ),
    ).toBe(false);
  });

  it("is symmetric", () => {
    const cases: readonly [string, string, string, string][] = [
      ["09:00", "09:30", "09:30", "10:00"],
      ["09:00", "09:30", "09:15", "09:45"],
      ["09:00", "10:00", "09:15", "09:30"],
      ["09:00", "09:30", "14:00", "14:30"],
    ];
    for (const [aS, aE, bS, bE] of cases) {
      expect(
        intervalsOverlap(at(day, aS), at(day, aE), at(day, bS), at(day, bE)),
      ).toBe(
        intervalsOverlap(at(day, bS), at(day, bE), at(day, aS), at(day, aE)),
      );
    }
  });
});

describe("appointmentIntervalProblem", () => {
  const day = "2026-09-01";

  it("accepts an ordinary slot", () => {
    expect(appointmentIntervalProblem(at(day, "09:00"), at(day, "09:30"))).toBeNull();
    expect(isValidAppointmentInterval(at(day, "09:00"), at(day, "09:30"))).toBe(true);
  });

  it("refuses an end at or before the start", () => {
    expect(appointmentIntervalProblem(at(day, "09:30"), at(day, "09:00"))).toBe(
      "end-not-after-start",
    );
  });

  it("refuses a zero-length slot", () => {
    // It would occupy no time and collide with nothing — an appointment no
    // conflict check could ever detect.
    expect(appointmentIntervalProblem(at(day, "09:00"), at(day, "09:00"))).toBe(
      "end-not-after-start",
    );
  });

  it("refuses a slot that crosses midnight", () => {
    // This is what makes (doctorId, date) a COMPLETE lock key. An overnight
    // appointment could sit on a different date from the one it collides with,
    // and the two would serialise on different lock rows.
    expect(
      appointmentIntervalProblem(at(day, "23:30"), at("2026-09-02", "00:30")),
    ).toBe("spans-two-days");
  });

  it("accepts a slot ending at the last minute of the day", () => {
    expect(
      appointmentIntervalProblem(at(day, "23:00"), at(day, "23:59")),
    ).toBeNull();
  });

  it("refuses an unparseable date", () => {
    expect(
      appointmentIntervalProblem(new Date("nonsense"), at(day, "09:30")),
    ).toBe("invalid-date");
    expect(
      appointmentIntervalProblem(at(day, "09:00"), new Date("nonsense")),
    ).toBe("invalid-date");
  });
});

describe("lock keys", () => {
  it("derives the lock date from the slot start", () => {
    expect(appointmentLockDate(at("2026-09-01", "09:00"))).toBe("2026-09-01");
    // Tagged UTC, never converted — a late slot stays on its own day.
    expect(appointmentLockDate(at("2026-09-01", "23:45"))).toBe("2026-09-01");
  });

  it("orders ascending by doctor, then by date", () => {
    expect(
      compareLockKeys(
        { doctorId: "doc-a", date: "2026-09-01" },
        { doctorId: "doc-b", date: "2026-08-01" },
      ),
    ).toBeLessThan(0);
    expect(
      compareLockKeys(
        { doctorId: "doc-a", date: "2026-09-02" },
        { doctorId: "doc-a", date: "2026-09-01" },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareLockKeys(
        { doctorId: "doc-a", date: "2026-09-01" },
        { doctorId: "doc-a", date: "2026-09-01" },
      ),
    ).toBe(0);
  });

  it("sorts a reschedule's two keys the same way from either direction", () => {
    // A reschedule and its mirror image must take the two locks in the same
    // order, or they deadlock against each other.
    const older = { doctorId: "doc-a", date: "2026-09-01" };
    const newer = { doctorId: "doc-b", date: "2026-09-02" };
    expect(orderLockKeys([older, newer])).toEqual([older, newer]);
    expect(orderLockKeys([newer, older])).toEqual([older, newer]);
  });

  it("collapses a move within the same doctor-day to one lock", () => {
    const key = { doctorId: "doc-a", date: "2026-09-01" };
    expect(orderLockKeys([key, { ...key }])).toEqual([key]);
  });
});

describe("duration bounds", () => {
  it("accepts durations inside the bounds", () => {
    expect(isValidAppointmentDuration(MIN_DURATION_MINUTES)).toBe(true);
    expect(isValidAppointmentDuration(15)).toBe(true);
    expect(isValidAppointmentDuration(MAX_DURATION_MINUTES)).toBe(true);
  });

  it("refuses zero, negatives and out-of-range durations", () => {
    expect(isValidAppointmentDuration(0)).toBe(false);
    expect(isValidAppointmentDuration(-30)).toBe(false);
    expect(isValidAppointmentDuration(MIN_DURATION_MINUTES - 1)).toBe(false);
    expect(isValidAppointmentDuration(MAX_DURATION_MINUTES + 1)).toBe(false);
  });

  it("refuses a fractional duration", () => {
    // The column is an INT; a fraction would be silently truncated.
    expect(isValidAppointmentDuration(15.5)).toBe(false);
    expect(isValidAppointmentDuration(Number.NaN)).toBe(false);
  });
});

describe("matchesDuration", () => {
  const day = "2026-09-01";

  it("accepts a slot whose length equals the type's duration", () => {
    expect(matchesDuration(at(day, "09:00"), at(day, "09:30"), 30)).toBe(true);
  });

  it("refuses a slot that does not", () => {
    expect(matchesDuration(at(day, "09:00"), at(day, "09:30"), 20)).toBe(false);
  });

  it("works from an availability window that does not start on the hour", () => {
    // 09:07 is a valid availability start today — start_time is a free "HH:mm"
    // string. Nothing here assumes a canonical grid.
    expect(matchesDuration(at(day, "09:07"), at(day, "09:27"), 20)).toBe(true);
  });
});

describe("amount bounds", () => {
  it("accepts zero", () => {
    // A free follow-up is a real thing a clinic books.
    expect(isValidAppointmentAmount(0)).toBe(true);
  });

  it("accepts ordinary prices and the column's maximum", () => {
    expect(isValidAppointmentAmount(500)).toBe(true);
    expect(isValidAppointmentAmount(1234.56)).toBe(true);
    expect(isValidAppointmentAmount(MAX_APPOINTMENT_AMOUNT)).toBe(true);
  });

  it("refuses a negative amount", () => {
    expect(isValidAppointmentAmount(-1)).toBe(false);
  });

  it("refuses an amount past what Decimal(10, 2) holds", () => {
    expect(isValidAppointmentAmount(MAX_APPOINTMENT_AMOUNT + 0.01)).toBe(false);
    expect(isValidAppointmentAmount(100_000_000)).toBe(false);
  });

  it("refuses a third decimal place", () => {
    // Decimal(10, 2) rounds it rather than refusing, so 10.005 would be quoted
    // at one price and stored at another.
    expect(isValidAppointmentAmount(10.005)).toBe(false);
  });

  it("refuses values that are not finite numbers", () => {
    expect(isValidAppointmentAmount(Number.NaN)).toBe(false);
    expect(isValidAppointmentAmount(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isAppointmentTypeUsableAt", () => {
  const tenant = "tenant-1";
  const clinic = "clinic-1";

  it("accepts a tenant-wide type at any clinic in that tenant", () => {
    expect(
      isAppointmentTypeUsableAt(
        { tenantId: tenant, clinicId: null, isActive: true },
        tenant,
        clinic,
      ),
    ).toBe(true);
    expect(
      isAppointmentTypeUsableAt(
        { tenantId: tenant, clinicId: null, isActive: true },
        tenant,
        "clinic-2",
      ),
    ).toBe(true);
  });

  it("accepts a clinic-specific type only at its own clinic", () => {
    const type = { tenantId: tenant, clinicId: clinic, isActive: true };
    expect(isAppointmentTypeUsableAt(type, tenant, clinic)).toBe(true);
    expect(isAppointmentTypeUsableAt(type, tenant, "clinic-2")).toBe(false);
  });

  it("never accepts another tenant's type, tenant-wide or not", () => {
    expect(
      isAppointmentTypeUsableAt(
        { tenantId: "tenant-2", clinicId: null, isActive: true },
        tenant,
        clinic,
      ),
    ).toBe(false);
    expect(
      isAppointmentTypeUsableAt(
        { tenantId: "tenant-2", clinicId: clinic, isActive: true },
        tenant,
        clinic,
      ),
    ).toBe(false);
  });

  it("refuses a retired type", () => {
    expect(
      isAppointmentTypeUsableAt(
        { tenantId: tenant, clinicId: null, isActive: false },
        tenant,
        clinic,
      ),
    ).toBe(false);
  });
});

describe("isAppointmentScopeConsistent", () => {
  const base = {
    appointmentTenantId: "tenant-1",
    clinicTenantId: "tenant-1",
    appointmentClinicId: "clinic-1",
    doctorClinicId: "clinic-1",
    patientTenantId: "tenant-1",
  };

  it("accepts a consistent appointment", () => {
    expect(isAppointmentScopeConsistent(base)).toBe(true);
  });

  it("accepts one with no patient linked yet", () => {
    // Booking does not create a Patient; conversion does.
    expect(
      isAppointmentScopeConsistent({ ...base, patientTenantId: null }),
    ).toBe(true);
    expect(
      isAppointmentScopeConsistent({ ...base, patientTenantId: undefined }),
    ).toBe(true);
  });

  it("catches a denormalised tenant that drifted from its clinic", () => {
    expect(
      isAppointmentScopeConsistent({ ...base, clinicTenantId: "tenant-2" }),
    ).toBe(false);
  });

  it("catches a doctor from a different clinic", () => {
    expect(
      isAppointmentScopeConsistent({ ...base, doctorClinicId: "clinic-2" }),
    ).toBe(false);
  });

  it("catches a patient from a different tenant", () => {
    expect(
      isAppointmentScopeConsistent({ ...base, patientTenantId: "tenant-2" }),
    ).toBe(false);
  });
});

describe("what the rules module is not", () => {
  it("exports no function that could be mistaken for a concurrency guard", () => {
    // intervalsOverlap answers a question about two KNOWN ranges. It says
    // nothing about a range another transaction is inserting right now, and two
    // callers can both be told "free" and both insert. DoctorScheduleLock is
    // the guard; this test exists so that stays written down next to the code.
    const day = "2026-09-01";
    const free = !intervalsOverlap(
      at(day, "09:00"),
      at(day, "09:30"),
      at(day, "10:00"),
      at(day, "10:30"),
    );
    expect(free).toBe(true);
  });

  it("keeps the status union assignable to the Prisma enum", () => {
    const status: AppointmentStatus = "SCHEDULED";
    const prismaStatus: PrismaAppointmentStatus = status;
    expect(prismaStatus).toBe(PrismaAppointmentStatus.SCHEDULED);
  });
});
