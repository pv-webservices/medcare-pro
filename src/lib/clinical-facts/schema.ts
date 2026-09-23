import { z } from "zod";

// v1 scope (PRD §13 Q3): the categories AI-4 consumes. The remaining six
// (CHIEF_COMPLAINT, HISTORY, PAST_MEDICAL_HISTORY, EXAM_FINDING, ASSESSMENT,
// PLAN) are deferred to v1.1.
export const FACT_CATEGORIES = [
  "SYMPTOM",
  "MEDICATION_MENTION",
  "ALLERGY",
  "MEASUREMENT",
  "DIAGNOSIS_MENTION",
  "INVESTIGATION",
  "ADVICE",
  "FOLLOW_UP",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const FACT_ASSERTIONS = [
  "PRESENT",
  "NEGATED",
  "UNCERTAIN",
  "HISTORICAL",
  "CONDITIONAL",
] as const;
export type FactAssertion = (typeof FACT_ASSERTIONS)[number];

export const FACT_SUBJECTS = [
  "PATIENT",
  "FAMILY_MEMBER",
  "OTHER",
  "UNKNOWN",
] as const;
export type FactSubject = (typeof FACT_SUBJECTS)[number];

/** Allowed attributes per category; the first is the required anchor. Every
 * value must be a verbatim span of the evidence (AI-4 normalizes, not AI-3). */
export const CATEGORY_ATTRIBUTES: Record<
  FactCategory,
  { anchor: readonly string[]; optional: readonly string[] }
> = {
  SYMPTOM: { anchor: ["name"], optional: ["duration", "laterality", "severity"] },
  MEDICATION_MENTION: {
    anchor: ["name"],
    optional: ["strength", "dose", "route", "frequency", "duration"],
  },
  ALLERGY: { anchor: ["substance"], optional: ["reaction"] },
  MEASUREMENT: { anchor: ["name", "value"], optional: ["unit"] },
  DIAGNOSIS_MENTION: { anchor: ["name"], optional: [] },
  INVESTIGATION: { anchor: ["name"], optional: ["result"] },
  ADVICE: { anchor: ["text"], optional: [] },
  FOLLOW_UP: { anchor: ["interval"], optional: [] },
};

export const ATTRIBUTE_KEYS = [
  ...new Set(
    Object.values(CATEGORY_ATTRIBUTES).flatMap((a) => [...a.anchor, ...a.optional]),
  ),
];

const text = (max: number) => z.string().trim().min(1).max(max);

// Provider contract: deliberately flat (no per-category unions) so it maps onto
// Gemini's response-schema subset. MedCare's validator enforces per-category
// rules afterwards; nothing here is trusted.
export const factCandidateSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  assertion: z.enum(FACT_ASSERTIONS),
  subject: z.enum(FACT_SUBJECTS),
  statement: text(500),
  // Explicit optional keys, not a record: Gemini's schema subset (see
  // sanitizeGeminiSchema) drops additionalProperties, which a record needs.
  attributes: z.object(
    Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, text(200).optional()])),
  ),
  evidence: z
    .array(z.object({ segmentId: text(191), quote: text(300) }))
    .min(1)
    .max(5),
});

export const factExtractionOutputSchema = z.object({
  facts: z.array(factCandidateSchema).max(50),
});
export type FactExtractionOutput = z.infer<typeof factExtractionOutputSchema>;

/** One explicit decision for one fact; strict, so no bulk or spoofed fields. */
export const factReviewSchema = z.strictObject({
  decision: z.enum(["ACCEPTED", "DISMISSED"]),
  reason: z.string().trim().max(500).optional(),
});
export type FactReviewInput = z.infer<typeof factReviewSchema>;
