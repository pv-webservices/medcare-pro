import { describe, expect, it } from "vitest";
import type { EffectiveTranscriptSegment } from "@/lib/transcription/effectiveTranscript";
import {
  chunkSegments,
  conflictingFactKeys,
  mergeFacts,
  validateFactCandidate,
  type FactCandidate,
} from "@/lib/clinical-facts/evidence";
import { FACT_CATEGORIES, factExtractionOutputSchema } from "@/lib/clinical-facts/schema";

const segment = (id: string, ordinal: number, speakerType: string, text: string): EffectiveTranscriptSegment => ({
  segmentId: id, ordinal, speakerLabel: `s_${speakerType}`, speakerType, startMs: ordinal * 1000, endMs: ordinal * 1000 + 900, text, correctionId: ordinal === 3 ? "corr-1" : null,
});
const segments = [
  segment("d1", 0, "DOCTOR", "Do you have chest pain?"),
  segment("p1", 1, "PATIENT", "No chest pain. I have fever since 3 days."),
  segment("d2", 2, "DOCTOR", "Take paracetamol 500 mg twice daily for 5 days. BP is 140/90."),
  segment("p2", 3, "PATIENT", "Mujhe penicillin se allergy hai. Left knee mein dard hai."),
  segment("c1", 4, "CAREGIVER", "Uska bukhar nahi utra."),
  segment("d3", 5, "DOCTOR", "Come back after one week. My father had diabetes, you said?"),
];
const fact = (overrides: Partial<FactCandidate>): FactCandidate => ({
  category: "SYMPTOM", assertion: "PRESENT", subject: "PATIENT", statement: "Fever for 3 days",
  attributes: { name: "fever", duration: "3 days" },
  evidence: [{ segmentId: "p1", quote: "I have fever since 3 days." }],
  ...overrides,
});
const check = (candidate: FactCandidate) => validateFactCandidate(candidate, segments);

describe("AI-3 v1 scope", () => {
  it("supports exactly the 8 approved categories", () => {
    expect(FACT_CATEGORIES).toEqual(["SYMPTOM", "MEDICATION_MENTION", "ALLERGY", "MEASUREMENT", "DIAGNOSIS_MENTION", "INVESTIGATION", "ADVICE", "FOLLOW_UP"]);
  });
  it("provider output schema rejects deferred categories and unbounded lists", () => {
    const one = { ...fact({}), attributes: { name: "fever" } };
    expect(factExtractionOutputSchema.safeParse({ facts: [one] }).success).toBe(true);
    expect(factExtractionOutputSchema.safeParse({ facts: [{ ...one, category: "PLAN" }] }).success).toBe(false);
    expect(factExtractionOutputSchema.safeParse({ facts: Array(51).fill(one) }).success).toBe(false);
    expect(factExtractionOutputSchema.safeParse({ facts: [{ ...one, evidence: [] }] }).success).toBe(false);
  });
});

describe("evidence is exact and locatable", () => {
  it("accepts a supported fact and locates its quote in the effective text", () => {
    const result = check(fact({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [evidence] = result.fact.evidence;
    expect(evidence).toMatchObject({ segmentId: "p1", speakerType: "PATIENT", correctionId: null });
    expect(segments[1].text.slice(evidence.charStart, evidence.charEnd)).toBe("I have fever since 3 days.");
  });
  it("records the correction a quote came from", () => {
    const result = check(fact({ category: "ALLERGY", statement: "Allergy to penicillin", attributes: { substance: "penicillin" }, evidence: [{ segmentId: "p2", quote: "Mujhe penicillin se allergy hai." }] }));
    expect(result.ok && result.fact.evidence[0].correctionId).toBe("corr-1");
  });
  it.each([
    ["unknown segment", { evidence: [{ segmentId: "nope", quote: "fever" }] }, "UNKNOWN_SEGMENT"],
    ["invented quote", { evidence: [{ segmentId: "p1", quote: "I have high fever since 3 days." }] }, "QUOTE_NOT_FOUND"],
    ["quote from the wrong segment", { evidence: [{ segmentId: "d2", quote: "I have fever since 3 days." }] }, "QUOTE_NOT_FOUND"],
    ["changed number", { statement: "Fever for 4 days", attributes: { name: "fever", duration: "4 days" } }, "ATTRIBUTE_NOT_IN_EVIDENCE"],
    ["number only in statement", { statement: "Fever for 4 days", attributes: { name: "fever" } }, "NUMBER_NOT_IN_EVIDENCE"],
    ["laterality not said", { statement: "Right knee pain", attributes: { name: "knee pain" }, evidence: [{ segmentId: "p2", quote: "Left knee mein dard hai." }] }, "ATTRIBUTE_NOT_IN_EVIDENCE"],
    ["laterality only in statement", { statement: "Right knee dard", attributes: { name: "dard" }, evidence: [{ segmentId: "p2", quote: "Left knee mein dard hai." }] }, "LATERALITY_NOT_IN_EVIDENCE"],
    ["deferred attribute", { attributes: { name: "fever", dose: "3" } }, "UNSUPPORTED_ATTRIBUTE"],
    ["missing anchor", { attributes: { duration: "3 days" } }, "MISSING_ATTRIBUTE"],
  ])("rejects %s", (_label, overrides, reason) => {
    expect(check(fact(overrides as Partial<FactCandidate>))).toEqual({ ok: false, reason });
  });
});

describe("clinical meaning guards", () => {
  it("a doctor's question is never a fact", () => {
    for (const assertion of ["PRESENT", "NEGATED", "UNCERTAIN"] as const)
      expect(check(fact({ assertion, statement: "Chest pain", attributes: { name: "chest pain" }, evidence: [{ segmentId: "d1", quote: "Do you have chest pain?" }] }))).toEqual({ ok: false, reason: "QUESTION_AS_FACT" });
  });
  it("the patient's answer to a question is a fact", () => {
    const result = check(fact({ assertion: "NEGATED", statement: "No chest pain", attributes: { name: "chest pain" }, evidence: [{ segmentId: "d1", quote: "Do you have chest pain?" }, { segmentId: "p1", quote: "No chest pain." }] }));
    expect(result.ok).toBe(true);
  });
  it("a question mark later in the sentence still makes it a question", () => {
    expect(check(fact({ subject: "FAMILY_MEMBER", category: "DIAGNOSIS_MENTION", statement: "Father had diabetes", attributes: { name: "diabetes" }, evidence: [{ segmentId: "d3", quote: "My father had diabetes" }] }))).toEqual({ ok: false, reason: "QUESTION_AS_FACT" });
  });
  it("NEGATED requires a negation cue: silence is not a negative", () => {
    expect(check(fact({ assertion: "NEGATED", category: "ALLERGY", statement: "No known allergies", attributes: { substance: "penicillin" }, evidence: [{ segmentId: "p2", quote: "Mujhe penicillin se allergy hai." }] }))).toEqual({ ok: false, reason: "NEGATION_WITHOUT_CUE" });
  });
  it.each([
    ["English", "p1", "No chest pain.", "chest pain"],
    ["Hinglish", "c1", "Uska bukhar nahi utra.", "bukhar"],
  ])("accepts a %s negation cue", (_label, segmentId, quote, name) => {
    const subject = segmentId === "c1" ? "PATIENT" : "PATIENT";
    expect(check(fact({ assertion: "NEGATED", subject, statement: `No ${name}`, attributes: { name }, evidence: [{ segmentId, quote }] })).ok).toBe(true);
  });
  it("rejects PRESENT when the anchor is directly negated in the quote", () => {
    expect(check(fact({ statement: "Chest pain", attributes: { name: "chest pain" }, evidence: [{ segmentId: "p1", quote: "No chest pain." }] }))).toEqual({ ok: false, reason: "NEGATION_MISMATCH" });
  });
  it("subject PATIENT needs a clinical participant as evidence", () => {
    const other = [...segments, segment("o1", 6, "OTHER", "He has fever since 3 days.")];
    expect(validateFactCandidate(fact({ evidence: [{ segmentId: "o1", quote: "He has fever since 3 days." }] }), other)).toEqual({ ok: false, reason: "SUBJECT_UNSUPPORTED" });
  });
  it("rejects evidence from an unconfirmed speaker", () => {
    const unknown = [segment("u1", 0, "UNKNOWN", "I have fever since 3 days.")];
    expect(validateFactCandidate(fact({ evidence: [{ segmentId: "u1", quote: "I have fever since 3 days." }] }), unknown)).toEqual({ ok: false, reason: "UNCONFIRMED_SPEAKER" });
  });
  it("accepts a medication mention whose every attribute is verbatim", () => {
    const result = check(fact({ category: "MEDICATION_MENTION", subject: "PATIENT", statement: "Paracetamol 500 mg twice daily for 5 days", attributes: { name: "paracetamol", strength: "500 mg", frequency: "twice daily", duration: "5 days" }, evidence: [{ segmentId: "d2", quote: "Take paracetamol 500 mg twice daily for 5 days." }] }));
    expect(result.ok).toBe(true);
  });
  it("rejects a medication dose that differs from what was said", () => {
    expect(check(fact({ category: "MEDICATION_MENTION", statement: "Paracetamol 650 mg", attributes: { name: "paracetamol", strength: "650 mg" }, evidence: [{ segmentId: "d2", quote: "Take paracetamol 500 mg twice daily for 5 days." }] }))).toEqual({ ok: false, reason: "ATTRIBUTE_NOT_IN_EVIDENCE" });
  });
  it("measurement value must be exact", () => {
    const measurement = (value: string) => fact({ category: "MEASUREMENT", statement: `BP ${value}`, attributes: { name: "BP", value }, evidence: [{ segmentId: "d2", quote: "BP is 140/90." }] });
    expect(check(measurement("140/90")).ok).toBe(true);
    expect(check(measurement("140/80"))).toEqual({ ok: false, reason: "ATTRIBUTE_NOT_IN_EVIDENCE" });
  });
});

describe("merging, conflicts and chunking", () => {
  const validated = (candidate: FactCandidate) => {
    const result = check(candidate);
    if (!result.ok) throw new Error(result.reason);
    return result.fact;
  };
  it("merges duplicates from overlapping chunks and unions their evidence", () => {
    const a = validated(fact({}));
    const b = validated(fact({ evidence: [{ segmentId: "p1", quote: "I have fever since 3 days." }, { segmentId: "c1", quote: "Uska bukhar nahi utra." }], attributes: { name: "fever" } }));
    const merged = mergeFacts([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].evidence.map((e) => e.segmentId)).toEqual(["p1", "c1"]);
  });
  it("keeps contradictions and flags them instead of resolving", () => {
    const present = validated(fact({ statement: "Fever", attributes: { name: "fever" } }));
    const negated = validated(fact({ assertion: "NEGATED", statement: "No fever", attributes: { name: "bukhar" }, evidence: [{ segmentId: "c1", quote: "Uska bukhar nahi utra." }] }));
    const negatedFever = { ...negated, attributes: { name: "fever" } };
    const merged = mergeFacts([present, negatedFever]);
    expect(merged).toHaveLength(2);
    expect([...conflictingFactKeys(merged)]).toEqual(["SYMPTOM|PATIENT|fever"]);
  });
  it("chunks on segment boundaries with overlap and never drops a segment", () => {
    const many = Array.from({ length: 10 }, (_, i) => segment(`s${i}`, i, "PATIENT", "x".repeat(100)));
    const chunks = chunkSegments(many, 350, 1);
    expect(chunks.every((chunk) => chunk.length >= 1)).toBe(true);
    expect(new Set(chunks.flat().map((s) => s.segmentId)).size).toBe(10);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0].segmentId).toBe(chunks[i - 1].at(-1)!.segmentId);
    expect(chunkSegments([segment("big", 0, "PATIENT", "y".repeat(1000))], 350, 1)).toHaveLength(1);
  });
});
