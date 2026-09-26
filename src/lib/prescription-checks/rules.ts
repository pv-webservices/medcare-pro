import type { MedicationInput } from "@/lib/prescriptionValidation";
import {
  draftDurationDays,
  normalizeDrugName,
  normalizeFrequency,
} from "@/lib/clinical-reconciliation/normalize";

/**
 * AI-5 v1 pre-issue checks (docs/clinical-ai-preissue-checks-prd.md). Pure and
 * deterministic: facts about the saved draft only. Every result is a prompt to
 * look again; none blocks issuing, and an empty list is not a safety claim.
 *
 * The form/route table and the quantity rule are clinical content awaiting
 * named-clinician sign-off (PRD §12 Q5); the feature stays behind
 * PRESCRIPTION_CHECKS_ENABLED until then.
 */
export const PRE_ISSUE_RULES_VERSION = "ai5-rules-v1";

export type PreIssueCode =
  | "PC-01"
  | "PC-02"
  | "PC-03"
  | "PC-04"
  | "PC-05"
  | "PC-06"
  | "PC-07"
  | "PC-08";
/** Review required: the doctor acknowledges before issuing (PRD §12 Q2). */
export type PreIssueTier = "REVIEW_REQUIRED" | "CONSIDER";
export type PreIssueCheck = {
  code: PreIssueCode;
  tier: PreIssueTier;
  /** Zero-based medicine rows the check is about (empty for visit-level). */
  items: number[];
  message: string;
};
export type AllergyInput = { substance: string; startMs: number | null };
export type AudioInput = { processing: number; untranscribed: number; unreviewed: number };
export type PreIssueInput = {
  followUpInstructions: string;
  medications: MedicationInput[];
  /** Accepted AI-3 allergy facts, or null when they cannot be read here. */
  allergies: AllergyInput[] | null;
  /** Consultation audio state, or null when clinical audio is off. */
  audio: AudioInput | null;
};

const REVIEW_REQUIRED = new Set<PreIssueCode>(["PC-07", "PC-01", "PC-02"]);
const ORDER: PreIssueCode[] = ["PC-07", "PC-01", "PC-02", "PC-04", "PC-08", "PC-03", "PC-05", "PC-06"];

// PRD §5.2: only the fixed MEDICATION_OPTIONS values; "Other" is never checked.
const FORM_ROUTES: Record<string, string[]> = {
  Tablet: ["Oral", "Sublingual"],
  Capsule: ["Oral", "Sublingual"],
  Syrup: ["Oral"],
  Suspension: ["Oral"],
  Powder: ["Oral", "Topical"],
  Injection: ["Intramuscular", "Intravenous", "Subcutaneous"],
  Cream: ["Topical"],
  Ointment: ["Topical"],
  Gel: ["Topical"],
  Lotion: ["Topical"],
  Drops: ["Oral", "Ophthalmic", "Otic", "Nasal"],
  Inhaler: ["Inhalation", "Nasal"],
};
const KNOWN_ROUTES = new Set(Object.values(FORM_ROUTES).flat());

// PRD §5.3: a dose is countable only as "<n> <form word>" for these forms.
const UNIT_WORDS: Record<string, RegExp> = {
  Tablet: /^(?:tab|tabs|tablet|tablets)$/u,
  Capsule: /^(?:cap|caps|capsule|capsules)$/u,
};
const PER_DAY: Record<string, number> = { "1/d": 1, "2/d": 2, "3/d": 3, "4/d": 4, "6/d": 6 };

const label = (item: MedicationInput) => item.brandName.trim() || item.medicineGenericName.trim();
const row = (index: number) => `Row ${index + 1}`;
const rows = (indexes: number[]) =>
  indexes.length === 2
    ? `rows ${indexes[0] + 1} and ${indexes[1] + 1}`
    : `rows ${indexes.map((i) => i + 1).join(", ")}`;
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function names(item: MedicationInput) {
  return [...new Set([normalizeDrugName(item.medicineGenericName), normalizeDrugName(item.brandName)])].filter(
    (name): name is string => name !== null,
  );
}

/** Units per dose ("1 tablet", "½ tab", "0.5 capsule"), or null. */
export function unitsPerDose(dose: string, dosageForm: string): number | null {
  const unitWord = UNIT_WORDS[dosageForm];
  if (!unitWord) return null;
  const match = dose.trim().toLowerCase().match(/^(\d{1,2}(?:\.5)?|½|1\/2)\s*([a-z]+)\.?$/u);
  if (!match || !unitWord.test(match[2])) return null;
  const units = match[1] === "½" || match[1] === "1/2" ? 0.5 : Number(match[1]);
  return units > 0 ? units : null;
}

/** Expected course quantity, or null unless every part is unambiguous. */
export function expectedQuantity(item: MedicationInput): number | null {
  const units = unitsPerDose(item.dose, item.dosageForm);
  const frequency = normalizeFrequency(item.frequency);
  const perDay = frequency ? PER_DAY[frequency] : undefined;
  const days = draftDurationDays(item.durationValue, item.durationUnit);
  if (units === null || !perDay || !days) return null;
  return Math.ceil(units * perDay * days);
}

function duplicates(medications: MedicationInput[]): PreIssueCheck[] {
  const byName = new Map<string, number[]>();
  medications.forEach((item, index) => {
    for (const name of names(item)) byName.set(name, [...(byName.get(name) ?? []), index]);
  });
  const seen = new Set<string>();
  return [...byName.values()].flatMap((indexes) => {
    const key = indexes.join(",");
    if (indexes.length < 2 || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        code: "PC-01" as const,
        tier: "REVIEW_REQUIRED" as const,
        items: indexes,
        message: `${label(medications[indexes[0]])} appears in ${rows(indexes)}.`,
      },
    ];
  });
}

function perItem(item: MedicationInput, index: number): Omit<PreIssueCheck, "tier">[] {
  const found: Omit<PreIssueCheck, "tier">[] = [];
  const routes = FORM_ROUTES[item.dosageForm];
  if (routes && KNOWN_ROUTES.has(item.route) && !routes.includes(item.route))
    found.push({
      code: "PC-02",
      items: [index],
      message: `${row(index)}: ${item.dosageForm} with route ${item.route}.`,
    });
  const strength = item.strength.trim();
  if (!strength)
    found.push({ code: "PC-03", items: [index], message: `${row(index)}: strength not recorded.` });
  else if (/^\d+(?:\.\d+)?$/u.test(strength))
    found.push({ code: "PC-03", items: [index], message: `${row(index)}: strength '${strength}' has no unit.` });
  const expected = expectedQuantity(item);
  if (expected !== null && item.quantity !== null && item.quantity < expected)
    found.push({
      code: "PC-04",
      items: [index],
      message: `${row(index)}: ${item.dose.trim()} × ${normalizeFrequency(item.frequency)!.split("/")[0]} a day × ${draftDurationDays(item.durationValue, item.durationUnit)} days = ${expected}, quantity is ${item.quantity}.`,
    });
  if (normalizeFrequency(item.frequency) === "PRN" && !item.instructions.trim())
    found.push({
      code: "PC-05",
      items: [index],
      message: `${row(index)}: 'As needed' without instructions (when, and how often at most).`,
    });
  return found;
}

function allergies(input: AllergyInput[], medications: MedicationInput[]): Omit<PreIssueCheck, "tier">[] {
  return input.flatMap((allergy) => {
    const name = normalizeDrugName(allergy.substance);
    if (!name) return [];
    const matched = medications.flatMap((item, index) => (names(item).includes(name) ? [index] : []));
    const said = allergy.startMs === null ? "" : ` (said at ${clock(allergy.startMs)})`;
    return matched.length
      ? [
          {
            code: "PC-07" as const,
            items: matched,
            message: `Accepted allergy '${allergy.substance.trim()}'${said} matches ${matched.length === 1 ? row(matched[0]).toLowerCase() : rows(matched)}.`,
          },
        ]
      : [];
  });
}

function audio(input: AudioInput): Omit<PreIssueCheck, "tier">[] {
  const parts = [
    input.processing ? `${input.processing} still processing` : "",
    input.untranscribed ? `${input.untranscribed} not transcribed` : "",
    input.unreviewed ? `${input.unreviewed} not reviewed` : "",
  ].filter(Boolean);
  return parts.length
    ? [
        {
          code: "PC-08",
          items: [],
          message: `Consultation recordings: ${parts.join(", ")}. Facts can't be extracted after issue.`,
        },
      ]
    : [];
}

export function preIssueChecks(input: PreIssueInput) {
  const found: Omit<PreIssueCheck, "tier">[] = [
    ...duplicates(input.medications),
    ...input.medications.flatMap(perItem),
    ...(input.allergies ? allergies(input.allergies, input.medications) : []),
    ...(input.audio ? audio(input.audio) : []),
  ];
  if (!input.followUpInstructions.trim())
    found.push({ code: "PC-06", items: [], message: "No follow-up instructions." });
  const checks: PreIssueCheck[] = found
    .map((check) => ({ ...check, tier: REVIEW_REQUIRED.has(check.code) ? "REVIEW_REQUIRED" : "CONSIDER" }) as PreIssueCheck)
    .sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code) || (a.items[0] ?? -1) - (b.items[0] ?? -1));
  const skipped: PreIssueCode[] = [...(input.allergies ? [] : ["PC-07" as const]), ...(input.audio ? [] : ["PC-08" as const])];
  return { rulesVersion: PRE_ISSUE_RULES_VERSION, checks, skipped };
}
export type PreIssueResult = ReturnType<typeof preIssueChecks>;

/** PHI-free audit summary: check codes and counts only (PRD §12 Q3). */
export function checkCounts(result: PreIssueResult) {
  const counts: Partial<Record<PreIssueCode, number>> = {};
  for (const check of result.checks) counts[check.code] = (counts[check.code] ?? 0) + 1;
  return counts;
}
export const reviewRequired = (result: PreIssueResult) =>
  result.checks.some((check) => check.tier === "REVIEW_REQUIRED");
