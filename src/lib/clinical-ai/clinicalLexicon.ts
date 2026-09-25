import englishWords from "an-array-of-english-words";
import { COMMON_CLINICAL_TERMS } from "./commonClinicalTerms";

/**
 * Deterministic vocabulary for AI-1 spelling validation. Server-only: the
 * dictionary is ~3 MB and must never be imported by a client component.
 *
 * The dictionary is a real-word oracle, not a suggestion engine: it decides
 * whether the ORIGINAL token is already a word (then it is never changed) and
 * whether the candidate is one. The provider chooses the correction; the
 * doctor still reviews every suggestion.
 */

// Correctly spelled clinical terms missing from the English list. Without them
// a doctor's correct term counts as a typo and could be "corrected" to a
// nearby real word (hyperkalemia -> hypokalemia).
const CLINICAL_SUPPLEMENT = [
  "hyperkalemia",
  "hyperkalaemia",
  "hypokalaemia",
  "hyperkalemic",
  "hypernatremia",
  "hypernatraemia",
  "hyponatremia",
  "hyponatraemia",
  "hypernatremic",
  "hyponatremic",
  "hypercalcaemia",
  "hypocalcaemia",
  "hyperglycaemia",
  "hypoglycaemia",
  "hypermagnesemia",
  "hypomagnesemia",
  "hyperphosphatemia",
  "hypophosphatemia",
  "hyperuricemia",
  "dyslipidemia",
  "dyslipidaemia",
  "hyperlipidaemia",
  "melaena",
];

const known = new Set<string>([
  ...englishWords,
  ...CLINICAL_SUPPLEMENT,
  ...COMMON_CLINICAL_TERMS,
]);

export function isKnownClinicalWord(word: string): boolean {
  return known.has(word.toLowerCase());
}

/** Optimal string alignment distance (adjacent transposition = 1 edit).
 * Returns bound + 1 as soon as the distance must exceed `bound`. */
export function editDistance(a: string, b: string, bound = Infinity): number {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, previous2[j - 2] + 1);
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > bound) return bound + 1;
    previous2 = previous;
    previous = current;
  }
  return previous[b.length];
}

// Prefixes whose members reverse or relocate meaning. When the candidate starts
// with one, the original must already spell that same prefix.
const OPPOSED_PREFIXES = [
  ["hyper", "hypo"],
  ["micro", "macro"],
  ["inter", "intra", "extra"],
  ["ante", "anti"],
  ["pre", "post"],
  ["supra", "infra", "sub"],
  ["endo", "exo", "ecto"],
  ["tachy", "brady"],
  ["mono", "poly"],
  ["ab", "ad"],
];
// Confusable suffixes: the original may not end in a different member.
const OPPOSED_SUFFIXES = [
  ["itis", "osis"],
  ["ectomy", "otomy", "ostomy"],
];

function prefixConflict(source: string, target: string) {
  return OPPOSED_PREFIXES.some((group) => {
    const prefix = group
      .filter((member) => target.startsWith(member))
      .sort((x, y) => y.length - x.length)[0];
    return prefix !== undefined && !source.startsWith(prefix);
  });
}

function suffixConflict(source: string, target: string) {
  return OPPOSED_SUFFIXES.some((group) => {
    const suffix = group.find((member) => target.endsWith(member));
    return (
      suffix !== undefined &&
      group.some((member) => member !== suffix && source.endsWith(member))
    );
  });
}

// Medication names are never spelled by the assistant, even outside the
// medication-context heuristic: look-alike drug names are a known hazard.
const DRUG_MORPHOLOGY =
  /(?:mycin|micin|cillin|cycline|oxacin|azole|pril|sartan|olol|statin|dipine|prazole|tidine|gliptin|gliflozin|formin|glitazone|mab|nib|vir|amol|profen|fenac|sone|olone|azepam|azolam|parin|semide|amide|thiazide|oxetine|triptyline|setron|peridone|tadine|zosin|(?:bu|me|mo)terol|lukast|penem|pramine|zepine|pirone|tropium|clopramide|ridone|thazine)$|^(?:cef|ceph)/u;
// Common drugs whose names carry no class suffix.
const DRUG_NAMES = new Set([
  "aspirin",
  "insulin",
  "warfarin",
  "digoxin",
  "morphine",
  "codeine",
  "tramadol",
  "cetirizine",
  "levocetirizine",
  "glimepiride",
  "glibenclamide",
  "gliclazide",
  "thyroxine",
  "levothyroxine",
  "allopurinol",
  "colchicine",
  "methotrexate",
  "chlorpheniramine",
  "dicyclomine",
  "hyoscine",
  "ivermectin",
  "adrenaline",
  "epinephrine",
  "atropine",
  "lithium",
  "ranitidine",
  "ondansetron",
]);

function isDrugLike(word: string) {
  return DRUG_NAMES.has(word) || DRUG_MORPHOLOGY.test(word);
}

export type LexicalCorrection = {
  /** Lowercase original token. */
  source: string;
  /** Lowercase candidate token. */
  target: string;
  /** Maximum edit distance permitted by the field policy. */
  maxDistance: number;
};

/**
 * True only when a misspelled (non-word) original becomes a single real word
 * that is a small, same-initial, non-prefix-flipping, non-drug edit away.
 * Protected anchors (negation, laterality, quantities...) are checked by the
 * caller, which owns those vocabularies.
 */
export function isDictionarySpellingCorrection({
  source,
  target,
  maxDistance,
}: LexicalCorrection): boolean {
  if (source.length < 4 || target.length < 3) return false;
  if (isKnownClinicalWord(source) || !isKnownClinicalWord(target)) return false;
  if (source[0] !== target[0]) return false;
  if (Math.abs(source.length - target.length) > 1) return false;
  if (isDrugLike(source) || isDrugLike(target)) return false;
  if (prefixConflict(source, target) || suffixConflict(source, target))
    return false;
  const distance = editDistance(source, target, maxDistance + 1);
  if (distance <= maxDistance) return true;
  // Narrative fields only (high-risk fields keep their single edit): one extra
  // edit for long words (diareaha -> diarrhea), only onto a common clinical
  // term that no other such term matches as closely.
  return (
    maxDistance >= 2 &&
    distance === maxDistance + 1 &&
    source.length >= LONG_WORD &&
    COMMON_CLINICAL_TERMS.has(target) &&
    [...COMMON_CLINICAL_TERMS].every(
      (term) => term === target || editDistance(source, term, distance) > distance,
    )
  );
}

/** Words of this length or more may take one extra edit (see above). */
const LONG_WORD = 7;
