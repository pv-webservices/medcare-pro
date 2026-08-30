import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_ORDER,
  APPOINTMENT_STATUS_TONES,
  formatAppointmentDate,
} from "@/components/appointments/status";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  RELEASING_STATUSES,
} from "@/lib/appointmentRules";

/**
 * AP-6 — how each appointment status reads on screen.
 *
 * A small file for a small module, and worth having because the failure mode is
 * silent and user-visible: add an eighth status to the enum and a board row
 * renders `undefined` where its state should be, with nothing throwing and no
 * test failing anywhere else. TypeScript catches a missing key at compile time
 * only while the maps are declared over the full Record — these assertions are
 * what keep that true after somebody widens one of them to a Partial.
 *
 * The component itself is not tested here. The unit suite runs with no DOM and
 * no database (see vitest.config.ts), and this module is the part of AP-6 that
 * is a question about values rather than about rendering.
 */

describe("every status can be shown", () => {
  it("has a label for each one", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("has a tone for each one", () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it("offers every one in the filter, exactly once", () => {
    expect([...APPOINTMENT_STATUS_ORDER].sort()).toEqual(
      [...APPOINTMENT_STATUSES].sort(),
    );
    expect(new Set(APPOINTMENT_STATUS_ORDER).size).toBe(
      APPOINTMENT_STATUS_ORDER.length,
    );
  });
});

describe("the words are the front desk's, not the database's", () => {
  it("never puts an enum value on screen", () => {
    // "CHECKED_IN" is what the column holds; "Arrived" is what the desk reads.
    for (const status of APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_STATUS_LABELS[status]).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("never calls an appointment a registration, or the reverse", () => {
    // The vocabulary rule in .claude/skills/admin-dashboard-ui: the two are
    // different records. "Registered" is allowed and deliberate — it names what
    // a CONVERTED appointment BECAME, which is exactly the distinction the rule
    // asks to be kept.
    expect(APPOINTMENT_STATUS_LABELS.CONVERTED).toBe("Registered");
    for (const status of APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_STATUS_LABELS[status]).not.toMatch(/appointment/i);
      expect(APPOINTMENT_STATUS_LABELS[status]).not.toMatch(/booking/i);
    }
  });

  it("gives each label its own words", () => {
    const labels = APPOINTMENT_STATUSES.map((s) => APPOINTMENT_STATUS_LABELS[s]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("tone follows meaning", () => {
  it("marks confirmed and converted as positive ok", () => {
    expect(APPOINTMENT_STATUS_TONES.CONFIRMED).toBe("ok");
    expect(APPOINTMENT_STATUS_TONES.CONVERTED).toBe("ok");
  });

  it("marks scheduled as accent and checked in as info", () => {
    expect(APPOINTMENT_STATUS_TONES.SCHEDULED).toBe("accent");
    expect(APPOINTMENT_STATUS_TONES.CHECKED_IN).toBe("info");
  });

  it("marks cancelled and no-show as alert, moved as neutral", () => {
    expect(APPOINTMENT_STATUS_TONES.CANCELLED).toBe("alert");
    expect(APPOINTMENT_STATUS_TONES.NO_SHOW).toBe("alert");
    expect(APPOINTMENT_STATUS_TONES.RESCHEDULED).toBe("neutral");
  });

  it("never marks a cancelled or missed slot as ok", () => {
    expect(APPOINTMENT_STATUS_TONES.CANCELLED).not.toBe("ok");
    expect(APPOINTMENT_STATUS_TONES.NO_SHOW).not.toBe("ok");
  });
});

describe("formatAppointmentDate", () => {
  it("reads the stored day back as the same day", () => {
    // Parsed as UTC to match how the instant is stored. A local-time parse would
    // slip a day for any reader west of Greenwich, which is the whole reason
    // this helper exists rather than a bare `new Date(date)`.
    expect(formatAppointmentDate("2026-12-21")).toContain("21");
    expect(formatAppointmentDate("2026-01-01")).toContain("2026");
  });
});
