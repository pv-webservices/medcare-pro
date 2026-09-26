import { describe, expect, it } from "vitest";
import { medicationSchema, type MedicationInput } from "@/lib/prescriptionValidation";
import {
  PRE_ISSUE_RULES_VERSION,
  checkCounts,
  expectedQuantity,
  preIssueChecks,
  reviewRequired,
  unitsPerDose,
  type PreIssueInput,
} from "@/lib/prescription-checks/rules";
import { prescriptionChecksEnabled } from "@/lib/prescription-checks/config";

// A row that passes every v1 check: Paracetamol 650 mg, 1 tablet twice daily for 5 days, 10 tablets.
const med = (overrides: Partial<MedicationInput> = {}): MedicationInput => ({
  ...medicationSchema.parse({}),
  medicineGenericName: "Paracetamol",
  dosageForm: "Tablet",
  strength: "650 mg",
  dose: "1 tablet",
  route: "Oral",
  frequency: "Twice daily",
  durationValue: 5,
  durationUnit: "days",
  quantity: 10,
  ...overrides,
});
const input = (overrides: Partial<PreIssueInput> = {}): PreIssueInput => ({
  followUpInstructions: "Review after 5 days",
  medications: [med()],
  allergies: [],
  audio: { processing: 0, untranscribed: 0, unreviewed: 0 },
  ...overrides,
});
const codes = (value: PreIssueInput) => preIssueChecks(value).checks.map((c) => c.code);

describe("pre-issue checks: baseline", () => {
  it("a complete, consistent draft has no checks and pins the rules version", () => {
    const result = preIssueChecks(input());
    expect(result.checks).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.rulesVersion).toBe(PRE_ISSUE_RULES_VERSION);
    expect(PRE_ISSUE_RULES_VERSION).toBe("ai5-rules-v1");
  });
  it("kill switch defaults off", () => {
    expect(prescriptionChecksEnabled({})).toBe(false);
    expect(prescriptionChecksEnabled({ PRESCRIPTION_CHECKS_ENABLED: "1" })).toBe(false);
    expect(prescriptionChecksEnabled({ PRESCRIPTION_CHECKS_ENABLED: "true" })).toBe(true);
  });
});

describe("PC-01 duplicate medicine", () => {
  it("flags the same generic name, ignoring form words and strength", () => {
    const result = preIssueChecks(
      input({ medications: [med(), med({ medicineGenericName: "Tab. PARACETAMOL 500mg" })] }),
    );
    expect(result.checks).toEqual([
      expect.objectContaining({ code: "PC-01", tier: "REVIEW_REQUIRED", items: [0, 1], message: "Paracetamol appears in rows 1 and 2." }),
    ]);
  });
  it("flags the same brand across rows once", () => {
    const result = preIssueChecks(
      input({
        medications: [
          med({ medicineGenericName: "Paracetamol", brandName: "Dolo" }),
          med({ medicineGenericName: "Acetaminophen", brandName: "Dolo 650" }),
        ],
      }),
    );
    expect(result.checks.filter((c) => c.code === "PC-01")).toHaveLength(1);
  });
  it("never fuzzy-matches look-alike names", () => {
    expect(codes(input({ medications: [med({ medicineGenericName: "Hydroxyzine" }), med({ medicineGenericName: "Hydralazine" })] }))).not.toContain("PC-01");
  });
});

describe("PC-02 dosage form and route", () => {
  it("flags a tablet given intravenously", () => {
    const result = preIssueChecks(input({ medications: [med({ route: "Intravenous" })] }));
    expect(result.checks[0]).toMatchObject({ code: "PC-02", tier: "REVIEW_REQUIRED", message: "Row 1: Tablet with route Intravenous." });
  });
  it.each([
    ["Drops", "Ophthalmic"],
    ["Injection", "Subcutaneous"],
    ["Powder", "Topical"],
    ["Inhaler", "Inhalation"],
  ])("accepts %s by %s", (dosageForm, route) => {
    expect(codes(input({ medications: [med({ dosageForm, route, dose: "1 unit", quantity: null })] }))).not.toContain("PC-02");
  });
  it("skips Other and values outside the option lists", () => {
    expect(codes(input({ medications: [med({ dosageForm: "Other", route: "Intravenous" })] }))).not.toContain("PC-02");
    expect(codes(input({ medications: [med({ route: "Other" })] }))).not.toContain("PC-02");
    expect(codes(input({ medications: [med({ dosageForm: "Suppository", route: "Oral" })] }))).not.toContain("PC-02");
  });
});

describe("PC-03 strength", () => {
  it("flags missing strength and a bare number", () => {
    expect(preIssueChecks(input({ medications: [med({ strength: "" })] })).checks[0].message).toBe("Row 1: strength not recorded.");
    expect(preIssueChecks(input({ medications: [med({ strength: "500" })] })).checks[0].message).toBe("Row 1: strength '500' has no unit.");
  });
  it("accepts strengths with units, including combinations", () => {
    for (const strength of ["650 mg", "0.5mg", "250 mg/5 ml", "1%", "40 IU"])
      expect(codes(input({ medications: [med({ strength })] }))).not.toContain("PC-03");
  });
});

describe("PC-04 quantity", () => {
  it("computes units × doses/day × days only when all parts are unambiguous", () => {
    expect(unitsPerDose("1 tablet", "Tablet")).toBe(1);
    expect(unitsPerDose("½ tab", "Tablet")).toBe(0.5);
    expect(unitsPerDose("2 caps", "Capsule")).toBe(2);
    expect(unitsPerDose("1 capsule", "Tablet")).toBeNull();
    expect(unitsPerDose("500 mg", "Tablet")).toBeNull();
    expect(unitsPerDose("5 ml", "Syrup")).toBeNull();
    expect(expectedQuantity(med({ frequency: "Three times daily" }))).toBe(15);
    expect(expectedQuantity(med({ frequency: "Every 6 hours", durationValue: 1, durationUnit: "weeks" }))).toBe(28);
    expect(expectedQuantity(med({ dose: "½ tablet", frequency: "Once daily", durationValue: 3 }))).toBe(2);
    expect(expectedQuantity(med({ frequency: "As needed" }))).toBeNull();
    expect(expectedQuantity(med({ frequency: "Weekly" }))).toBeNull();
  });
  it("flags a quantity short of the course", () => {
    const result = preIssueChecks(input({ medications: [med({ frequency: "Three times daily" })] }));
    expect(result.checks[0]).toMatchObject({ code: "PC-04", tier: "CONSIDER", message: "Row 1: 1 tablet × 3 a day × 5 days = 15, quantity is 10." });
  });
  it("does not flag more than expected, a missing quantity or an uncountable dose", () => {
    expect(codes(input({ medications: [med({ quantity: 15 })] }))).not.toContain("PC-04");
    expect(codes(input({ medications: [med({ quantity: null, frequency: "Three times daily" })] }))).not.toContain("PC-04");
    expect(codes(input({ medications: [med({ dose: "650 mg", frequency: "Three times daily" })] }))).not.toContain("PC-04");
  });
});

describe("PC-05 and PC-06", () => {
  it("flags 'As needed' without instructions, not with them", () => {
    expect(codes(input({ medications: [med({ frequency: "As needed", quantity: null })] }))).toEqual(["PC-05"]);
    expect(codes(input({ medications: [med({ frequency: "As needed", quantity: null, instructions: "If fever above 100°F, max 3 a day" })] }))).toEqual([]);
  });
  it("flags missing follow-up instructions", () => {
    expect(codes(input({ followUpInstructions: "  " }))).toEqual(["PC-06"]);
  });
});

describe("PC-07 accepted allergy", () => {
  it("flags an exact name match with the time it was said", () => {
    const result = preIssueChecks(
      input({ allergies: [{ substance: "paracetamol", startMs: 83_000 }], medications: [med(), med({ medicineGenericName: "Cetirizine" })] }),
    );
    expect(result.checks).toEqual([
      expect.objectContaining({ code: "PC-07", tier: "REVIEW_REQUIRED", items: [0], message: "Accepted allergy 'paracetamol' (said at 1:23) matches row 1." }),
    ]);
  });
  it("matches brand names and never infers drug classes", () => {
    expect(codes(input({ allergies: [{ substance: "Dolo", startMs: null }], medications: [med({ brandName: "Dolo 650" })] }))).toEqual(["PC-07"]);
    expect(codes(input({ allergies: [{ substance: "penicillin", startMs: null }], medications: [med({ medicineGenericName: "Amoxicillin" })] }))).toEqual([]);
  });
  it("reports the check as skipped when facts cannot be read", () => {
    const result = preIssueChecks(input({ allergies: null }));
    expect(result.skipped).toEqual(["PC-07"]);
  });
});

describe("PC-08 consultation audio", () => {
  it("summarizes processing, untranscribed and unreviewed recordings", () => {
    const result = preIssueChecks(input({ audio: { processing: 1, untranscribed: 0, unreviewed: 2 } }));
    expect(result.checks).toEqual([
      expect.objectContaining({
        code: "PC-08",
        tier: "CONSIDER",
        items: [],
        message: "Consultation recordings: 1 still processing, 2 not reviewed. Facts can't be extracted after issue.",
      }),
    ]);
  });
  it("is skipped when clinical audio is off", () => {
    expect(preIssueChecks(input({ audio: null })).skipped).toEqual(["PC-08"]);
  });
});

describe("ordering, tiers and audit summary", () => {
  it("puts review-required checks first and counts codes without content", () => {
    const result = preIssueChecks(
      input({
        followUpInstructions: "",
        allergies: [{ substance: "Paracetamol", startMs: null }],
        audio: { processing: 1, untranscribed: 0, unreviewed: 0 },
        medications: [med({ strength: "" }), med({ route: "Topical" })],
      }),
    );
    expect(result.checks.map((c) => c.code)).toEqual(["PC-07", "PC-01", "PC-02", "PC-08", "PC-03", "PC-06"]);
    expect(reviewRequired(result)).toBe(true);
    const counts = checkCounts(result);
    expect(counts).toEqual({ "PC-07": 1, "PC-01": 1, "PC-02": 1, "PC-08": 1, "PC-03": 1, "PC-06": 1 });
    expect(JSON.stringify(counts)).not.toMatch(/paracetamol/i);
  });
  it("consider-only drafts need no acknowledgement", () => {
    expect(reviewRequired(preIssueChecks(input({ followUpInstructions: "" })))).toBe(false);
  });
});
