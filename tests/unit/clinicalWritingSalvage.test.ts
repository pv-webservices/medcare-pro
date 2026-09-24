import { describe, expect, it } from "vitest";
import { FIELD_POLICIES } from "@/lib/clinical-ai/writingSchemas";
import {
  assessClinicalWriting,
  salvageClinicalWriting,
} from "@/lib/clinical-ai/writingSafety";

const narrative = FIELD_POLICIES.historyOfPresentIllness;
const restricted = FIELD_POLICIES.pastMedicalHistory;
const note = "Patient has hisotory of high blood pressure disasess since 5 yers back";

describe("duration-unit spelling corrections", () => {
  it("accepts the doctor's note when every edit is a plain spelling fix", () => {
    const fixed = "Patient has history of high blood pressure diseases since 5 years back";
    expect(assessClinicalWriting(note, fixed, narrative, "SPELLING").safe).toBe(true);
  });

  it.each([
    ["Follow up after 2 weks", "Follow up after 2 weeks"],
    ["Pain for 3 dayss", "Pain for 3 days"],
  ])("corrects an unambiguous duration unit: %s", (source, target) => {
    expect(assessClinicalWriting(source, target, restricted, "SPELLING").safe).toBe(true);
  });

  it.each([
    // monts is one edit from both month and months.
    ["Cough for 2 monts", "Cough for 2 months"],
    // Counts and frequencies stay protected.
    ["Take it dialy", "Take it daily"],
    ["Review twoo times", "Review two times"],
    // A real word is never respelled, even to a duration unit.
    ["Pain for 3 dates", "Pain for 3 days"],
  ])("rejects %s", (source, target) => {
    expect(assessClinicalWriting(source, target, narrative, "SPELLING").safe).toBe(false);
  });
});

describe("salvaging verified word corrections from an unsafe candidate", () => {
  it("keeps the verified fixes and drops rewrites, insertions and changed words", () => {
    const candidate = "Patient has a history of high blood pressure disease for 5 years.";
    expect(assessClinicalWriting(note, candidate, narrative, "GRAMMAR").safe).toBe(false);
    const salvaged = salvageClinicalWriting(note, candidate, narrative, "GRAMMAR");
    expect(salvaged?.text).toBe(
      "Patient has history of high blood pressure disasess since 5 years back",
    );
    expect(salvaged?.edits).toEqual([
      { originalFragment: "hisotory", suggestedFragment: "history" },
      { originalFragment: "yers", suggestedFragment: "years" },
    ]);
    // The result is always something the full validator accepts.
    expect(assessClinicalWriting(note, salvaged!.text, narrative, "GRAMMAR").safe).toBe(true);
  });

  it.each([
    ["Left knee pain.", "Right knee pain."],
    ["No chest pain.", "Chest pain."],
    ["Metformin 500 mg twice daily", "Metformin 850 mg twice daily"],
    ["Patient has headache.", "Patient has migraine."],
    ["testingingg", "testing"],
  ])("salvages nothing from %s -> %s", (source, target) => {
    expect(salvageClinicalWriting(source, target, narrative, "GRAMMAR")).toBeNull();
  });

  it("never exceeds the field's edit cap", () => {
    const source = "fevr coughh headach vomitting";
    const target = "fever cough headache vomiting";
    const salvaged = salvageClinicalWriting(source, target, restricted, "SPELLING");
    expect(salvaged?.edits.length).toBe(2);
    expect(assessClinicalWriting(source, salvaged!.text, restricted, "SPELLING").safe).toBe(true);
  });
});
