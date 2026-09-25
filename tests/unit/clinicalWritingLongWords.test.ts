import { describe, expect, it } from "vitest";
import { FIELD_POLICIES } from "@/lib/clinical-ai/writingSchemas";
import { isDictionarySpellingCorrection } from "@/lib/clinical-ai/clinicalLexicon";
import {
  assessClinicalWriting,
  describeWritingEdits,
} from "@/lib/clinical-ai/writingSafety";

const narrative = FIELD_POLICIES.chiefComplaint;
const restricted = FIELD_POLICIES.diagnosis;

describe("one extra edit for long misspellings of common clinical terms", () => {
  it("accepts diareaha -> diarrhea in a narrative field", () => {
    expect(assessClinicalWriting("diareaha", "diarrhea", narrative, "SPELLING").safe).toBe(true);
    expect(assessClinicalWriting("diareaha since 2 days", "diarrhea since 2 days", narrative, "SPELLING").safe).toBe(true);
  });

  it.each([
    ["diareaha", "diarrhea", 2],
    ["pnemonai", "pneumonia", 2],
  ])("accepts %s -> %s at narrative limit %d + 1", (source, target, maxDistance) => {
    expect(isDictionarySpellingCorrection({ source, target, maxDistance })).toBe(true);
  });

  it.each([
    // High-risk fields keep their single edit.
    ["diareaha", "diarrhea", 1],
    ["pnuemonai", "pneumonia", 1],
    // Target is not a common clinical term: no extra edit.
    ["diareaha", "diarial", 2],
    // Short words never get the extra edit.
    ["nasaeu", "nausea", 2],
    // Opposed prefixes still reject.
    ["hypertenson", "hypotension", 2],
  ])("rejects %s -> %s at field limit %d", (source, target, maxDistance) => {
    expect(isDictionarySpellingCorrection({ source, target, maxDistance })).toBe(false);
  });

  it("keeps restricted fields at their stricter limit", () => {
    expect(assessClinicalWriting("diareaha", "diarrhea", restricted, "SPELLING").safe).toBe(false);
  });
});

describe("change list shows whole words", () => {
  it("lists each corrected word instead of a span cut mid-word", () => {
    expect(describeWritingEdits("fiverr and coughh", "fever and cough")).toEqual([
      { originalFragment: "fiverr", suggestedFragment: "fever" },
      { originalFragment: "coughh", suggestedFragment: "cough" },
    ]);
    expect(
      describeWritingEdits("patient had fiverr last month and coughh last week", "patient had fever last month and cough last week"),
    ).toEqual([
      { originalFragment: "fiverr", suggestedFragment: "fever" },
      { originalFragment: "coughh", suggestedFragment: "cough" },
    ]);
  });

  it("falls back to a whole-word span for punctuation and capitals", () => {
    expect(describeWritingEdits("patient has fever", "Patient has fever.")).toEqual([
      { originalFragment: "patient has fever", suggestedFragment: "Patient has fever." },
    ]);
  });
});
