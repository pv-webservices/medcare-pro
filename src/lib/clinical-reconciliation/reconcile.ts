import {
  describeDays,
  draftDurationDays,
  intervalsInText,
  normalizeDrugName,
  normalizeDuration,
  normalizeFrequency,
  normalizeStrength,
  RECONCILE_RULES_VERSION,
  sameStrength,
} from "./normalize";

/** An accepted AI-3 fact as returned by getAcceptedTranscriptFacts(). */
export type ReconcileFact = {
  id: string;
  category: string;
  assertion: string;
  subject: string;
  attributes: Record<string, string>;
  conflicting: boolean;
  evidence: { segmentId: string; quote: string }[];
};
export type DraftItem = {
  medicineGenericName: string;
  brandName: string;
  strength: string;
  frequency: string;
  durationValue: number | null;
  durationUnit: string;
};
export type ReconcileDraft = { items: DraftItem[]; followUpInstructions: string };

export type ReconcileCheck = "MEDICATION" | "STRENGTH" | "FREQUENCY" | "DURATION" | "ALLERGY" | "FOLLOW_UP";
export type ReconcileStatus = "DISCREPANCY" | "MATCH" | "NOT_COMPARABLE" | "CONFLICTING";
export type ReconcileResult = {
  check: ReconcileCheck;
  status: ReconcileStatus;
  factId: string;
  itemIndex: number | null;
  /** Verbatim fact value (what was said). */
  said: string;
  /** Draft value as typed, or null when the draft does not state it. */
  draft: string | null;
};

const USED: Record<string, string> = {
  MEDICATION_MENTION: "PRESENT",
  ALLERGY: "PRESENT",
  FOLLOW_UP: "PRESENT",
};
const eligible = (fact: ReconcileFact) =>
  fact.subject === "PATIENT" && USED[fact.category] === fact.assertion;

function itemNames(item: DraftItem) {
  return [normalizeDrugName(item.medicineGenericName), normalizeDrugName(item.brandName)].filter(
    (name): name is string => name !== null,
  );
}
const itemLabel = (item: DraftItem) => item.brandName.trim() || item.medicineGenericName.trim();

/** Compare one attribute: NOT_COMPARABLE when the spoken value is not
 * recognised or the draft value is present but unrecognised. A missing draft
 * value is a discrepancy: the doctor said it, the draft does not. */
function compare<T>(
  said: string | undefined,
  draftRaw: string,
  normalize: (raw: string) => T | null,
  same: (a: T, b: T) => boolean,
  draftValue: T | null = normalize(draftRaw),
): Pick<ReconcileResult, "status" | "draft"> | null {
  if (!said) return null;
  const spoken = normalize(said);
  if (spoken === null) return { status: "NOT_COMPARABLE", draft: draftRaw.trim() || null };
  if (!draftRaw.trim()) return { status: "DISCREPANCY", draft: null };
  if (draftValue === null) return { status: "NOT_COMPARABLE", draft: draftRaw.trim() };
  return { status: same(spoken, draftValue) ? "MATCH" : "DISCREPANCY", draft: draftRaw.trim() };
}

function medicationResults(fact: ReconcileFact, draft: ReconcileDraft): ReconcileResult[] {
  const said = fact.attributes.name ?? "";
  const base = { factId: fact.id, said };
  const name = normalizeDrugName(said);
  if (!name) return [{ ...base, check: "MEDICATION", status: "NOT_COMPARABLE", itemIndex: null, draft: null }];
  const index = draft.items.findIndex((item) => itemNames(item).includes(name));
  if (index < 0) return [{ ...base, check: "MEDICATION", status: "DISCREPANCY", itemIndex: null, draft: null }];
  const item = draft.items[index];
  const results: ReconcileResult[] = [
    { ...base, check: "MEDICATION", status: "MATCH", itemIndex: index, draft: itemLabel(item) },
  ];
  const attribute = (check: ReconcileCheck, outcome: ReturnType<typeof compare>, key: string) => {
    if (outcome) results.push({ check, factId: fact.id, itemIndex: index, said: fact.attributes[key], ...outcome });
  };
  attribute("STRENGTH", compare(fact.attributes.strength, item.strength, normalizeStrength, sameStrength), "strength");
  attribute("FREQUENCY", compare(fact.attributes.frequency, item.frequency, normalizeFrequency, (a, b) => a === b), "frequency");
  const durationText = item.durationValue ? `${item.durationValue} ${item.durationUnit}`.trim() : "";
  attribute(
    "DURATION",
    compare(fact.attributes.duration, durationText, normalizeDuration, (a, b) => a === b, draftDurationDays(item.durationValue, item.durationUnit)),
    "duration",
  );
  return results;
}

function allergyResults(fact: ReconcileFact, draft: ReconcileDraft): ReconcileResult[] {
  const said = fact.attributes.substance ?? "";
  const name = normalizeDrugName(said);
  if (!name) return [{ check: "ALLERGY", status: "NOT_COMPARABLE", factId: fact.id, itemIndex: null, said, draft: null }];
  // Only a name match is reported. No match is deliberately NOT reported as
  // "safe": drug-class cross-reactivity is not checked (PRD §6).
  return draft.items.flatMap((item, index) =>
    itemNames(item).includes(name)
      ? [{ check: "ALLERGY" as const, status: "DISCREPANCY" as const, factId: fact.id, itemIndex: index, said, draft: itemLabel(item) }]
      : [],
  );
}

function followUpResult(fact: ReconcileFact, draft: ReconcileDraft): ReconcileResult {
  const said = fact.attributes.interval ?? "";
  const days = normalizeDuration(said);
  const stated = intervalsInText(draft.followUpInstructions);
  const base = { check: "FOLLOW_UP" as const, factId: fact.id, itemIndex: null, said };
  if (days === null) return { ...base, status: "NOT_COMPARABLE", draft: null };
  return {
    ...base,
    status: stated.includes(days) ? "MATCH" : "DISCREPANCY",
    draft: stated.length ? [...new Set(stated)].map(describeDays).join(", ") : null,
  };
}

/**
 * AI-4 (PRD §6): compare a prescription draft with doctor-accepted facts.
 * Pure and deterministic; it never suggests or applies a change. The caller
 * must pass only ACCEPTED facts of current, non-stale reviews.
 */
export function reconcilePrescription(facts: ReconcileFact[], draft: ReconcileDraft) {
  const results: ReconcileResult[] = [];
  let allergyFacts = 0;
  for (const fact of facts.filter(eligible)) {
    if (fact.category === "ALLERGY") allergyFacts++;
    if (fact.conflicting) {
      const said = fact.attributes.name ?? fact.attributes.substance ?? fact.attributes.interval ?? "";
      const check: ReconcileCheck =
        fact.category === "ALLERGY" ? "ALLERGY" : fact.category === "FOLLOW_UP" ? "FOLLOW_UP" : "MEDICATION";
      results.push({ check, status: "CONFLICTING", factId: fact.id, itemIndex: null, said, draft: null });
      continue;
    }
    if (fact.category === "MEDICATION_MENTION") results.push(...medicationResults(fact, draft));
    else if (fact.category === "ALLERGY") results.push(...allergyResults(fact, draft));
    else results.push(followUpResult(fact, draft));
  }
  const order: Record<ReconcileStatus, number> = { DISCREPANCY: 0, CONFLICTING: 1, NOT_COMPARABLE: 2, MATCH: 3 };
  return {
    rulesVersion: RECONCILE_RULES_VERSION,
    allergyFacts,
    results: results
      .map((result, position) => ({ result, position }))
      .sort((a, b) => order[a.result.status] - order[b.result.status] || a.position - b.position)
      .map(({ result }) => result),
  };
}
