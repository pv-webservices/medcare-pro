import { describe, expect, it } from "vitest";
import {
  ALL_CLINICS_LABEL,
  formatDuration,
  scopeLabel,
  serviceStatus,
} from "@/components/appointments/appointmentTypeView";
import { createAppointmentTypeSchema } from "@/lib/appointmentInput";
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/lib/appointmentRules";

/**
 * AP-7 — how a bookable service reads on the price list.
 *
 * Two things are worth pinning here. The first is `formatDuration`, which is
 * arithmetic and therefore has an off-by-one at every boundary it does not get
 * tested at. The second is the claim AppointmentTypeForm makes in its header:
 * that client validation is not a copy of the server's rules but the server's
 * own schema, imported. That claim is only true while the schema stays pure —
 * the moment lib/appointmentInput.ts reaches Prisma or next/server, this file
 * stops importing and the suite says so (see vitest.config.ts).
 */

describe("formatDuration", () => {
  it("says minutes under the hour", () => {
    expect(formatDuration(5)).toBe("5 min");
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(59)).toBe("59 min");
  });

  it("says whole hours without a trailing zero", () => {
    // "1 hr 0 min" is what the naive version prints, and it reads like a bug.
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(120)).toBe("2 hr");
  });

  it("says both parts in between", () => {
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(75)).toBe("1 hr 15 min");
  });

  it("handles both ends of the allowed range", () => {
    // A full working day is the reason this helper exists at all: "480 min" is
    // a number the reader has to convert before it means anything.
    expect(formatDuration(MIN_DURATION_MINUTES)).toBe("5 min");
    expect(formatDuration(MAX_DURATION_MINUTES)).toBe("8 hr");
  });

  it("refuses to print nonsense for a value the column should never hold", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-30)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("scopeLabel", () => {
  it("names the clinic when there is one", () => {
    expect(scopeLabel("Anna Nagar")).toBe("Anna Nagar");
  });

  it("says a null clinic means every clinic, rather than leaving it blank", () => {
    // Blank reads as missing data. This is a setting somebody chose.
    expect(scopeLabel(null)).toBe(ALL_CLINICS_LABEL);
    expect(ALL_CLINICS_LABEL).toBe("All clinics");
  });
});

describe("serviceStatus", () => {
  it("marks a bookable service as ok", () => {
    expect(serviceStatus(true)).toEqual({ label: "Bookable", tone: "ok" });
  });

  it("marks a retired one neutral, not alert", () => {
    // Retiring is a deliberate configuration choice, not a failure — and the
    // tone table in .claude/skills/admin-dashboard-ui reserves `alert` for
    // things that failed or are blocked.
    expect(serviceStatus(false)).toEqual({ label: "Retired", tone: "neutral" });
  });

  it("never calls it deleted", () => {
    // Nothing here is deleted: appointments reference a service under a
    // Restrict foreign key, so retiring is the only way to stop it being
    // booked, and the bookings already made stay readable.
    for (const isActive of [true, false]) {
      expect(serviceStatus(isActive).label).not.toMatch(/delet|remov/i);
    }
  });
});

describe("the form validates with the server's own schema", () => {
  // Not a test of the schema — lib/appointmentInput.ts owns those rules. This
  // is a test that a CLIENT component can still reach them, which is the whole
  // basis for AppointmentTypeForm not keeping a second copy.

  it("accepts what the form submits", () => {
    const parsed = createAppointmentTypeSchema.safeParse({
      clinicId: null,
      name: "Consultation",
      durationMinutes: "30",
      defaultAmount: "500",
    });
    expect(parsed.success).toBe(true);
  });

  it("reports each bad field under its own name, so the form can place it", () => {
    const parsed = createAppointmentTypeSchema.safeParse({
      clinicId: null,
      name: "",
      durationMinutes: "3",
      defaultAmount: "10.005",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    expect(fields).toContain("name");
    expect(fields).toContain("durationMinutes");
    expect(fields).toContain("defaultAmount");
  });

  it("coerces a blank number to zero — the reason the form checks first", () => {
    // This is the one rule AppointmentTypeForm adds on top of the schema. An
    // empty price field is not a free service, but `Number("")` is 0 and the
    // server cannot tell them apart once the body is JSON.
    const parsed = createAppointmentTypeSchema.safeParse({
      clinicId: null,
      name: "Consultation",
      durationMinutes: "30",
      defaultAmount: "",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.defaultAmount).toBe(0);
  });
});
