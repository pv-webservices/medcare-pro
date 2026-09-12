import { describe, expect, it } from "vitest";
import { patientPrescriptionDto } from "@/lib/patientPortalRecords";
import {
  consultationSchema,
  medicationSchema,
} from "@/lib/prescriptionValidation";
const snapshot = {
  schemaVersion: 1,
  prescriptionNumber: "RX-TEST",
  issuedAt: "2026-09-13T00:00:00Z",
  patient: {
    id: "patient-internal",
    patientCode: "PT-TEST",
    name: "Synthetic Patient",
    age: 30,
    gender: "Other",
    mobileNumber: "9999999999",
    address: "Synthetic address",
    city: "Synthetic city",
  },
  doctor: {
    id: "doctor-internal",
    name: "Synthetic Doctor",
    department: "General Medicine",
    qualification: "Synthetic qualification",
    medicalRegistrationNumber: "TEST-ONLY",
    registrationCouncil: "Synthetic council",
    phone: null,
  },
  clinic: {
    id: "clinic-internal",
    name: "Synthetic clinic",
    address: null,
    city: null,
    logoUrl: null,
  },
  visit: {
    registrationId: "visit-internal",
    visitDate: "2026-09-13T10:00:00Z",
    department: "General Medicine",
    visitType: "NEW",
  },
  consultation: consultationSchema.parse({
    diagnosis: "Synthetic diagnosis",
    historyOfPresentIllness: "Clinic-only field",
    examinationFindings: "Clinic-only examination",
  }),
  medications: [
    medicationSchema.parse({
      medicineGenericName: "Synthetic medicine",
      dose: "Synthetic dose",
    }),
  ],
};
describe("Patient Portal record DTO", () => {
  it.each(["ISSUED", "SUPERSEDED", "CANCELLED"])(
    "allows historical %s records",
    (status) =>
      expect(
        patientPrescriptionDto({ id: "rx", status, snapshotJson: snapshot })
          .status,
      ).toBe(status),
  );
  it.each(["DRAFT", "unknown", ""])("hides %s status", (status) =>
    expect(() =>
      patientPrescriptionDto({ id: "rx", status, snapshotJson: snapshot }),
    ).toThrow(),
  );
  it.each([null, {}, { ...snapshot, schemaVersion: 2 }])(
    "fails closed for missing or malformed snapshot %j",
    (snapshotJson) =>
      expect(() =>
        patientPrescriptionDto({ id: "rx", status: "ISSUED", snapshotJson }),
      ).toThrow(),
  );
  it("includes only the patient-safe clinical and demographic allowlist", () => {
    const dto = patientPrescriptionDto({
      id: "rx",
      status: "ISSUED",
      snapshotJson: snapshot,
    });
    expect(dto.patient.name).toBe(snapshot.patient.name);
    expect(dto.doctor.qualification).toBe(snapshot.doctor.qualification);
    expect(dto.diagnosis).toBe("Synthetic diagnosis");
    expect(dto.medications[0].medicineGenericName).toBe("Synthetic medicine");
    const json = JSON.stringify(dto);
    for (const forbidden of [
      "patient-internal",
      "doctor-internal",
      "visit-internal",
      "clinic-internal",
      "Clinic-only",
      "snapshotJson",
      "clinicalJson",
    ])
      expect(json).not.toContain(forbidden);
  });
});
