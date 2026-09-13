import { z } from "zod";
export const WRITING_MODES = [
  "SPELLING",
  "GRAMMAR",
  "CONCISE",
  "CLINICAL_WORDING",
] as const;
const restricted = {
  modes: ["SPELLING", "GRAMMAR"] as readonly (typeof WRITING_MODES)[number][],
  semanticRisk: "VERY_HIGH" as const,
  maxLength: 4000,
};
const normal = {
  modes: WRITING_MODES,
  semanticRisk: "MEDIUM" as const,
  maxLength: 5000,
};
export const FIELD_POLICIES = {
  chiefComplaint: { ...normal, maxLength: 4000 },
  historyOfPresentIllness: normal,
  pastMedicalHistory: { ...restricted, maxLength: 5000 },
  examinationFindings: { ...restricted, maxLength: 5000 },
  investigationNotes: { ...restricted, maxLength: 5000 },
  diagnosis: restricted,
  advice: { ...restricted, maxLength: 5000 },
  followUpInstructions: restricted,
} as const;
export type WritingField = keyof typeof FIELD_POLICIES;
export type FieldPolicy = (typeof FIELD_POLICIES)[WritingField];
export const writingRequestSchema = z
  .strictObject({
    registrationId: z.string().min(1).max(191),
    field: z.enum(
      Object.keys(FIELD_POLICIES) as [WritingField, ...WritingField[]],
    ),
    mode: z.enum(WRITING_MODES),
    text: z
      .string()
      .min(3)
      .max(5000)
      .refine(
        (t) => t.trim().length >= 3 && /\p{L}/u.test(t),
        "Enter meaningful note text.",
      ),
  })
  .superRefine((v, ctx) => {
    const policy = FIELD_POLICIES[v.field];
    if (!policy.modes.includes(v.mode))
      ctx.addIssue({
        code: "custom",
        path: ["mode"],
        message: "This mode is unavailable for this clinical field.",
      });
    if (v.text.length > policy.maxLength)
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "This clinical field exceeds the assistant's length limit.",
      });
  });
export const writingResponseSchema = z.strictObject({
  changed: z.boolean(),
  suggestedText: z.string().max(10000),
  suggestions: z
    .array(
      z.strictObject({
        category: z.enum([
          "SPELLING",
          "GRAMMAR",
          "CLARITY",
          "CLINICAL_WORDING",
        ]),
        originalFragment: z.string().min(1).max(5000),
        suggestedFragment: z.string().min(1).max(10000),
        reason: z.string().max(300),
        confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
      }),
    )
    .max(20),
});
export type WritingResponse = z.infer<typeof writingResponseSchema>;
export type WritingRequest = z.infer<typeof writingRequestSchema>;
