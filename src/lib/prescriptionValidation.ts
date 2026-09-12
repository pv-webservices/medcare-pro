import { z } from "zod";
import { isDateOnly } from "@/lib/dates";

const note = (max: number) => z.string().trim().max(max).default("");
export const consultationSchema = z.strictObject({
  consultationMode: z
    .enum(["IN_PERSON", "VIDEO", "AUDIO", "TEXT"])
    .default("IN_PERSON"),
  chiefComplaint: note(4000),
  historyOfPresentIllness: note(10000),
  pastMedicalHistory: note(10000),
  examinationFindings: note(10000),
  investigationNotes: note(10000),
  diagnosis: note(4000),
  advice: note(10000),
  followUpInstructions: note(4000),
});
export const medicationSchema = z.strictObject({
  medicineGenericName: note(255),
  brandName: note(255),
  dosageForm: note(100),
  strength: note(100),
  dose: note(100),
  route: note(100),
  frequency: note(100),
  timing: note(100),
  durationValue: z.number().int().min(1).max(3650).nullable().default(null),
  durationUnit: note(50),
  quantity: z.number().int().min(1).max(100000).nullable().default(null),
  instructions: note(4000),
});
export const prescriptionDraftSchema = z.strictObject({
  consultation: consultationSchema,
  medications: z.array(medicationSchema).max(50),
  // Optimistic revision protects two tabs from overwriting clinical work.
  expectedRevision: z.number().int().nonnegative(),
});
export const issuePrescriptionSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});
export const correctionPrescriptionSchema = z.strictObject({});
export const cancelPrescriptionSchema = z.strictObject({
  reason: z.string().trim().min(1, "Enter a cancellation reason.").max(2000),
});
export const prescriptionFiltersSchema = z
  .strictObject({
    q: z.string().trim().max(255).default(""),
    patientId: z.string().max(191).optional(),
    registrationId: z.string().max(191).optional(),
    clinicId: z.string().max(191).optional(),
    doctorId: z.string().max(191).optional(),
    status: z.enum(["DRAFT", "ISSUED", "SUPERSEDED", "CANCELLED"]).optional(),
    from: z.string().refine(isDateOnly, "Invalid start date.").optional(),
    to: z.string().refine(isDateOnly, "Invalid end date.").optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "End date must follow start date.",
  );

export type ConsultationInput = z.infer<typeof consultationSchema>;
export type MedicationInput = z.infer<typeof medicationSchema>;
export type PrescriptionDraftInput = z.infer<typeof prescriptionDraftSchema>;
export type PrescriptionFilters = z.infer<typeof prescriptionFiltersSchema>;

// Drafts accept incomplete rows; issuance requires meaningful clinical content.
export const issuedContentSchema = prescriptionDraftSchema.superRefine(
  (value, ctx) => {
    if (!value.consultation.diagnosis)
      ctx.addIssue({
        code: "custom",
        path: ["consultation", "diagnosis"],
        message: "Enter a diagnosis before issuing.",
      });
    if (!value.medications.length)
      ctx.addIssue({
        code: "custom",
        path: ["medications"],
        message: "Add at least one medication before issuing.",
      });
    value.medications.forEach((item, index) => {
      for (const key of [
        "medicineGenericName",
        "dosageForm",
        "dose",
        "route",
        "frequency",
      ] as const) {
        if (!item[key])
          ctx.addIssue({
            code: "custom",
            path: ["medications", index, key],
            message: `Medication ${index + 1}: enter ${key.replace(/([A-Z])/g, " $1").toLowerCase()}.`,
          });
      }
      if (item.durationValue === null || !item.durationUnit)
        ctx.addIssue({
          code: "custom",
          path: ["medications", index, "durationValue"],
          message: `Medication ${index + 1}: enter duration and unit.`,
        });
    });
  },
);

export const CLINICAL_FIELDS = [
  ["chiefComplaint", "Chief complaint / symptoms", 4000],
  ["historyOfPresentIllness", "History of present illness", 10000],
  ["pastMedicalHistory", "Past medical / relevant history", 10000],
  ["examinationFindings", "Examination / clinical findings", 10000],
  ["diagnosis", "Diagnosis / provisional diagnosis", 4000],
  ["investigationNotes", "Investigations advised", 10000],
  ["advice", "General advice", 10000],
  ["followUpInstructions", "Follow-up instructions", 4000],
] as const;
export const MEDICATION_OPTIONS = {
  dosageForm: [
    "Tablet",
    "Capsule",
    "Syrup",
    "Suspension",
    "Injection",
    "Cream",
    "Ointment",
    "Gel",
    "Drops",
    "Inhaler",
    "Powder",
    "Lotion",
    "Other",
  ],
  route: [
    "Oral",
    "Topical",
    "Intramuscular",
    "Intravenous",
    "Subcutaneous",
    "Inhalation",
    "Nasal",
    "Ophthalmic",
    "Otic",
    "Rectal",
    "Sublingual",
    "Other",
  ],
  frequency: [
    "Once daily",
    "Twice daily",
    "Three times daily",
    "Four times daily",
    "Every 4 hours",
    "Every 6 hours",
    "Every 8 hours",
    "Every 12 hours",
    "At bedtime",
    "As needed",
    "Weekly",
  ],
  timing: [
    "Before food",
    "After food",
    "With food",
    "Empty stomach",
    "At bedtime",
    "Any time",
  ],
  durationUnit: ["days", "weeks", "months"],
} as const;

const nullableText = z.string().nullable();
export const prescriptionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  prescriptionNumber: z.string(),
  issuedAt: z.string(),
  patient: z.object({
    id: z.string(),
    patientCode: z.string(),
    name: z.string(),
    age: z.number().nullable(),
    gender: nullableText,
    mobileNumber: z.string(),
    address: nullableText,
    city: nullableText,
  }),
  doctor: z.object({
    id: z.string(),
    name: z.string(),
    department: z.string(),
    qualification: z.string(),
    medicalRegistrationNumber: z.string(),
    registrationCouncil: z.string(),
    phone: nullableText,
  }),
  clinic: z.object({
    id: z.string(),
    name: z.string(),
    address: nullableText,
    city: nullableText,
    logoUrl: nullableText,
    phone: nullableText.default(null),
  }),
  visit: z.object({
    registrationId: z.string(),
    visitDate: z.string(),
    department: z.string(),
    visitType: z.string(),
  }),
  consultation: consultationSchema,
  medications: z.array(medicationSchema),
});
export type PrescriptionSnapshot = z.infer<typeof prescriptionSnapshotSchema>;
