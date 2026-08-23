import { describe, expect, it } from "vitest";
import {
  NON_REMINDABLE_STATUSES,
  NO_PATIENT_MESSAGE,
  REMINDABLE_STATUSES,
  isRemindableStatus,
  reminderRefusal,
  reminderTemplateValues,
  type ReminderFacts,
} from "@/lib/appointmentReminderRules";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
} from "@/lib/appointmentRules";
import {
  MISSING_VALUE,
  renderTemplate,
  TEMPLATE_PLACEHOLDERS,
} from "@/lib/whatsappTemplateText";

/**
 * AP-8 — when a reminder may go out, and what it says.
 *
 * The failure modes here are all messages that reach a real patient's phone, so
 * they are worth pinning precisely: reminding somebody who is already in the
 * waiting room, reminding somebody whose appointment was cancelled, or — the
 * quietest and worst — sending a confident sentence containing the date of
 * their LAST visit instead of their next appointment.
 */

const FACTS: ReminderFacts = {
  patientName: "Priya Sharma",
  patientCode: "PT-2026-0041",
  clinicName: "Anna Nagar",
  doctorName: "Dr Rao",
  department: "Cardiology",
  serviceName: "Consultation",
  slotDate: "2026-12-21",
  slotTime: "09:30",
};

describe("which appointments can be reminded", () => {
  it("is exactly the two states still ahead of the patient", () => {
    expect([...REMINDABLE_STATUSES].sort()).toEqual(["CONFIRMED", "SCHEDULED"]);
  });

  it("is NOT the occupying set, which is the tempting shortcut", () => {
    // OCCUPYING_STATUSES includes CHECKED_IN and CONVERTED. Texting "don't
    // forget your appointment" to someone in the waiting room is exactly the
    // kind of message that gets a sending number reported.
    expect(OCCUPYING_STATUSES).toContain("CHECKED_IN");
    expect(isRemindableStatus("CHECKED_IN")).toBe(false);
    expect(isRemindableStatus("CONVERTED")).toBe(false);
  });

  it("splits every status into remindable or not, with nothing left over", () => {
    const union = [...REMINDABLE_STATUSES, ...NON_REMINDABLE_STATUSES].sort();
    expect(union).toEqual([...APPOINTMENT_STATUSES].sort());
  });
});

describe("reminderRefusal", () => {
  it("allows a booked appointment that has a patient record", () => {
    expect(reminderRefusal("SCHEDULED", true)).toBeNull();
    expect(reminderRefusal("CONFIRMED", true)).toBeNull();
  });

  it("explains a booking with no patient record yet", () => {
    // The AP-8 limitation, stated to the person who can act on it rather than
    // hidden: whatsapp_messages.patient_id is NOT NULL, so there is nothing to
    // file the send against until the patient exists.
    expect(reminderRefusal("SCHEDULED", false)).toBe(NO_PATIENT_MESSAGE);
  });

  it("gives every non-remindable status a real sentence", () => {
    for (const status of NON_REMINDABLE_STATUSES) {
      const refusal = reminderRefusal(status, true);
      expect(refusal).toBeTruthy();
      expect(refusal!.length).toBeGreaterThan(20);
      // A refusal is read by the front desk, not by a developer.
      expect(refusal).not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it("judges the status before the patient record", () => {
    // Both are wrong at once here. Telling somebody to register a patient whose
    // appointment was cancelled last week sends them to do a useless thing.
    const refusal = reminderRefusal("CANCELLED", false);
    expect(refusal).not.toBe(NO_PATIENT_MESSAGE);
    expect(refusal).toMatch(/cancelled/i);
  });
});

describe("reminderTemplateValues", () => {
  it("fills the appointment group from the slot", () => {
    const values = reminderTemplateValues(FACTS);
    expect(values.appointmentDate).toBe("2026-12-21");
    expect(values.appointmentTime).toBe("09:30");
    expect(values.serviceName).toBe("Consultation");
  });

  it("leaves the visit group empty, so a wrong date cannot be sent", () => {
    // THE POINT OF THE WHOLE SPLIT. visitDate describes a registration that
    // already happened. Filling it here from the patient's last visit would put
    // a date in a reminder that is real, plausible and wrong.
    const values = reminderTemplateValues(FACTS);
    expect(values.visitDate).toBeUndefined();
    expect(values.visitTime).toBeUndefined();
    expect(values.amount).toBeUndefined();
  });

  it("renders a visit-group token as a visible gap, not a plausible date", () => {
    const body = "See you on {visitDate}";
    expect(renderTemplate(body, reminderTemplateValues(FACTS))).toBe(
      `See you on ${MISSING_VALUE}`,
    );
  });

  it("renders a whole reminder correctly", () => {
    const body =
      "Hello {patientName}, this is a reminder of your {serviceName} with {doctorName} at {clinicName} on {appointmentDate} at {appointmentTime}.";
    expect(renderTemplate(body, reminderTemplateValues(FACTS))).toBe(
      "Hello Priya Sharma, this is a reminder of your Consultation with Dr Rao at Anna Nagar on 2026-12-21 at 09:30.",
    );
  });

  it("shows an em dash for a patient with no code rather than the word null", () => {
    const values = reminderTemplateValues({ ...FACTS, patientCode: null });
    expect(values.patientCode).toBeUndefined();
    expect(renderTemplate("{patientCode}", values)).toBe(MISSING_VALUE);
  });

  it("only ever produces known placeholders", () => {
    // A key here that the template editor does not offer would be a value
    // nothing can reference — dead weight that reads as a feature.
    for (const key of Object.keys(reminderTemplateValues(FACTS))) {
      expect(TEMPLATE_PLACEHOLDERS).toContain(key);
    }
  });
});

describe("the appointment placeholders are offered to template authors", () => {
  it("lists all three", () => {
    for (const token of ["appointmentDate", "appointmentTime", "serviceName"]) {
      expect(TEMPLATE_PLACEHOLDERS).toContain(token);
    }
  });

  it("keeps the visit group, which the Messages screen still fills", () => {
    // AP-8 adds to this list; it must not have taken anything away, or every
    // template written before this stage would break.
    for (const token of [
      "patientName",
      "patientCode",
      "clinicName",
      "doctorName",
      "department",
      "visitDate",
      "visitTime",
      "amount",
    ]) {
      expect(TEMPLATE_PLACEHOLDERS).toContain(token);
    }
  });
});
