import { describe, expect, it } from "vitest";
import {
  describeDays,
  draftDurationDays,
  intervalsInText,
  normalizeDrugName,
  normalizeDuration,
  normalizeFrequency,
  normalizeStrength,
} from "@/lib/clinical-reconciliation/normalize";

describe("AI-4 drug name keys", () => {
  it.each([
    ["Paracetamol", "paracetamol"],
    ["Tab. Paracetamol 650 mg", "paracetamol"],
    ["Dolo 650", "dolo"],
    ["Syrup Ambroxol", "ambroxol"],
    ["Amoxicillin + Clavulanic acid", "amoxicillin clavulanic acid"],
    ["amoxicillin-clavulanic acid 625mg", "amoxicillin clavulanic acid"],
  ])("%s -> %s", (raw, key) => expect(normalizeDrugName(raw)).toBe(key));

  it.each(["पैरासिटामोल", "650 mg", "Tab", "", "  "])("%j is not comparable", (raw) =>
    expect(normalizeDrugName(raw)).toBeNull(),
  );

  it("never makes look-alike names equal", () => {
    expect(normalizeDrugName("hydroxyzine")).not.toBe(normalizeDrugName("hydralazine"));
    expect(normalizeDrugName("Metformin")).not.toBe(normalizeDrugName("Metformn"));
  });
});

describe("AI-4 strength", () => {
  it.each([
    ["650 mg", { value: 650, unit: "mg" }],
    ["650mg", { value: 650, unit: "mg" }],
    ["0.5 g", { value: 500, unit: "mg" }],
    ["1 gm", { value: 1000, unit: "mg" }],
    ["250 mcg", { value: 0.25, unit: "mg" }],
    ["5 ml", { value: 5, unit: "ml" }],
    ["40 IU", { value: 40, unit: "iu" }],
    ["1%", { value: 1, unit: "%" }],
  ])("%s", (raw, expected) => expect(normalizeStrength(raw)).toEqual(expected));

  it.each(["650", "paanch sau mg", "half tablet", "500 mg twice"])("%j is not comparable", (raw) =>
    expect(normalizeStrength(raw)).toBeNull(),
  );
});

describe("AI-4 frequency", () => {
  it.each([
    ["OD", "1/d"], ["once daily", "1/d"], ["Once a day", "1/d"], ["HS", "1/d"], ["at bedtime", "1/d"],
    ["1-0-0", "1/d"], ["0-0-1", "1/d"], ["raat ko", "1/d"], ["ek baar", "1/d"],
    ["BD", "2/d"], ["BID", "2/d"], ["Twice daily", "2/d"], ["1-0-1", "2/d"], ["1 - 0 - 1", "2/d"],
    ["do baar", "2/d"], ["din mein do baar", "2/d"], ["roz do baar", "2/d"], ["2 times a day", "2/d"],
    ["every 12 hours", "2/d"], ["subah shaam", "2/d"],
    ["TDS", "3/d"], ["TID", "3/d"], ["Three times daily", "3/d"], ["1-1-1", "3/d"], ["teen baar", "3/d"],
    ["three times a day", "3/d"], ["every 8 hours", "3/d"],
    ["QID", "4/d"], ["Four times daily", "4/d"], ["1-1-1-1", "4/d"], ["char baar", "4/d"], ["every 6 hours", "4/d"],
    ["every 4 hours", "6/d"],
    ["Weekly", "1/w"], ["once a week", "1/w"], ["hafte mein ek baar", "1/w"],
    ["SOS", "PRN"], ["PRN", "PRN"], ["As needed", "PRN"],
  ])("%s -> %s", (raw, expected) => expect(normalizeFrequency(raw)).toBe(expected));

  it.each(["0-0-0", "once", "after food", "5 times a day", "kabhi kabhi", "दिन में दो बार"])(
    "%j is not comparable",
    (raw) => expect(normalizeFrequency(raw)).toBeNull(),
  );
});

describe("AI-4 duration and follow-up", () => {
  it.each([
    ["5 days", 5], ["for 5 days", 5], ["5 din", 5], ["5 din tak", 5], ["teen din", 3],
    ["1 week", 7], ["ek hafta", 7], ["2 hafte", 14], ["a week", 7], ["one month", 30],
    ["1 mahina", 30], ["after 7 days", 7], ["7 din baad", 7], ["2 weeks later", 14],
  ])("%s -> %d days", (raw, days) => expect(normalizeDuration(raw)).toBe(days));

  it.each(["next week", "kuch din", "till better", "5", "5 days then stop"])("%j is not comparable", (raw) =>
    expect(normalizeDuration(raw)).toBeNull(),
  );

  it("reads draft duration fields", () => {
    expect(draftDurationDays(5, "days")).toBe(5);
    expect(draftDurationDays(2, "weeks")).toBe(14);
    expect(draftDurationDays(1, "months")).toBe(30);
    expect(draftDurationDays(null, "days")).toBeNull();
    expect(draftDurationDays(3, "")).toBeNull();
  });

  it("finds every interval in follow-up text", () => {
    expect(intervalsInText("Review after 7 days, or earlier. Repeat CBC in 2 weeks.")).toEqual([7, 14]);
    expect(intervalsInText("Review when needed")).toEqual([]);
  });

  it("describes days", () => {
    expect([1, 5, 7, 14, 30, 60].map(describeDays)).toEqual(["1 day", "5 days", "1 week", "2 weeks", "1 month", "2 months"]);
  });
});
