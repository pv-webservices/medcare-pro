import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  ALREADY_CONVERTED_MESSAGE,
  CONVERTIBLE_STATUSES,
  DEPARTMENT_REQUIRED_MESSAGE,
  canConvertAppointment,
  conversionAuditMetadata,
  conversionRefusal,
  departmentForConversion,
  isAppointmentLinkConflict,
  uniqueConstraintTarget,
  visitTypeForConversion,
} from "@/lib/appointmentConversionRules";
import {
  ALLOWED_STATUS_TRANSITIONS,
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  TERMINAL_STATUSES,
  activeSlotStartForStatus,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import { appointmentTransitionRefusal } from "@/lib/appointmentInput";
import { assertSafeAuditMetadata } from "@/lib/audit";

/**
 * AP-5 — the conversion rules that can be checked without a database.
 *
 * scripts/verify-ap5-appointment-conversion.mts covers what needs real rows:
 * that exactly one Registration comes out of two racing conversions, that the
 * patient code is really minted and really unique, that the audit row is really
 * atomic with the write. Everything here is a question about values, and every
 * one of them is a rule that fails SILENTLY if it drifts — a widened status set
 * does not throw, it turns a cancelled slot into revenue; a defaulted
 * department does not throw, it drops a visit out of FR-6.4's totals.
 */

const OTHER_STATUSES = APPOINTMENT_STATUSES.filter(
  (status) => !CONVERTIBLE_STATUSES.includes(status),
);

/** Prisma's own error shape, so the classifier is tested against the real one. */
function p2002(target: string | string[] | undefined) {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed",
    { code: "P2002", clientVersion: "test", meta: target ? { target } : {} },
  );
}

describe("which statuses may be converted", () => {
  it("is CHECKED_IN and nothing else", () => {
    // The product rule this whole stage rests on: CHECK-IN IS MANDATORY.
    // Converting records a visit that happened, and arriving is what makes a
    // visit real. Widening this is a change to AP-1's transition table.
    expect([...CONVERTIBLE_STATUSES]).toEqual(["CHECKED_IN"]);
  });

  it("is derived from the transition table, not restated beside it", () => {
    // The failure this guards: someone adds SCHEDULED -> CONVERTED to the table
    // and a hand-written list here silently keeps refusing it, or the reverse.
    const fromTable = APPOINTMENT_STATUSES.filter((status) =>
      ALLOWED_STATUS_TRANSITIONS[status].includes("CONVERTED"),
    );
    expect([...CONVERTIBLE_STATUSES]).toEqual(fromTable);
  });

  it("accepts every convertible status", () => {
    for (const status of CONVERTIBLE_STATUSES) {
      expect(canConvertAppointment(status)).toBe(true);
      expect(conversionRefusal(status)).toBeNull();
    }
  });

  it("refuses every other status with a reason", () => {
    // Six of the seven, including the three the prompt for this stage names
    // explicitly: CANCELLED, NO_SHOW and RESCHEDULED.
    expect(OTHER_STATUSES.length).toBe(APPOINTMENT_STATUSES.length - 1);

    for (const status of OTHER_STATUSES) {
      expect(canConvertAppointment(status)).toBe(false);
      expect(conversionRefusal(status)).toBeTruthy();
    }
  });

  it("refuses a booked or confirmed appointment that has not arrived", () => {
    // Stated separately from the loop above, because these two are the ones a
    // "let the desk convert a walk-through" change would quietly flip.
    expect(canConvertAppointment("SCHEDULED")).toBe(false);
    expect(canConvertAppointment("CONFIRMED")).toBe(false);
  });

  it("refuses an already-converted appointment rather than repeating it", () => {
    expect(canConvertAppointment("CONVERTED")).toBe(false);
    expect(conversionRefusal("CONVERTED")).toBe(ALREADY_CONVERTED_MESSAGE);
  });

  it("tells the racing loser exactly what the double-clicker is told", () => {
    // The constant and the shared refusal builder must not drift: one is what
    // the unique index produces, the other what the status check produces, and
    // they describe the same situation.
    expect(appointmentTransitionRefusal("CONVERTED", "CONVERTED")).toBe(
      ALREADY_CONVERTED_MESSAGE,
    );
  });

  it("names no internal status value in any refusal", () => {
    // A receptionist reads these. SCREAMING_SNAKE in the message would be a
    // leak of the enum into the front desk's vocabulary.
    for (const status of OTHER_STATUSES) {
      expect(conversionRefusal(status)).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    }
  });
});

describe("CONVERTED after the fact", () => {
  it("is terminal, so nothing converts twice or moves on afterwards", () => {
    expect(TERMINAL_STATUSES).toContain("CONVERTED");
    expect(ALLOWED_STATUS_TRANSITIONS.CONVERTED).toEqual([]);
  });

  it("still occupies the doctor's time", () => {
    // AP-1's decision, and the one thing AP-5 must not undo: a visit that
    // demonstrably happened consumed the slot.
    const slotStart = new Date("2026-09-01T09:30:00.000Z");
    expect(OCCUPYING_STATUSES).toContain("CONVERTED");
    expect(activeSlotStartForStatus("CONVERTED", slotStart)).toEqual(slotStart);
  });
});

describe("departmentForConversion", () => {
  it("takes the doctor's department", () => {
    expect(departmentForConversion("Cardiology")).toBe("Cardiology");
  });

  it("trims it, so a padded value is not stored padded", () => {
    expect(departmentForConversion("  Dermatology  ")).toBe("Dermatology");
  });

  it("reports absence rather than defaulting", () => {
    // Never "General", never "". registrations.department is required and
    // FR-6.4 reports on it; an invented value is a wrong departmental total,
    // which is worse than a refused conversion because nobody notices it.
    for (const absent of [null, undefined, "", "   ", "\t\n"]) {
      expect(departmentForConversion(absent)).toBeNull();
    }
  });

  it("has a message that says what to do about it", () => {
    expect(DEPARTMENT_REQUIRED_MESSAGE).toMatch(/department/i);
  });
});

describe("visitTypeForConversion", () => {
  it("calls a first visit NEW", () => {
    expect(visitTypeForConversion(null)).toBe("NEW");
  });

  it("calls a known patient's visit FOLLOW_UP", () => {
    expect(visitTypeForConversion("pat_1")).toBe("FOLLOW_UP");
  });

  it("only ever returns a value from the closed list", () => {
    // visit_type is validated against VISIT_TYPES. Conversion does NOT invent
    // an "APPOINTMENT" value to mark where a visit came from — appointment_id
    // already records that, as a foreign key rather than a magic string.
    //
    // VISIT_TYPES itself is not imported: it lives in lib/registrations.ts,
    // which reaches Prisma and the session, and this suite runs with neither
    // (see vitest.config.ts). The compiler is the guard that the two agree —
    // the function is DECLARED as returning VisitType, so a third value here
    // fails `npm run typecheck`. What this asserts is the mapping.
    expect(new Set([visitTypeForConversion(null), visitTypeForConversion("pat_1")]))
      .toEqual(new Set(["NEW", "FOLLOW_UP"]));
  });
});

describe("the APPOINTMENT_CONVERTED audit payload", () => {
  // Exactly what lib/appointmentLifecycle.ts's appointmentAuditShape produces,
  // which is what the real call site passes in.
  const shape = {
    clinicId: "cli_1",
    doctorId: "doc_1",
    appointmentTypeId: "typ_1",
    date: "2026-09-01",
    startTime: "09:30",
    endTime: "10:00",
    status: "CONVERTED",
  };

  it("carries the scheduling fact plus the registration id", () => {
    expect(conversionAuditMetadata(shape, "reg_1")).toEqual({
      ...shape,
      registrationId: "reg_1",
    });
  });

  it("passes the real assertSafeAuditMetadata", () => {
    // The actual guard, over the actual payload — not a re-implementation of
    // its rules. This is the test that fails if somebody adds patientCode.
    expect(() =>
      assertSafeAuditMetadata(conversionAuditMetadata(shape, "reg_1")),
    ).not.toThrow();
  });

  it("carries no patient identity of any kind", () => {
    const keys = Object.keys(conversionAuditMetadata(shape, "reg_1"));
    for (const forbidden of [
      "name",
      "patientName",
      "mobileNumber",
      "address",
      "city",
      "age",
      "gender",
      "patientId",
      "patientCode",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("would be refused if a patient code were ever added to it", () => {
    // Proves the guard is live rather than merely present: "code" is a
    // forbidden substring, so this is caught at the write, not in review.
    expect(() =>
      assertSafeAuditMetadata({
        ...conversionAuditMetadata(shape, "reg_1"),
        patientCode: "PT-2026-0001",
      }),
    ).toThrow(/code/i);
  });
});

describe("telling the two unique indexes apart", () => {
  it("reads the constraint name whether Prisma sends a string or an array", () => {
    expect(uniqueConstraintTarget(p2002("registrations_appointment_id_key"))).toBe(
      "registrations_appointment_id_key",
    );
    expect(
      uniqueConstraintTarget(p2002(["tenant_id", "patient_code"])),
    ).toBe("tenant_id,patient_code");
  });

  it("says nothing about an error that is not a Prisma one", () => {
    expect(uniqueConstraintTarget(new Error("boom"))).toBe("");
    expect(uniqueConstraintTarget(undefined)).toBe("");
    expect(uniqueConstraintTarget(p2002(undefined))).toBe("");
  });

  it("recognises a second conversion of the same appointment", () => {
    expect(isAppointmentLinkConflict(p2002("registrations_appointment_id_key"))).toBe(
      true,
    );
    expect(isAppointmentLinkConflict(p2002(["appointment_id"]))).toBe(true);
  });

  it("does not mistake a patient-code collision for one", () => {
    // The consequence of getting this wrong is specific: a code collision is
    // retryable and a double conversion is settled. Confusing them either
    // retries a decided question five times, or gives up on a first visit that
    // simply needed the next number.
    expect(
      isAppointmentLinkConflict(p2002("patients_tenant_id_patient_code_key")),
    ).toBe(false);
    expect(isAppointmentLinkConflict(p2002(["tenant_id", "patient_code"]))).toBe(
      false,
    );
  });

  it("does not mistake the occupancy backstop for one", () => {
    expect(
      isAppointmentLinkConflict(p2002("appointments_doctor_id_active_slot_start_key")),
    ).toBe(false);
  });

  it("claims nothing about an unnamed or unrelated error", () => {
    expect(isAppointmentLinkConflict(p2002(undefined))).toBe(false);
    expect(isAppointmentLinkConflict(new Error("boom"))).toBe(false);
  });
});

describe("the status set stays in step with the enum", () => {
  it("names only statuses the rules module knows", () => {
    for (const status of CONVERTIBLE_STATUSES) {
      expect(APPOINTMENT_STATUSES).toContain(status as AppointmentStatus);
    }
  });
});
