import { describe, expect, it } from "vitest";
import {
  EDITABLE_FIELDS,
  EDITABLE_STATUSES,
  LOCKED_FIELDS,
  NON_EDITABLE_STATUSES,
  NO_CHANGES_MESSAGE,
  applyAppointmentEdit,
  diffAppointmentEdit,
  editRefusal,
  formatChangedFields,
  isEditableStatus,
  type AppointmentEditSnapshot,
} from "@/lib/appointmentEditRules";
import { updateAppointmentSchema } from "@/lib/appointmentInput";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
} from "@/lib/appointmentRules";

/**
 * AP-9 — what a correction may change, and when.
 *
 * The failure modes here are quiet ones. An editable set that is one field too
 * wide silently lets the front desk move an appointment without a slot check; a
 * patch rule that confuses "absent" with "blank" wipes an address nobody asked
 * it to touch; and a diff that reports a change where there is none writes a
 * false row into an append-only table.
 */

const BEFORE: AppointmentEditSnapshot = {
  name: "Priya Sharma",
  mobileNumber: "+91 98400 12345",
  age: 34,
  gender: "Female",
  address: "12 Second Avenue",
  city: "Chennai",
  amount: "500.00",
};

describe("the editable set", () => {
  it("is the patient snapshot plus the amount, and nothing else", () => {
    expect([...EDITABLE_FIELDS]).toEqual([
      "name",
      "mobileNumber",
      "age",
      "gender",
      "address",
      "city",
      "amount",
    ]);
  });

  it("never overlaps the locked set", () => {
    // The two lists are maintained by hand; an overlap would mean a field is
    // documented as untouchable and edited anyway.
    for (const field of EDITABLE_FIELDS) {
      expect(LOCKED_FIELDS).not.toContain(field);
    }
  });

  it("locks everything that decides WHEN or WITH WHOM, per AP-1 rule 2", () => {
    for (const field of [
      "slotStart",
      "slotEnd",
      "activeSlotStart",
      "doctorId",
      "appointmentTypeId",
      "clinicId",
      "status",
    ]) {
      expect(LOCKED_FIELDS).toContain(field);
    }
  });

  it("locks the patient link, which would move the money at conversion", () => {
    expect(LOCKED_FIELDS).toContain("patientId");
  });
});

describe("which appointments may be corrected", () => {
  it("is the occupying set minus CONVERTED", () => {
    // Stated as the subtraction rather than a second hand-written list, so a
    // change to what "occupying" means cannot leave this behind.
    expect([...EDITABLE_STATUSES].sort()).toEqual(
      OCCUPYING_STATUSES.filter((status) => status !== "CONVERTED")
        .slice()
        .sort(),
    );
  });

  it("refuses a converted appointment, and says where to correct it", () => {
    // THE ONE THAT MATTERS. Conversion copied the name, number and amount onto
    // a Registration. Editing the booking afterwards leaves the visit on the
    // register disagreeing with the booking it came from, with nothing able to
    // detect it.
    const refusal = editRefusal("CONVERTED");
    expect(refusal).toBeTruthy();
    expect(refusal).toMatch(/registration/i);
  });

  it("refuses a moved booking, and points at the live one", () => {
    const refusal = editRefusal("RESCHEDULED");
    expect(refusal).toMatch(/replaced it|live booking/i);
  });

  it("allows a correction when the patient is standing at the desk", () => {
    expect(editRefusal("CHECKED_IN")).toBeNull();
    expect(isEditableStatus("CHECKED_IN")).toBe(true);
  });

  it("splits every status into editable or not, with nothing left over", () => {
    const union = [...EDITABLE_STATUSES, ...NON_EDITABLE_STATUSES].sort();
    expect(union).toEqual([...APPOINTMENT_STATUSES].sort());
  });

  it("gives every refused status a sentence a receptionist can act on", () => {
    for (const status of NON_EDITABLE_STATUSES) {
      const refusal = editRefusal(status);
      expect(refusal).toBeTruthy();
      expect(refusal!.length).toBeGreaterThan(20);
      expect(refusal).not.toMatch(/[A-Z_]{4,}/);
    }
  });
});

describe("applyAppointmentEdit", () => {
  it("leaves absent fields exactly as they were", () => {
    expect(applyAppointmentEdit(BEFORE, {})).toEqual(BEFORE);
  });

  it("changes only what the patch names", () => {
    const after = applyAppointmentEdit(BEFORE, { mobileNumber: "+91 90000 11111" });
    expect(after.mobileNumber).toBe("+91 90000 11111");
    expect(after.name).toBe(BEFORE.name);
    expect(after.address).toBe(BEFORE.address);
  });

  it("treats a blank optional field as cleared, not as the string ''", () => {
    const after = applyAppointmentEdit(BEFORE, { address: "   ", city: "" });
    expect(after.address).toBeNull();
    expect(after.city).toBeNull();
  });

  it("clears the age on an explicit null but not on an absent key", () => {
    // The distinction the API depends on: `{}` must not wipe an age.
    expect(applyAppointmentEdit(BEFORE, { age: null }).age).toBeNull();
    expect(applyAppointmentEdit(BEFORE, {}).age).toBe(34);
  });

  it("keeps a zero age, which is a real newborn and not an empty field", () => {
    expect(applyAppointmentEdit(BEFORE, { age: 0 }).age).toBe(0);
  });

  it("trims a name rather than storing the desk's stray space", () => {
    expect(applyAppointmentEdit(BEFORE, { name: "  Priya S  " }).name).toBe(
      "Priya S",
    );
  });

  it("fixes the amount to two decimals so the diff can compare it", () => {
    // The column reads back as "500.00". Leaving 500 as-is would report a
    // change on every save and write a false audit row each time.
    expect(applyAppointmentEdit(BEFORE, { amount: 500 }).amount).toBe("500.00");
    expect(applyAppointmentEdit(BEFORE, { amount: 750.5 }).amount).toBe("750.50");
  });
});

describe("diffAppointmentEdit", () => {
  it("finds nothing when the same values are typed back", () => {
    const after = applyAppointmentEdit(BEFORE, {
      name: "Priya Sharma",
      amount: 500,
      age: 34,
    });
    expect(diffAppointmentEdit(BEFORE, after)).toEqual([]);
  });

  it("reports fields in the order the form shows them, not the patch order", () => {
    const after = applyAppointmentEdit(BEFORE, { amount: 750, name: "Priya S" });
    expect(diffAppointmentEdit(BEFORE, after)).toEqual(["name", "amount"]);
  });

  it("sees a field being cleared", () => {
    const after = applyAppointmentEdit(BEFORE, { city: "" });
    expect(diffAppointmentEdit(BEFORE, after)).toEqual(["city"]);
  });

  it("does not report a cleared field that was already empty", () => {
    const empty = { ...BEFORE, city: null };
    expect(diffAppointmentEdit(empty, applyAppointmentEdit(empty, { city: "" }))).toEqual(
      [],
    );
  });
});

describe("formatChangedFields", () => {
  it("names columns, never values", () => {
    // The audit trail is append-only and read during support work. "name" here
    // is the name of a COLUMN — the patient's own name must never reach it.
    const line = formatChangedFields(["name", "mobileNumber", "amount"]);
    expect(line).toBe("name, mobileNumber, amount");
    expect(line).not.toContain("Priya");
  });
});

describe("the schema and the pure patch agree", () => {
  it("parses a full form body into something applyAppointmentEdit accepts", () => {
    const parsed = updateAppointmentSchema.parse({
      name: "Priya S",
      mobileNumber: "+919000011111",
      age: null,
      gender: "",
      address: "",
      city: "Madurai",
      amount: "750.50",
    });

    // Structural, and this is also checked by tsc at the one call site in
    // lib/appointmentEdit.ts — the test is here so a drift shows as a failure
    // rather than only as a red squiggle.
    const after = applyAppointmentEdit(BEFORE, parsed);
    expect(after.age).toBeNull();
    expect(after.gender).toBeNull();
    expect(after.amount).toBe("750.50");
    expect(after.city).toBe("Madurai");
  });

  it("has no vocabulary for the slot, the doctor or the status", () => {
    // Zod strips unknown keys, so a client sending these is IGNORED rather than
    // refused — the point being that the stored value stands either way.
    const parsed = updateAppointmentSchema.parse({
      name: "Priya S",
      slotStart: "2027-01-01T09:00:00.000Z",
      doctorId: "doctor-someone-else",
      status: "CONVERTED",
      patientId: "patient-someone-else",
    }) as Record<string, unknown>;

    expect(parsed.slotStart).toBeUndefined();
    expect(parsed.doctorId).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.patientId).toBeUndefined();
    expect(parsed.name).toBe("Priya S");
  });

  it("refuses an amount with a third decimal place, which the column rounds", () => {
    expect(updateAppointmentSchema.safeParse({ amount: 10.005 }).success).toBe(
      false,
    );
  });

  it("accepts an empty body, leaving the no-op refusal to the diff", () => {
    // \`{}\` is a well-formed request that changes nothing; only a comparison
    // against the stored row can tell that, so the schema does not try.
    expect(updateAppointmentSchema.safeParse({}).success).toBe(true);
    expect(NO_CHANGES_MESSAGE).toMatch(/nothing was changed/i);
  });
});
