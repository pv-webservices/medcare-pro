import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/apiHandler", () => ({
  BadRequestError: class extends Error {},
  ConflictError: class extends Error {},
}));
vi.mock("@/lib/notifications", () => ({
  notifyDoctorCreated: vi.fn(),
  notifyDoctorUpdated: vi.fn(),
}));
import {
  consultationSchema,
  medicationSchema,
  prescriptionDraftSchema,
  issuedContentSchema,
  issuePrescriptionSchema,
  cancelPrescriptionSchema,
  prescriptionFiltersSchema,
} from "@/lib/prescriptionValidation";
import { createDoctorSchema, updateDoctorSchema } from "@/lib/doctors";
import { generatePrescriptionNumber } from "@/lib/prescriptionNumber";
import { prescriptionIssuedDateBounds } from "@/lib/prescriptionDates";

const medicine = {
  ...medicationSchema.parse({}),
  medicineGenericName: "Example medicine",
  dosageForm: "Tablet",
  dose: "1 tablet",
  route: "Oral",
  frequency: "Twice daily",
  durationValue: 5,
  durationUnit: "days",
};
const content = {
  consultation: {
    ...consultationSchema.parse({}),
    diagnosis: "Recorded diagnosis",
  },
  medications: [medicine],
  expectedRevision: 0,
};
describe("Prescription clinical validation", () => {
  it("accepts an unfinished draft and incomplete medicine", () =>
    expect(
      prescriptionDraftSchema.parse({
        consultation: {},
        medications: [{}],
        expectedRevision: 0,
      }).medications[0].medicineGenericName,
    ).toBe(""));
  it("rejects ownership and snapshots supplied by a browser", () => {
    for (const key of [
      "tenantId",
      "clinicId",
      "patientId",
      "doctorId",
      "snapshotJson",
      "prescriptionNumber",
      "status",
    ])
      expect(
        prescriptionDraftSchema.safeParse({ ...content, [key]: "spoofed" })
          .success,
      ).toBe(false);
  });
  it("accepts structured issuance content", () =>
    expect(issuedContentSchema.safeParse(content).success).toBe(true));
  it("requires diagnosis at issuance", () =>
    expect(
      issuedContentSchema.safeParse({ ...content, consultation: {} }).success,
    ).toBe(false));
  it("requires medications at issuance", () =>
    expect(
      issuedContentSchema.safeParse({ ...content, medications: [] }).success,
    ).toBe(false));
  it.each([
    "medicineGenericName",
    "dosageForm",
    "dose",
    "route",
    "frequency",
    "durationUnit",
  ])("requires medication %s", (key) =>
    expect(
      issuedContentSchema.safeParse({
        ...content,
        medications: [{ ...medicine, [key]: "" }],
      }).success,
    ).toBe(false),
  );
  it("rejects negative and fractional duration", () => {
    for (const durationValue of [-1, 0, 1.5, 3651])
      expect(
        medicationSchema.safeParse({ ...medicine, durationValue }).success,
      ).toBe(false);
  });
  it("permits custom dosage and route values", () =>
    expect(
      medicationSchema.safeParse({
        ...medicine,
        route: "Clinic-specific route",
        dosageForm: "Custom form",
      }).success,
    ).toBe(true));
  it("bounds clinical text and medication count", () => {
    expect(
      consultationSchema.safeParse({ advice: "a".repeat(10001) }).success,
    ).toBe(false);
    expect(
      prescriptionDraftSchema.safeParse({
        ...content,
        medications: Array.from({ length: 51 }, () => medicine),
      }).success,
    ).toBe(false);
  });
  it("issue payload cannot select another doctor", () =>
    expect(
      issuePrescriptionSchema.safeParse({
        expectedRevision: 1,
        doctorId: "other",
      }).success,
    ).toBe(false));
  it("requires a reason for cancellation", () =>
    expect(cancelPrescriptionSchema.safeParse({ reason: "  " }).success).toBe(
      false,
    ));
  it("bounds pagination and validates dates", () => {
    expect(prescriptionFiltersSchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(
      prescriptionFiltersSchema.safeParse({ from: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      prescriptionFiltersSchema.safeParse({
        from: "2026-09-12",
        to: "2026-09-11",
      }).success,
    ).toBe(false);
  });
  it("creates globally unique server numbers under simultaneous allocation", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 1000 }, async () =>
        generatePrescriptionNumber(new Date("2026-09-12T00:00:00Z")),
      ),
    );
    expect(new Set(numbers).size).toBe(1000);
    expect(
      numbers.every((number) => /^RX-2026-[A-F0-9]{32}$/.test(number)),
    ).toBe(true);
  });
  it("filters issuance days using the same India timezone as display", () => {
    const bounds = prescriptionIssuedDateBounds("2026-09-12", "2026-09-12");
    expect(bounds.gte?.toISOString()).toBe("2026-09-11T18:30:00.000Z");
    expect(bounds.lt?.toISOString()).toBe("2026-09-12T18:30:00.000Z");
  });
});
describe("Doctor professional profile compatibility", () => {
  it("keeps older doctor create requests valid", () =>
    expect(
      createDoctorSchema.safeParse({
        clinicId: "clinic",
        name: "Doctor",
        department: "General",
      }).success,
    ).toBe(true));
  it("accepts nullable credentials and clearing on edit", () =>
    expect(
      updateDoctorSchema.safeParse({
        qualification: null,
        medicalRegistrationNumber: "",
        registrationCouncil: null,
      }).success,
    ).toBe(true));
  it("bounds professional fields", () =>
    expect(
      updateDoctorSchema.safeParse({
        medicalRegistrationNumber: "x".repeat(256),
      }).success,
    ).toBe(false));
});
