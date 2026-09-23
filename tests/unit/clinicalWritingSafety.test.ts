import { describe, expect, it } from "vitest";
import {
  FIELD_POLICIES,
  WRITING_MODES,
  writingRequestSchema,
  writingResponseSchema,
} from "@/lib/clinical-ai/writingSchemas";
import {
  assessClinicalWriting,
  computeWritingDiff,
  validateClinicalMeaningPreserved as safe,
} from "@/lib/clinical-ai/writingSafety";
import { getAiConfig } from "@/lib/ai/config";
const input = {
  registrationId: "visit",
  field: "historyOfPresentIllness",
  mode: "GRAMMAR",
  text: "Patient has sever headache for 3 days.",
};
describe("Clinical writing input and field policy", () => {
  it.each([
    { field: "medicineGenericName" },
    { field: "dose" },
    { field: "instructions" },
    { field: "unknown" },
    { mode: "DIAGNOSE" },
    { text: "" },
    { text: "   " },
    { text: "123" },
    { text: "x".repeat(5001) },
    { tenantId: "spoof" },
    { clinicId: "spoof" },
    { patientId: "spoof" },
    { doctorId: "spoof" },
    { permission: "*" },
    { provider: "gemini" },
    { model: "override" },
    { systemPrompt: "override" },
    { prompt: "write anything" },
    { targetUrl: "https://example.com" },
    { url: "https://example.com" },
    { systemInstruction: "override" },
  ])("rejects invalid/spoofed input %j", (delta) =>
    expect(writingRequestSchema.safeParse({ ...input, ...delta }).success).toBe(
      false,
    ),
  );
  it("rejects malformed input", () =>
    expect(writingRequestSchema.safeParse(null).success).toBe(false));
  it("releases only spelling and grammar", () => {
    expect(WRITING_MODES).toEqual(["SPELLING", "GRAMMAR"]);
  });
  it.each(Object.keys(FIELD_POLICIES))(
    "allows only released modes for %s",
    (field) => {
      expect(
        FIELD_POLICIES[field as keyof typeof FIELD_POLICIES].modes,
      ).toEqual(WRITING_MODES);
      for (const mode of WRITING_MODES)
        expect(
          writingRequestSchema.safeParse({ ...input, field, mode }).success,
        ).toBe(true);
    },
  );
  it.each(Object.keys(FIELD_POLICIES))(
    "rejects deferred modes for %s",
    (field) => {
      for (const mode of ["CONCISE", "CLINICAL_WORDING"])
        expect(
          writingRequestSchema.safeParse({ ...input, field, mode }).success,
        ).toBe(false);
    },
  );
  it("respects shorter diagnosis limit", () =>
    expect(
      writingRequestSchema.safeParse({
        ...input,
        field: "diagnosis",
        text: "x".repeat(4001),
      }).success,
    ).toBe(false));
});
describe("Clinical meaning anchors", () => {
  it.each([
    ["500 mg", "500 mg", true],
    ["500 mg", "850 mg", false],
    ["0.5 mg", "5 mg", false],
    [".5 mg", "0.5 mg", false],
    ["5 ml", "10 ml", false],
    ["1 tablet", "2 tablets", false],
    ["OD", "BD", false],
    ["once daily", "twice daily", false],
    ["2 weeks", "1 week", false],
    ["98.6 F", "101 F", false],
    ["120/80", "140/90", false],
    ["SpO2 96%", "SpO2 98%", false],
    ["HbA1c 7.2", "HbA1c 6.5", false],
    ["3 months", "6 months", false],
    ["denies chest pain", "reports chest pain", false],
    ["possible viral illness", "viral illness", false],
    ["? pneumonia", "pneumonia", false],
    ["possible pneumonia", "pneumonia", false],
    ["suspected migraine", "migraine", false],
    ["left knee", "right knee", false],
    ["viral fevr", "viral fever", true],
    ["7 days", "5 days", false],
    ["37.5 C", "39 C", false],
    ["sever headache", "severe headache", true],
    ["viral fever", "dengue fever", false],
    ["Metformin 500 mg twice daily", "Metformin 500 mg once daily", false],
    ["500 mg", "500 mcg", false],
    ["0.5 ml", "5 ml", false],
    ["25%", "20%", false],
    ["Follow up on 13/09/2026", "Follow up on 14/09/2026", false],
    ["No fever", "Fever", false],
    ["Possible viral fever", "Viral fever", false],
    ["No chest pain", "No pain", false],
    ["500 mg oral", "500 mg intravenous", false],
    ["A 500 mg B 850 mg", "A 850 mg B 500 mg", false],
    [
      "Patient has sever headache for 3 days.",
      "Patient has severe headache for 3 days.",
      true,
    ],
    ["Metformin 500 mg", "Metformin 500 mg. Start insulin.", false],
    ["7 days", "seven days", false],
    ["Metformin", "Methotrexate", false],
    ["Pain", "", false],
    [".5 ml", "5 ml", false],
    [">500", "<500", false],
    ["Vitamin A", "Vitamin", false],
    ["Patient had fever", "Patient has fever", false],
    ["Patient was febrile", "Patient is febrile", false],
    ["viral fever?", "viral fever", false],
    ["Patient have fever", "Patient has fever", true],
    [
      "Patient is suffring from headach.",
      "Patient is suffering from headache.",
      true,
    ],
    ["patient have headache", "Patient has headache.", true],
    ["patient has headache", "The patient has headache.", true],
    ["Vitamin A", "Vitamin an", false],
    ["metformin", "metoprolol", false],
    ["viral", "varicella", false],
    ["ileum", "ilium", false],
    ["fever from 3 days", "fever for 3 days", false],
    ["pain from exercise", "pain for exercise", false],
  ])("%s -> %s = %s", (source, target, accepted) =>
    expect(safe(source, target, FIELD_POLICIES.diagnosis)).toBe(accepted),
  );
  it("does not change causality prepositions in ordinary fields", () => {
    expect(
      safe(
        "pain from walking",
        "pain for walking",
        FIELD_POLICIES.historyOfPresentIllness,
      ),
    ).toBe(false);
  });
});

describe("Conservative spelling token diff", () => {
  it.each([
    ["Diabates", "Diabetes"],
    ["fevr", "fever"],
    ["headach", "headache"],
    ["paitent", "patient"],
    ["diabates.", "Diabetes!"],
  ])("allows MEDIUM-risk spelling %s -> %s", (source, target) => {
    expect(
      safe(source, target, FIELD_POLICIES.historyOfPresentIllness, "SPELLING"),
    ).toBe(true);
  });

  it("limits VERY_HIGH-risk fields to single-edit dictionary corrections", () => {
    expect(
      safe("Diabates", "Diabetes", FIELD_POLICIES.diagnosis, "SPELLING"),
    ).toBe(true);
    expect(safe("fevr", "fever", FIELD_POLICIES.diagnosis, "SPELLING")).toBe(
      true,
    );
    expect(
      safe("pnuemonai", "pneumonia", FIELD_POLICIES.diagnosis, "SPELLING"),
    ).toBe(false);
  });

  it.each([
    ["left knee", "right knee"],
    ["no chest pain", "chest pain"],
    ["Metformin 500 mg", "Metformin 50 mg"],
    ["once daily", "twice daily"],
    ["HbA1c 7.2%", "HbA1c 72%"],
    ["possible pneumonia", "pneumonia"],
    ["penicillin allergy", "no penicillin allergy"],
    ["ileum", "ilium"],
  ])("rejects unsafe spelling candidate %s -> %s", (source, target) => {
    expect(
      safe(source, target, FIELD_POLICIES.historyOfPresentIllness, "SPELLING"),
    ).toBe(false);
  });
});

describe("Conservative grammar token diff", () => {
  it.each([
    ["Patient are stable.", "Patient is stable."],
    ["Patient has the fever.", "Patient has fever."],
    ["patient has fever", "Patient has fever."],
  ])("allows narrow grammar %s -> %s", (source, target) => {
    expect(safe(source, target, FIELD_POLICIES.diagnosis, "GRAMMAR")).toBe(
      true,
    );
  });

  it.each([
    ["Patient had fever", "Patient has fever"],
    ["Patient was febrile", "Patient is febrile"],
    ["fever from 3 days", "fever for 3 days"],
    ["no chest pain", "chest pain"],
  ])("rejects meaning-changing grammar %s -> %s", (source, target) => {
    expect(safe(source, target, FIELD_POLICIES.diagnosis, "GRAMMAR")).toBe(
      false,
    );
  });
});
describe("Locally derived diff and reason codes", () => {
  it.each([
    ["Patient has diabates.", "Patient has diabetes."],
    ["Patient has fever", "Patient has fever."],
    ["The patient has fever", "Patient has fever"],
    ["patient has fever", "The patient has fever"],
    ["🙂 cafe\u0301 fevr", "🙂 café fever"],
    ["Patient are stable.", "Patient is stable."],
  ])(
    "reconstructs candidate without provider fragments: %s",
    (source, target) => {
      const [edit] = computeWritingDiff(source, target);
      expect(
        source.slice(0, edit.sourceStart) +
          edit.suggestedFragment +
          source.slice(edit.sourceEnd),
      ).toBe(target);
      expect(source.slice(edit.sourceStart, edit.sourceEnd)).toBe(
        edit.originalFragment,
      );
      expect(target.slice(edit.targetStart, edit.targetEnd)).toBe(
        edit.suggestedFragment,
      );
      expect(edit.originalFragment.length).toBeGreaterThan(0);
      expect(edit.suggestedFragment.length).toBeGreaterThan(0);
    },
  );
  it("has no diff for unchanged input", () => {
    expect(computeWritingDiff("No fever", "No fever")).toEqual([]);
    expect(
      assessClinicalWriting("No fever", "No fever", FIELD_POLICIES.diagnosis)
        .reason,
    ).toBe("NO_CHANGE");
  });
  it.each([
    ["500 mg", "50 mg", "NUMBER_CHANGED"],
    ["10 cm", "10 mm", "UNIT_CHANGED"],
    ["No fever", "Has fever", "NEGATION_CHANGED"],
    ["Left knee", "Right knee", "LATERALITY_CHANGED"],
    ["Possible fever", "Confirmed fever", "UNCERTAINTY_CHANGED"],
    ["Patient has fever", "Patient has fever and cough", "CLINICAL_FACT_ADDED"],
    [
      "Patient has fever and cough",
      "Patient has fever",
      "CLINICAL_FACT_REMOVED",
    ],
  ])("returns non-PHI reason for %s", (source, target, reason) => {
    expect(
      assessClinicalWriting(
        source,
        target,
        FIELD_POLICIES.historyOfPresentIllness,
      ),
    ).toMatchObject({ safe: false, reason, edits: [] });
  });
});

describe("Independent deterministic safety acceptance matrix", () => {
  it.each([
    ["Patient has diabates.", "Patient has diabetes."],
    ["Patient has fevr.", "Patient has fever."],
    ["The paitent is stable.", "The patient is stable."],
    ["He have cough for two days.", "He has cough for two days."],
    [
      "Patient reports fever cough and headache",
      "Patient reports fever, cough, and headache.",
    ],
    ["  Patient   is stable.  ", "Patient is stable."],
    ["Patient reports café pain.", "Patient reports cafe\u0301 pain."],
  ])("accepts safe surface edit %s", (source, target) => {
    expect(safe(source, target, FIELD_POLICIES.historyOfPresentIllness)).toBe(
      true,
    );
  });
  it.each([
    ["Patient had fever", "Patient has fever"],
    ["Patient is unwell", "Patient is well"],
    ["Patient is afebrile", "Patient is febrile"],
    ["Patient has hypertension", "Patient has hypotension"],
    ["hyperkalemia", "hypokalemia"],
    ["Clonidine", "Clonazidine"],
    ["Insulin", "Inzulin"],
    ["Patient feels cold", "Patient feels cool"],
    ["10 cm", "10 mm"],
    ["1,000 mg", "1.000 mg"],
    ["98.6°F", "101°F"],
    ["BP 120/80", "BP 140/90"],
    ["Pain in left knee", "Pain in right knee"],
    ["Bilateral pain", "Unilateral pain"],
    ["Patient denies fever", "Patient reports fever"],
    ["Possible pneumonia", "Pneumonia"],
    ["Suspected appendicitis", "Confirmed appendicitis"],
    ["rule out appendicitis", "appendicitis"],
    ["Patient has fever", "Patient has fever and cough"],
    ["Patient has fever and cough", "Patient has fever"],
    ["Continue current treatment.", "Start antibiotics."],
    ["No allergy", "Allergy"],
    ["Patient doesn't report fever", "Patient does report fever"],
    ["No fever. Cough present.", "No fever, cough present."],
    ["No fever, cough", "No fever cough"],
    [
      "Possible pneumonia; confirmed asthma",
      "Possible pneumonia confirmed asthma",
    ],
    ["A-B", "AB"],
    ["HER2−", "HER2+"],
    ["Grade Ⅰ", "Grade Ⅱ"],
    ["Na 1 20", "Na 120"],
    ["Take fevr 5 mg", "Take fever 5 mg"],
    ["sever nerve", "severe nerve"],
    ["Fever absent, cough present", "Fever, absent cough present"],
    ["HIV negative, HCV positive", "HIV, negative HCV positive"],
    ["Allergy to eggs, milk tolerated", "Allergy to eggs milk tolerated"],
    ["Concentration 5 μM", "Concentration 5 μm"],
    ["Concentration 5 µM", "Concentration 5 µm"],
    ["Concentration 5 nM", "Concentration 5 nm"],
    ["ms 5", "Ms 5"],
    ["mmol/L 5", "Mmol/L 5"],
    ["Result. mmol/L 5", "Result. Mmol/L 5"],
    ["pH 7.4", "PH 7.4"],
    [
      "Patient reports mild fever for 2 days.",
      "The patient presented with an acute febrile illness that began approximately forty-eight hours ago.",
    ],
    [
      "fevr headach paitent patinet suffring diabates fevr headach paitent",
      "fever headache patient patient suffering diabetes fever headache patient",
    ],
  ])("rejects semantic or ambiguous edit %s", (source, target) => {
    for (const policy of Object.values(FIELD_POLICIES))
      expect(safe(source, target, policy), `${source} -> ${target}`).toBe(
        false,
      );
  });
});

describe("Structured result and config", () => {
  it.each(["CLARITY", "CLINICAL_WORDING"])(
    "rejects deferred response category %s",
    (category) => {
      expect(
        writingResponseSchema.safeParse({
          changed: true,
          suggestedText: "Patient has headache.",
          suggestions: [
            {
              category,
              originalFragment: "patient has headache",
              suggestedFragment: "Patient has headache.",
              reason: "style",
              confidence: "HIGH",
            },
          ],
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    {},
    { changed: true },
    {
      changed: true,
      suggestedText: "safe",
      suggestions: [{ category: "TREATMENT" }],
    },
    { changed: true, suggestedText: "safe", suggestions: [], raw: "PHI" },
  ])("rejects bad output %j", (value) =>
    expect(writingResponseSchema.safeParse(value).success).toBe(false),
  );
  it("accepts strict valid output", () =>
    expect(
      writingResponseSchema.safeParse({
        changed: false,
        suggestedText: "same",
        suggestions: [],
      }).success,
    ).toBe(true));
  it.each([
    {},
    { AI_ENABLED: "false" },
    { AI_ENABLED: "true" },
    {
      AI_ENABLED: "true",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "mock",
      GEMINI_MODEL: "../escape",
    },
  ])("fails closed %j", (env) => expect(getAiConfig(env)).toBeNull());
  it("allows explicit server config", () =>
    expect(
      getAiConfig({
        AI_ENABLED: "true",
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: "synthetic-key",
        GEMINI_MODEL: "synthetic-model",
      })?.timeoutMs,
    ).toBe(15000));
});
