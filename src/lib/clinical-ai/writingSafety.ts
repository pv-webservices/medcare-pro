import type { FieldPolicy, WritingMode } from "./writingSchemas";

// Explicit equivalences, never fuzzy spelling, synonyms or provider confidence.
const reviewedSpelling: Record<string, string> = {
  suffring: "suffering",
  paitent: "patient",
  patinet: "patient",
  headach: "headache",
  fevr: "fever",
};
const narrativeSpelling: Record<string, string> = { diabates: "diabetes" };
const agreement: Record<string, string> = {
  are: "is",
  were: "was",
  have: "has",
};
const medication =
  /\b(?:take|taking|tablet|tablets|capsule|capsules|insulin|metformin|penicillin|oral|intravenous|intramuscular|subcutaneous|topical|inhaled|mg|mcg|kg|ml|od|bd|tid|qid|prn)\b|\d\s*(?:mg|mcg|g|ml|l)\b/iu;
const units = new Set([
  "mg",
  "mcg",
  "g",
  "kg",
  "ml",
  "l",
  "cm",
  "mm",
  "mmhg",
  "iu",
  "f",
  "c",
]);
const negationWords = new Set([
  "no",
  "not",
  "never",
  "neither",
  "nor",
  "denies",
  "denied",
  "without",
]);
const uncertaintyWords = new Set([
  "possible",
  "possibly",
  "probable",
  "probably",
  "suspected",
  "likely",
  "unlikely",
  "uncertain",
  "confirmed",
  "rule",
  "out",
  "reports",
]);
const laterality = new Set(["left", "right", "bilateral", "unilateral"]);

export type SafetyReason =
  | "NO_CHANGE"
  | "SAFE_SURFACE_EDIT"
  | "NUMBER_CHANGED"
  | "UNIT_CHANGED"
  | "NEGATION_CHANGED"
  | "LATERALITY_CHANGED"
  | "UNCERTAINTY_CHANGED"
  | "PROTECTED_ANCHOR_CHANGED"
  | "CLINICAL_FACT_ADDED"
  | "CLINICAL_FACT_REMOVED"
  | "EDIT_TOO_LARGE"
  | "FIELD_POLICY_REJECTED";

/** Locally computed enclosing changed span, with UTF-16 offsets into the
 * original strings. Grapheme boundaries avoid splitting Unicode characters.
 * Presentation data only: validation checks the entire candidate. */
export function computeWritingDiff(original: string, suggested: string) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const source = Array.from(segmenter.segment(original));
  const target = Array.from(segmenter.segment(suggested));
  let start = 0;
  while (
    start < source.length &&
    start < target.length &&
    source[start].segment === target[start].segment
  )
    start++;
  if (start === source.length && start === target.length) return [];
  let left = source.length;
  let right = target.length;
  while (
    left > start &&
    right > start &&
    source[left - 1].segment === target[right - 1].segment
  ) {
    left--;
    right--;
  }
  // Include shared context for pure insertion/deletion (UI fragments nonempty).
  if (left === start || right === start) {
    if (start > 0) start--;
    else if (left < source.length && right < target.length) {
      left++;
      right++;
    }
  }
  const sourceStart = source[start]?.index ?? original.length;
  const targetStart = target[start]?.index ?? suggested.length;
  const sourceEnd = source[left]?.index ?? original.length;
  const targetEnd = target[right]?.index ?? suggested.length;
  return [
    {
      sourceStart,
      sourceEnd,
      targetStart,
      targetEnd,
      originalFragment: original.slice(sourceStart, sourceEnd),
      suggestedFragment: suggested.slice(targetStart, targetEnd),
    },
  ];
}

// Keep every non-whitespace character, including unknown clinical symbols.
// Numbers retain grouping/decimal punctuation; contractions remain whole words.
function tokens(text: string, allowCommas: boolean): string[] {
  const normalized = text.normalize("NFC").trim().replace(/[.!]$/u, "");
  return (
    normalized.match(
      /\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\r?\n|[^\s]/gu,
    ) ?? []
  ).filter((token) => !(allowCommas && token === ","));
}
function key(token: string) {
  return token.toLowerCase();
}
function word(token: string) {
  return /^[\p{L}\p{M}]+$/u.test(token);
}
function changedReason(source: string, target: string): SafetyReason {
  if (/\p{N}/u.test(source + target)) return "NUMBER_CHANGED";
  if (units.has(source) || units.has(target)) return "UNIT_CHANGED";
  if (
    negationWords.has(source) ||
    negationWords.has(target) ||
    /n['’]t/u.test(source + target)
  )
    return "NEGATION_CHANGED";
  if (laterality.has(source) || laterality.has(target))
    return "LATERALITY_CHANGED";
  if (
    uncertaintyWords.has(source) ||
    uncertaintyWords.has(target) ||
    source === "?" ||
    target === "?"
  )
    return "UNCERTAINTY_CHANGED";
  return "PROTECTED_ANCHOR_CHANGED";
}

export function assessClinicalWriting(
  original: string,
  suggested: string,
  policy: FieldPolicy,
  mode: WritingMode = "GRAMMAR",
) {
  const reject = (reason: SafetyReason) => ({
    safe: false,
    reason,
    edits: [] as ReturnType<typeof computeWritingDiff>,
  });
  if (!suggested.trim() || !original.trim())
    return reject("FIELD_POLICY_REJECTED");
  if (original.length > policy.maxLength || suggested.length > policy.maxLength)
    return reject("EDIT_TOO_LARGE");
  const edits = computeWritingDiff(original, suggested);
  if (!edits.length) return { safe: true, reason: "NO_CHANGE" as const, edits };
  const combined = original + "\n" + suggested;
  const medicationContext = medication.test(combined);
  // Only a positive, explicit symptom list proves commas are surface edits.
  // An incomplete deny-list of negation/status words cannot establish scope.
  const positiveList =
    /^patient reports (?:fever|cough|headache)(?:\s*,?\s+(?:and\s+)?(?:fever|cough|headache))+[.!]?$/iu;
  const allowCommas =
    positiveList.test(original.trim()) && positiveList.test(suggested.trim());
  const source = tokens(original, allowCommas);
  const target = tokens(suggested, allowCommas);
  if (!source.length || !target.length) return reject("FIELD_POLICY_REJECTED");
  let i = 0,
    j = 0,
    changed = 0;
  while (i < source.length || j < target.length) {
    const a = source[i] ?? "",
      b = target[j] ?? "";
    const left = key(a),
      right = key(b);
    if (a && b && left === right) {
      // Case can distinguish abbreviations and units, including Unicode/mixed
      // case units absent from any dictionary (nM/nm, μM/μm). Only capitalize
      // a sentence's first letter; preserve all internal capitalization.
      if (
        a !== b &&
        (!["patient", "the", "he", "she"].includes(left) ||
          !word(a) ||
          a.length < 2 ||
          a.slice(1) !== b.slice(1) ||
          !(i === 0 || [".", "\n"].includes(source[i - 1])))
      )
        return reject("PROTECTED_ANCHOR_CHANGED");
      i++;
      j++;
      continue;
    }
    // Retain the existing narrow article policy; never discard all articles
    // before comparison, which would permit arbitrary movement/reordering.
    if (mode === "GRAMMAR" && !medicationContext) {
      if (left === "the" && key(source[i + 1] ?? "") === right) {
        i++;
        changed++;
        continue;
      }
      if (right === "the" && key(target[j + 1] ?? "") === left) {
        j++;
        changed++;
        continue;
      }
    }
    if (!a || !b)
      return reject(a ? "CLINICAL_FACT_REMOVED" : "CLINICAL_FACT_ADDED");
    if (!word(a) || !word(b)) return reject(changedReason(left, right));
    if (medicationContext) return reject("PROTECTED_ANCHOR_CHANGED");
    const reviewed =
      reviewedSpelling[left] === right ||
      (left === "sever" &&
        right === "severe" &&
        /^(?:headache|headach|pain|fever|fevr)$/u.test(
          key(source[i + 1] ?? ""),
        ));
    const narrative =
      policy.semanticRisk === "MEDIUM" && narrativeSpelling[left] === right;
    const subject = key(source[i - 1] ?? "");
    const grammar =
      mode === "GRAMMAR" &&
      agreement[left] === right &&
      (subject === "patient" ||
        (policy.semanticRisk === "MEDIUM" && ["he", "she"].includes(subject)));
    if (!reviewed && !narrative && !grammar)
      return reject(changedReason(left, right));
    changed++;
    i++;
    j++;
  }
  // Short corrections get a two-edit floor; long paragraphs cannot be rewritten.
  const words = source.filter(word).length;
  const limit =
    policy.semanticRisk === "MEDIUM"
      ? Math.min(8, Math.max(2, Math.ceil(words * 0.2)))
      : Math.min(4, Math.max(2, Math.ceil(words * 0.1)));
  if (changed > limit) return reject("EDIT_TOO_LARGE");
  return { safe: true, reason: "SAFE_SURFACE_EDIT" as const, edits };
}

export function validateClinicalMeaningPreserved(
  original: string,
  suggested: string,
  policy: FieldPolicy,
  mode: WritingMode = "GRAMMAR",
): boolean {
  return assessClinicalWriting(original, suggested, policy, mode).safe;
}
