import { describe, expect, it } from "vitest";
import {
  reconcilePrescription,
  type DraftItem,
  type ReconcileFact,
} from "@/lib/clinical-reconciliation/reconcile";

let nextId = 0;
const fact = (category: string, attributes: Record<string, string>, extra: Partial<ReconcileFact> = {}): ReconcileFact => ({
  id: `fact-${++nextId}`,
  category,
  assertion: "PRESENT",
  subject: "PATIENT",
  attributes,
  conflicting: false,
  evidence: [{ segmentId: "segment-1", quote: "synthetic quote" }],
  ...extra,
});
const item = (extra: Partial<DraftItem> = {}): DraftItem => ({
  medicineGenericName: "Paracetamol",
  brandName: "Dolo 650",
  strength: "650 mg",
  frequency: "Twice daily",
  durationValue: 5,
  durationUnit: "days",
  ...extra,
});
const run = (facts: ReconcileFact[], items: DraftItem[] = [item()], followUpInstructions = "") =>
  reconcilePrescription(facts, { items, followUpInstructions }).results.map(({ check, status, said, draft }) => ({
    check,
    status,
    said,
    draft,
  }));

describe("AI-4 reconciliation (synthetic suite, PRD §10)", () => {
  it("reports every attribute that matches", () => {
    expect(
      run([fact("MEDICATION_MENTION", { name: "paracetamol", strength: "650mg", frequency: "BD", duration: "5 din" })]),
    ).toEqual([
      { check: "MEDICATION", status: "MATCH", said: "paracetamol", draft: "Dolo 650" },
      { check: "STRENGTH", status: "MATCH", said: "650mg", draft: "650 mg" },
      { check: "FREQUENCY", status: "MATCH", said: "BD", draft: "Twice daily" },
      { check: "DURATION", status: "MATCH", said: "5 din", draft: "5 days" },
    ]);
  });

  it("matches on the brand name as well as the generic name", () => {
    expect(run([fact("MEDICATION_MENTION", { name: "Dolo 650" })])[0]).toMatchObject({ status: "MATCH" });
  });

  it("flags a discussed medication that is not on the draft", () => {
    expect(run([fact("MEDICATION_MENTION", { name: "Metformin", strength: "500 mg" })])).toEqual([
      { check: "MEDICATION", status: "DISCREPANCY", said: "Metformin", draft: null },
    ]);
  });

  it("flags each differing attribute, listing differences first", () => {
    const results = run([
      fact("MEDICATION_MENTION", { name: "Paracetamol", strength: "500 mg", frequency: "din mein teen baar", duration: "1 hafta" }),
    ]);
    expect(results.slice(0, 3)).toEqual([
      { check: "STRENGTH", status: "DISCREPANCY", said: "500 mg", draft: "650 mg" },
      { check: "FREQUENCY", status: "DISCREPANCY", said: "din mein teen baar", draft: "Twice daily" },
      { check: "DURATION", status: "DISCREPANCY", said: "1 hafta", draft: "5 days" },
    ]);
  });

  it("flags a value the doctor said but the draft leaves empty", () => {
    const results = run([fact("MEDICATION_MENTION", { name: "Paracetamol", duration: "3 days" })], [item({ durationValue: null, durationUnit: "" })]);
    expect(results[0]).toEqual({ check: "DURATION", status: "DISCREPANCY", said: "3 days", draft: null });
  });

  it("never guesses: unrecognised values are not comparable", () => {
    const results = run(
      [fact("MEDICATION_MENTION", { name: "Paracetamol", frequency: "kabhi kabhi", strength: "650 mg" })],
      [item({ strength: "half" })],
    );
    expect(results).toContainEqual({ check: "FREQUENCY", status: "NOT_COMPARABLE", said: "kabhi kabhi", draft: "Twice daily" });
    expect(results).toContainEqual({ check: "STRENGTH", status: "NOT_COMPARABLE", said: "650 mg", draft: "half" });
    expect(results.some((r) => r.status === "DISCREPANCY")).toBe(false);
  });

  it("does not compare a Devanagari drug name", () => {
    expect(run([fact("MEDICATION_MENTION", { name: "पैरासिटामोल" })])).toEqual([
      { check: "MEDICATION", status: "NOT_COMPARABLE", said: "पैरासिटामोल", draft: null },
    ]);
  });

  it("never matches a look-alike drug name", () => {
    expect(run([fact("MEDICATION_MENTION", { name: "Hydroxyzine" })], [item({ medicineGenericName: "Hydralazine", brandName: "" })])[0])
      .toMatchObject({ check: "MEDICATION", status: "DISCREPANCY" });
  });

  it("flags an allergy whose name is on the draft, and says nothing otherwise", () => {
    expect(run([fact("ALLERGY", { substance: "Paracetamol", reaction: "rash" })])).toEqual([
      { check: "ALLERGY", status: "DISCREPANCY", said: "Paracetamol", draft: "Dolo 650" },
    ]);
    // Drug-class cross-reactivity is out of scope: absence is not "safe".
    const report = reconcilePrescription([fact("ALLERGY", { substance: "Penicillin" })], {
      items: [item({ medicineGenericName: "Amoxicillin", brandName: "" })],
      followUpInstructions: "",
    });
    expect(report.results).toEqual([]);
    expect(report.allergyFacts).toBe(1);
  });

  it("compares the follow-up interval with the instructions text", () => {
    const said = [fact("FOLLOW_UP", { interval: "7 din baad" })];
    expect(run(said, [], "Review after 1 week")).toEqual([{ check: "FOLLOW_UP", status: "MATCH", said: "7 din baad", draft: "1 week" }]);
    expect(run(said, [], "Review after 2 weeks")).toEqual([{ check: "FOLLOW_UP", status: "DISCREPANCY", said: "7 din baad", draft: "2 weeks" }]);
    expect(run(said, [], "")).toEqual([{ check: "FOLLOW_UP", status: "DISCREPANCY", said: "7 din baad", draft: null }]);
    expect(run([fact("FOLLOW_UP", { interval: "next week" })], [], "")[0].status).toBe("NOT_COMPARABLE");
  });

  it("shows a conflicting fact once and never compares it", () => {
    expect(run([fact("MEDICATION_MENTION", { name: "Metformin" }, { conflicting: true })])).toEqual([
      { check: "MEDICATION", status: "CONFLICTING", said: "Metformin", draft: null },
    ]);
  });

  it.each([
    ["negated", { assertion: "NEGATED" }],
    ["uncertain", { assertion: "UNCERTAIN" }],
    ["historical", { assertion: "HISTORICAL" }],
    ["conditional", { assertion: "CONDITIONAL" }],
    ["about a family member", { subject: "FAMILY_MEMBER" }],
    ["about someone else", { subject: "OTHER" }],
  ])("ignores a %s fact", (_label, extra) => {
    expect(run([fact("MEDICATION_MENTION", { name: "Metformin" }, extra as Partial<ReconcileFact>)])).toEqual([]);
  });

  it.each(["SYMPTOM", "MEASUREMENT", "DIAGNOSIS_MENTION", "INVESTIGATION", "ADVICE"])(
    "does not compare %s facts in v1",
    (category) => expect(run([fact(category, { name: "x", text: "x", value: "1" })])).toEqual([]),
  );

  it("is deterministic and pins its rules version", () => {
    const facts = [fact("MEDICATION_MENTION", { name: "Paracetamol", frequency: "TDS" }), fact("FOLLOW_UP", { interval: "5 days" })];
    const draft = { items: [item()], followUpInstructions: "" };
    const first = reconcilePrescription(facts, draft);
    expect(reconcilePrescription(facts, draft)).toEqual(first);
    expect(first.rulesVersion).toBe("ai4-rules-v1");
  });
});
