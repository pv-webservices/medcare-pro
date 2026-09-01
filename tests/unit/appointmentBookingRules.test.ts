import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  RELEASING_STATUSES,
  activeSlotStartForStatus,
  appointmentIntervalProblem,
  intervalsOverlap,
  matchesDuration,
} from "@/lib/appointmentRules";
import {
  appointmentFilterSchema,
  appointmentIndicatorsQuerySchema,
  createAppointmentSchema,
  resolveListStatuses,
  type AppointmentFilters,
} from "@/lib/appointmentInput";
import { parseDateTime } from "@/lib/dates";

/**
 * AP-3 — the booking rules that can be checked without a database.
 *
 * The concurrency guarantee cannot be: it needs two real transactions racing on
 * a real MySQL, and that is proved in
 * scripts/verify-ap3-appointment-booking.mts. What IS pure is everything that
 * decides what a booking is allowed to say in the first place, and what the
 * board shows back — which is where a client would try to smuggle a price, a
 * status, or another organisation's id.
 */

const at = (day: string, time: string): Date => parseDateTime(day, time);

const DAY = "2026-11-09";

const validBooking = {
  clinicId: "clinic-1",
  doctorId: "doctor-1",
  appointmentTypeId: "type-1",
  name: "Asha Menon",
  mobileNumber: "9876500011",
  age: 34,
  gender: "Female" as const,
  address: "12 Residency Road",
  city: "Bengaluru",
  slotStart: `${DAY}T09:00:00.000Z`,
  slotEnd: `${DAY}T09:30:00.000Z`,
};

describe("createAppointmentSchema — what a client may say", () => {
  it("accepts a booking for someone who is not a patient yet", () => {
    const parsed = createAppointmentSchema.parse(validBooking);
    expect(parsed.name).toBe("Asha Menon");
    expect(parsed.patientId).toBeUndefined();
    expect(parsed.age).toBe(34);
    expect(parsed.gender).toBe("Female");
    expect(parsed.city).toBe("Bengaluru");
    expect(parsed.address).toBe("12 Residency Road");
  });

  it("accepts a booking for an existing patient", () => {
    expect(
      createAppointmentSchema.parse({ ...validBooking, patientId: "patient-1" })
        .patientId,
    ).toBe("patient-1");
  });

  it("requires all mandatory patient fields", () => {
    for (const field of ["name", "mobileNumber", "age", "gender", "city", "address"]) {
      const invalid: Record<string, unknown> = { ...validBooking };
      delete invalid[field];
      expect(() => createAppointmentSchema.parse(invalid)).toThrow();
    }
  });

  it("enforces gender to be Male, Female, or Other", () => {
    for (const gender of ["Male", "Female", "Other"] as const) {
      expect(
        createAppointmentSchema.parse({ ...validBooking, gender }).gender,
      ).toBe(gender);
    }
    for (const invalidGender of ["", "not_recorded", "Unknown", "invalid"]) {
      expect(() =>
        createAppointmentSchema.parse({
          ...validBooking,
          gender: invalidGender as "Male",
        }),
      ).toThrow();
    }
  });

  it("requires a clinic, a doctor and a type", () => {
    for (const field of ["clinicId", "doctorId", "appointmentTypeId"]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, [field]: "" }),
      ).toThrow();
    }
  });

  it("requires a non-empty name", () => {
    expect(() =>
      createAppointmentSchema.parse({ ...validBooking, name: "   " }),
    ).toThrow();
  });

  it("validates the mobile number the same way registrations does", () => {
    // The two columns hold the same kind of value and AP-5 copies one to the
    // other, so a number bookable here must be registrable there.
    for (const mobileNumber of ["9876500011", "+919876500011"]) {
      expect(
        createAppointmentSchema.parse({ ...validBooking, mobileNumber })
          .mobileNumber,
      ).toBe(mobileNumber);
    }

    for (const mobileNumber of [
      "",
      "abc",
      "12",
      "not a number",
      "+91 98765 00011",
      "(080) 4567-8901",
    ]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, mobileNumber }),
      ).toThrow();
    }
  });

  it("bounds age at something a person could be", () => {
    expect(() =>
      createAppointmentSchema.parse({ ...validBooking, age: -1 }),
    ).toThrow();
    expect(() =>
      createAppointmentSchema.parse({ ...validBooking, age: 151 }),
    ).toThrow();
  });

  // --- What the schema deliberately cannot say ------------------------------

  it("ignores an amount sent by the client", () => {
    // The price comes from the appointment type, server-side. A receptionist
    // cannot discount a consultation by editing the request.
    const parsed = createAppointmentSchema.parse({
      ...validBooking,
      amount: 0,
    }) as Record<string, unknown>;

    expect(parsed.amount).toBeUndefined();
  });

  it("ignores a status sent by the client", () => {
    // Booking a slot straight into CHECKED_IN would skip the front desk, and
    // into CANCELLED would take a slot while appearing to free it.
    const parsed = createAppointmentSchema.parse({
      ...validBooking,
      status: "CHECKED_IN",
    }) as Record<string, unknown>;

    expect(parsed.status).toBeUndefined();
  });

  it("ignores an activeSlotStart sent by the client", () => {
    // The occupancy sentinel is derived from the status. A client that could
    // null it would hold a slot the overlap query cannot see.
    const parsed = createAppointmentSchema.parse({
      ...validBooking,
      activeSlotStart: null,
    }) as Record<string, unknown>;

    expect(parsed.activeSlotStart).toBeUndefined();
  });

  it("ignores tenantId and bookedById sent by the client", () => {
    const parsed = createAppointmentSchema.parse({
      ...validBooking,
      tenantId: "another-organisation",
      bookedById: "somebody-else",
    }) as Record<string, unknown>;

    expect(parsed.tenantId).toBeUndefined();
    expect(parsed.bookedById).toBeUndefined();
  });
});

describe("slot instants on the wire", () => {
  it("accepts an explicit-Z instant on a whole minute", () => {
    expect(
      createAppointmentSchema.parse({
        ...validBooking,
        slotStart: `${DAY}T09:00Z`,
        slotEnd: `${DAY}T09:30Z`,
      }).slotStart,
    ).toBe(`${DAY}T09:00Z`);
  });

  it("accepts the full millisecond form", () => {
    expect(
      createAppointmentSchema.parse(validBooking).slotStart,
    ).toBe(`${DAY}T09:00:00.000Z`);
  });

  it("refuses a string with no timezone at all", () => {
    // `new Date("2026-11-09 09:00")` is local-time in some engines and invalid
    // in others. This project tags wall-clock as UTC and never converts, so the
    // Z is not decoration — it is the whole contract.
    for (const slotStart of [
      "2026-11-09 09:00",
      "2026-11-09T09:00",
      "2026-11-09T09:00:00",
    ]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, slotStart }),
      ).toThrow();
    }
  });

  it("refuses an offset that is not Z", () => {
    // +05:30 would mean a real conversion, which nothing in this codebase does.
    expect(() =>
      createAppointmentSchema.parse({
        ...validBooking,
        slotStart: "2026-11-09T09:00:00+05:30",
      }),
    ).toThrow();
  });

  it("refuses sub-minute precision", () => {
    // AP-2 never offers 09:00:30, so accepting it would accept a boundary no
    // availability window can align with.
    for (const slotStart of [
      `${DAY}T09:00:30Z`,
      `${DAY}T09:00:00.500Z`,
    ]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, slotStart }),
      ).toThrow();
    }
  });

  it("refuses an impossible clock time", () => {
    for (const slotStart of [`${DAY}T25:00Z`, `${DAY}T09:71Z`]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, slotStart }),
      ).toThrow();
    }
  });

  it("refuses an impossible date", () => {
    expect(() =>
      createAppointmentSchema.parse({
        ...validBooking,
        slotStart: "2026-13-40T09:00Z",
      }),
    ).toThrow();
  });

  it("refuses free text", () => {
    for (const slotStart of ["", "tomorrow", "09:00"]) {
      expect(() =>
        createAppointmentSchema.parse({ ...validBooking, slotStart }),
      ).toThrow();
    }
  });
});

describe("the interval a booking must satisfy", () => {
  it("accepts an ordinary same-day slot", () => {
    expect(
      appointmentIntervalProblem(at(DAY, "09:00"), at(DAY, "09:30")),
    ).toBeNull();
  });

  it("refuses an end that is not after the start", () => {
    expect(appointmentIntervalProblem(at(DAY, "09:30"), at(DAY, "09:00"))).toBe(
      "end-not-after-start",
    );
    expect(appointmentIntervalProblem(at(DAY, "09:00"), at(DAY, "09:00"))).toBe(
      "end-not-after-start",
    );
  });

  it("refuses a slot that runs past midnight", () => {
    // This is what makes (doctorId, date) a COMPLETE lock key: two conflicting
    // appointments necessarily share a date, so they serialise on one row.
    expect(
      appointmentIntervalProblem(at(DAY, "23:30"), at("2026-11-10", "00:30")),
    ).toBe("spans-two-days");
  });

  it("requires the slot to be exactly as long as its type", () => {
    expect(matchesDuration(at(DAY, "09:00"), at(DAY, "09:30"), 30)).toBe(true);
    expect(matchesDuration(at(DAY, "09:00"), at(DAY, "09:30"), 15)).toBe(false);
    expect(matchesDuration(at(DAY, "09:00"), at(DAY, "09:45"), 30)).toBe(false);
  });
});

describe("the overlap rule the locking query implements", () => {
  const candidate = { start: at(DAY, "09:00"), end: at(DAY, "09:30") };

  const overlaps = (startTime: string, endTime: string): boolean =>
    intervalsOverlap(
      at(DAY, startTime),
      at(DAY, endTime),
      candidate.start,
      candidate.end,
    );

  it("rejects an identical slot", () => {
    expect(overlaps("09:00", "09:30")).toBe(true);
  });

  it("rejects a partial overlap on either side", () => {
    expect(overlaps("08:45", "09:15")).toBe(true);
    expect(overlaps("09:15", "09:45")).toBe(true);
  });

  it("rejects an appointment that contains the candidate", () => {
    expect(overlaps("08:30", "10:00")).toBe(true);
  });

  it("rejects an appointment contained by the candidate", () => {
    expect(overlaps("09:05", "09:20")).toBe(true);
  });

  it("allows an adjacent appointment on either side", () => {
    // Half-open [start, end): touching end-to-start is not an overlap, and a
    // clinic that could not book back-to-back slots would be unusable.
    expect(overlaps("08:30", "09:00")).toBe(false);
    expect(overlaps("09:30", "10:00")).toBe(false);
  });

  it("allows a slot that does not touch at all", () => {
    expect(overlaps("11:00", "11:30")).toBe(false);
  });
});

describe("which statuses hold a slot", () => {
  it("freezes a slot for all four occupying statuses", () => {
    expect([...OCCUPYING_STATUSES]).toEqual([
      "SCHEDULED",
      "CONFIRMED",
      "CHECKED_IN",
      "CONVERTED",
    ]);
  });

  it("keeps CONVERTED occupying", () => {
    // A completed visit consumed the doctor's time just as surely as a booked
    // one. Releasing it would let the slot be sold twice after the fact.
    expect(OCCUPYING_STATUSES).toContain("CONVERTED");
  });

  it("releases a slot for cancelled, no-show and rescheduled", () => {
    expect([...RELEASING_STATUSES]).toEqual([
      "CANCELLED",
      "NO_SHOW",
      "RESCHEDULED",
    ]);
  });

  it("gives a new booking the occupancy sentinel", () => {
    const slotStart = at(DAY, "09:00");
    expect(activeSlotStartForStatus("SCHEDULED", slotStart)).toEqual(slotStart);
  });

  it("nulls the sentinel for a status that releases the slot", () => {
    // Which is what lets @@unique([doctorId, activeSlotStart]) constrain only
    // live rows: MySQL treats NULLs as distinct.
    for (const status of RELEASING_STATUSES) {
      expect(activeSlotStartForStatus(status, at(DAY, "09:00"))).toBeNull();
    }
  });
});

describe("resolveListStatuses — what the board shows", () => {
  it("shows only what is still going to happen, by default", () => {
    expect([...resolveListStatuses({})]).toEqual([
      "SCHEDULED",
      "CONFIRMED",
      "CHECKED_IN",
      "CONVERTED",
    ]);
  });

  it("hides the outcomes by default", () => {
    const shown = resolveListStatuses({});
    for (const status of ["CANCELLED", "NO_SHOW", "RESCHEDULED"]) {
      expect(shown).not.toContain(status);
    }
  });

  it("shows everything when history is asked for", () => {
    expect([...resolveListStatuses({ includeHistory: true })]).toEqual([
      ...APPOINTMENT_STATUSES,
    ]);
  });

  it("narrows to one status when one is named", () => {
    expect([...resolveListStatuses({ status: "CANCELLED" })]).toEqual([
      "CANCELLED",
    ]);
  });

  it("lets an explicit status reach history without includeHistory", () => {
    // Asking for cancellations by name is a deliberate act, and answering with
    // the active three instead would silently ignore the filter.
    expect([...resolveListStatuses({ status: "NO_SHOW" })]).toEqual(["NO_SHOW"]);
  });

  it("falls back to the default set for a status it does not recognise", () => {
    // The schema refuses these first; this is the second line, so a caller
    // reaching the function directly cannot widen the query with junk.
    // Cast, because the schema's own refinement means TypeScript will not even
    // let a caller write this — which is the first line of the two.
    expect([
      ...resolveListStatuses({ status: "DROP TABLE" } as unknown as AppointmentFilters),
    ]).toEqual([
      ...OCCUPYING_STATUSES,
    ]);
    expect([...resolveListStatuses({ status: "" })]).toEqual([
      ...OCCUPYING_STATUSES,
    ]);
  });
});

describe("appointmentFilterSchema", () => {
  it("accepts an empty filter", () => {
    expect(appointmentFilterSchema.parse({})).toEqual({});
  });

  it("accepts the date filters", () => {
    const parsed = appointmentFilterSchema.parse({
      date: DAY,
      dateFrom: DAY,
      dateTo: "2026-11-30",
    });
    expect(parsed.date).toBe(DAY);
    expect(parsed.dateTo).toBe("2026-11-30");
  });

  it("refuses a malformed date", () => {
    for (const date of ["09-11-2026", "2026-13-01", "tomorrow"]) {
      expect(() => appointmentFilterSchema.parse({ date })).toThrow();
    }
  });

  it("treats a blank date as no filter, the way an HTML form sends it", () => {
    expect(appointmentFilterSchema.parse({ date: "" }).date).toBe("");
  });

  it("accepts every real status", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(appointmentFilterSchema.parse({ status }).status).toBe(status);
    }
  });

  it("refuses a status that is not one", () => {
    for (const status of ["BOOKED", "scheduled", "' OR 1=1 --"]) {
      expect(() => appointmentFilterSchema.parse({ status })).toThrow();
    }
  });

  it("reads includeHistory from a query string", () => {
    expect(
      appointmentFilterSchema.parse({ includeHistory: "true" }).includeHistory,
    ).toBe(true);
  });

  it("does not turn the string \"false\" into true", () => {
    // z.coerce.boolean() would, and cancellations would reappear on the board.
    expect(
      appointmentFilterSchema.parse({ includeHistory: "false" }).includeHistory,
    ).toBe(false);
  });

  it("coerces and bounds the page number", () => {
    expect(appointmentFilterSchema.parse({ page: "3" }).page).toBe(3);
    expect(() => appointmentFilterSchema.parse({ page: "0" })).toThrow();
    expect(() => appointmentFilterSchema.parse({ page: "-1" })).toThrow();
    expect(() => appointmentFilterSchema.parse({ page: "1.5" })).toThrow();
    expect(() => appointmentFilterSchema.parse({ page: "10001" })).toThrow();
  });

  it("accepts valid view modes ('day' and 'upcoming')", () => {
    expect(appointmentFilterSchema.parse({ view: "day" }).view).toBe("day");
    expect(appointmentFilterSchema.parse({ view: "upcoming" }).view).toBe("upcoming");
    expect(appointmentFilterSchema.parse({}).view).toBeUndefined();
    expect(() => appointmentFilterSchema.parse({ view: "month" })).toThrow();
  });
});

describe("appointmentIndicatorsQuerySchema", () => {
  it("accepts valid query parameters", () => {
    const parsed = appointmentIndicatorsQuerySchema.parse({
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      status: "CONFIRMED",
      includeHistory: "true",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(parsed.clinicId).toBe("clinic-1");
    expect(parsed.doctorId).toBe("doctor-1");
    expect(parsed.status).toBe("CONFIRMED");
    expect(parsed.includeHistory).toBe(true);
    expect(parsed.dateFrom).toBe("2026-09-01");
    expect(parsed.dateTo).toBe("2026-09-30");
  });

  it("treats empty string dateFrom and dateTo as valid", () => {
    const parsed = appointmentIndicatorsQuerySchema.parse({
      dateFrom: "",
      dateTo: "",
    });
    expect(parsed.dateFrom).toBe("");
    expect(parsed.dateTo).toBe("");
  });
});

