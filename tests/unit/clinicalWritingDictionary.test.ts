import { describe, expect, it } from "vitest";
import { FIELD_POLICIES } from "@/lib/clinical-ai/writingSchemas";
import {
  assessClinicalWriting,
  validateClinicalMeaningPreserved as safe,
} from "@/lib/clinical-ai/writingSafety";
import {
  editDistance,
  isKnownClinicalWord,
} from "@/lib/clinical-ai/clinicalLexicon";

const narrative = FIELD_POLICIES.historyOfPresentIllness;
const diagnosis = FIELD_POLICIES.diagnosis;

describe("Clinical lexicon", () => {
  it("recognizes English and supplemented clinical vocabulary", () => {
    for (const word of ["fever", "ileum", "ileus", "afebrile", "hyperkalemia", "hyponatremia", "dyslipidemia"])
      expect(isKnownClinicalWord(word), word).toBe(true);
    for (const word of ["fevr", "diabates", "vomitting", "hyprkalemia"])
      expect(isKnownClinicalWord(word), word).toBe(false);
  });
  it("counts an adjacent transposition as one edit", () => {
    expect(editDistance("paitent", "patient")).toBe(1);
    expect(editDistance("tonslitis", "tonsillitis")).toBe(2);
    expect(editDistance("fever", "fever")).toBe(0);
    expect(editDistance("abc", "xyzuvw", 2)).toBeGreaterThan(2);
  });
});

describe("Dictionary spelling correction: useful corrections are accepted", () => {
  it.each([
    ["Patient has vomitting since morning.", "Patient has vomiting since morning."],
    ["Complains of abdomnal pain.", "Complains of abdominal pain."],
    ["Complains of breathlesness on exertion.", "Complains of breathlessness on exertion."],
    ["Known case of hypertnesion.", "Known case of hypertension."],
    ["Loose stools with diarhea.", "Loose stools with diarrhea."],
    ["Reports giddyness.", "Reports giddiness."],
    ["Sore throat, pnuemonai suspected.", "Sore throat, pneumonia suspected."],
    ["Pain due to gastritus.", "Pain due to gastritis."],
    ["Pnemonia suspected clinically.", "Pneumonia suspected clinically."],
  ])("narrative field: %s", (source, target) => {
    expect(safe(source, target, narrative, "SPELLING"), `${source} -> ${target}`).toBe(true);
  });

  it.each([
    ["pnemonia", "pneumonia"],
    ["viral fevr", "viral fever"],
    ["Diabates mellitus", "Diabetes mellitus"],
    ["acute gastritus", "acute gastritis"],
  ])("high-risk field accepts single-edit correction %s", (source, target) => {
    expect(safe(source, target, diagnosis, "SPELLING")).toBe(true);
  });

  it("high-risk fields accept only single-edit corrections", () => {
    expect(safe("Patient has pnuemonai.", "Patient has pneumonia.", narrative, "SPELLING")).toBe(true);
    expect(safe("pnuemonai", "pneumonia", diagnosis, "SPELLING")).toBe(false);
  });
});

describe("Dictionary spelling correction: meaning changes are rejected", () => {
  it.each([
    // A correctly spelled word is never replaced, however close the target.
    ["ileus", "ileum"],
    ["ileum", "ilium"],
    ["afebrile", "febrile"],
    ["hyperkalemia", "hypokalemia"],
    ["hyponatremia", "hypernatremia"],
    ["unwell", "well"],
    ["sever nerve", "severe nerve"],
    // First letter differs: a dropped or swapped prefix can reverse meaning.
    ["afebrle", "febrile"],
    ["nausa", "causa"],
    // An opposed prefix must already be spelled in the original.
    ["hyprkalemia", "hyperkalemia"],
    ["hyprkalemia", "hypokalemia"],
    ["adbuction", "abduction"],
    // Confusable inflammatory/degenerative and procedural suffixes.
    ["gastrosis", "gastritis"],
    // Drug names are never spelled by the assistant.
    ["paracetmol", "paracetamol"],
    ["metformn", "metformin"],
    ["amoxycilin", "amoxicillin"],
    ["atorvastatn", "atorvastatin"],
    // Quantity, frequency and protected clinical anchors.
    ["dialy", "daily"],
    ["twoo", "two"],
    ["twicee", "twice"],
    ["nto", "not"],
    ["lefft", "left"],
    ["possble", "possible"],
    // Not a real word, too distant, or too large a length change.
    ["Insulin", "Inzulin"],
    ["Clonidine", "Clonazidine"],
    ["feevvrr", "fever"],
    ["painn", "pa"],
  ])("rejects %s -> %s in every field", (source, target) => {
    for (const policy of Object.values(FIELD_POLICIES))
      expect(safe(source, target, policy, "SPELLING"), `${source} -> ${target}`).toBe(false);
  });

  it.each([
    ["Patient has fevr.", "Patient has Fever."],
    ["FEVR noted", "FEVER noted"],
    ["HTn noted", "HTN noted"],
  ])("preserves the original casing pattern %s -> %s", (source, target) => {
    expect(safe(source, target, narrative, "SPELLING")).toBe(false);
  });

  it("allows sentence-initial capitalization of a corrected word", () => {
    expect(safe("fevr since morning.", "Fever since morning.", narrative, "SPELLING")).toBe(true);
  });

  it("freezes all word corrections in medication context", () => {
    expect(safe("Take tablet for vomitting", "Take tablet for vomiting", narrative, "SPELLING")).toBe(false);
  });

  it("still bounds the number of corrections", () => {
    expect(
      assessClinicalWriting(
        "fevr headach vomitting abdomnal diarhea giddyness breathlesness hypertnesion pnemonia",
        "fever headache vomiting abdominal diarrhea giddiness breathlessness hypertension pneumonia",
        narrative,
        "SPELLING",
      ).reason,
    ).toBe("EDIT_TOO_LARGE");
  });
});
