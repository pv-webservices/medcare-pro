import type { FieldPolicy, WritingMode } from "./writingSchemas";
import { editDistance, isDictionarySpellingCorrection } from "./clinicalLexicon";

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
// Quantity, frequency and duration words: a "spelling" fix must never produce
// or alter one (dialy -> daily, twoo -> two).
const quantityWords = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty",
  "fifty", "hundred", "thousand", "once", "twice", "thrice", "half", "double",
  "single", "first", "second", "third", "daily", "weekly", "monthly", "yearly",
  "hourly", "nightly", "morning", "evening", "night", "noon", "midnight",
  "bedtime", "alternate", "stat", "minute", "minutes", "hour", "hours", "day",
  "days", "week", "weeks", "month", "months", "year", "years",
]);
function isProtectedWord(word: string) {
  return (
    negationWords.has(word) ||
    laterality.has(word) ||
    uncertaintyWords.has(word) ||
    units.has(word) ||
    quantityWords.has(word)
  );
}
// Duration units sit next to a number the validator already pins. Counts and
// frequencies (two, twice, daily) stay protected: they are the dose schedule.
const durationUnits = new Set([
  "minute", "minutes", "hour", "hours", "day", "days", "week", "weeks",
  "month", "months", "year", "years",
]);
/** A misspelled token may become a duration unit only when that unit is the
 * single nearest quantity word (yers -> years; monts could be month or months: never). */
function unambiguousDurationCorrection(source: string, target: string, maxDistance: number) {
  if (!durationUnits.has(target) || isProtectedWord(source)) return false;
  let best = maxDistance + 1;
  let nearest: string[] = [];
  for (const candidate of quantityWords) {
    const distance = editDistance(source, candidate, best);
    if (distance < best) [best, nearest] = [distance, [candidate]];
    else if (distance === best) nearest.push(candidate);
  }
  return best <= maxDistance && nearest.length === 1 && nearest[0] === target;
}
function casing(token: string) {
  if (token === token.toLowerCase()) return "lower";
  if (token[0] === token[0].toUpperCase() && token.slice(1) === token.slice(1).toLowerCase())
    return "title";
  return "other";
}
/** A corrected word keeps its casing; abbreviations and mixed case are never
 * respelled. Only a sentence's first word may gain an initial capital. */
function casingPreserved(source: string, target: string, sentenceInitial: boolean) {
  const from = casing(source);
  const to = casing(target);
  if (from === "other" || to === "other") return false;
  return from === to || (sentenceInitial && from === "lower" && to === "title");
}

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
    const maxDistance = policy.semanticRisk === "MEDIUM" ? 2 : 1;
    if (
      (isProtectedWord(left) || isProtectedWord(right)) &&
      !unambiguousDurationCorrection(left, right, maxDistance)
    )
      return reject(changedReason(left, right));
    const sentenceInitial = i === 0 || [".", "\n"].includes(source[i - 1]);
    if (!casingPreserved(a, b, sentenceInitial))
      return reject("PROTECTED_ANCHOR_CHANGED");
    // "sever" is itself a word, so only this reviewed symptom context applies.
    const reviewed =
      left === "sever" &&
      right === "severe" &&
      /^(?:headache|headach|pain|fever|fevr)$/u.test(key(source[i + 1] ?? ""));
    const spelling = isDictionarySpellingCorrection({
      source: left,
      target: right,
      maxDistance,
    });
    const subject = key(source[i - 1] ?? "");
    const grammar =
      mode === "GRAMMAR" &&
      agreement[left] === right &&
      (subject === "patient" ||
        (policy.semanticRisk === "MEDIUM" && ["he", "she"].includes(subject)));
    if (!reviewed && !spelling && !grammar)
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

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
type WordSpan = { text: string; start: number; end: number };
function wordSpans(text: string): WordSpan[] {
  return Array.from(text.matchAll(WORD), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
/** Word pairs the provider substituted one-for-one, found by aligning the
 * word sequences (longest common subsequence). Insertions, deletions and
 * reorderings are never paired, so they can never be salvaged. */
function substitutedWords(source: WordSpan[], target: WordSpan[]) {
  const n = source.length;
  const m = target.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] =
        key(source[i].text) === key(target[j].text)
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const pairs: [WordSpan, WordSpan][] = [];
  let i = 0;
  let j = 0;
  let gapI = 0;
  let gapJ = 0;
  // Equal-length gaps pair by position (are -> is). Otherwise pair, in order,
  // only look-alike words, so an inserted article cannot shift the pairing.
  // Pairing is permissive on purpose: every pair must still pass validation.
  const closeGap = () => {
    if (i - gapI === j - gapJ) {
      for (let k = 0; k < i - gapI; k++) pairs.push([source[gapI + k], target[gapJ + k]]);
      return;
    }
    let next = gapJ;
    for (let k = gapI; k < i; k++) {
      const from = key(source[k].text);
      for (let t = next; t < j; t++) {
        const to = key(target[t].text);
        if (from[0] === to[0] && editDistance(from, to, 2) <= 2) {
          pairs.push([source[k], target[t]]);
          next = t + 1;
          break;
        }
      }
    }
  };
  while (i < n && j < m) {
    if (key(source[i].text) === key(target[j].text)) {
      closeGap();
      if (source[i].text !== target[j].text) pairs.push([source[i], target[j]]);
      i++;
      j++;
      gapI = i;
      gapJ = j;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  i = n;
  j = m;
  closeGap();
  return pairs;
}
function applyWords(original: string, edits: [WordSpan, WordSpan][]) {
  let text = original;
  for (const [from, to] of [...edits].sort((x, y) => y[0].start - x[0].start))
    text = text.slice(0, from.start) + to.text + text.slice(from.end);
  return text;
}

const isLetter = (char: string | undefined) => !!char && /[\p{L}\p{M}'’]/u.test(char);
/** Grow [start, end) outward so it never cuts a word in half. */
function wholeWords(text: string, start: number, end: number) {
  while (start > 0 && isLetter(text[start - 1]) && isLetter(text[start])) start--;
  while (end < text.length && isLetter(text[end - 1]) && isLetter(text[end])) end++;
  return [start, end] as const;
}

/**
 * The changes a doctor sees under "Changes" (presentation only; validation
 * always checks the whole text). Word-for-word substitutions are listed one
 * by one (fiverr -> fever); anything else falls back to the enclosing
 * changed span, widened to whole words.
 */
export function describeWritingEdits(original: string, suggested: string) {
  const pairs = substitutedWords(wordSpans(original), wordSpans(suggested)).filter(
    ([from, to]) => from.text !== to.text,
  );
  if (pairs.length && applyWords(original, pairs) === suggested)
    return pairs.map(([from, to]) => ({ originalFragment: from.text, suggestedFragment: to.text }));
  return computeWritingDiff(original, suggested).map((edit) => {
    const [sourceStart, sourceEnd] = wholeWords(original, edit.sourceStart, edit.sourceEnd);
    const [targetStart, targetEnd] = wholeWords(suggested, edit.targetStart, edit.targetEnd);
    return {
      originalFragment: original.slice(sourceStart, sourceEnd),
      suggestedFragment: suggested.slice(targetStart, targetEnd),
    };
  });
}

/**
 * When a candidate as a whole fails validation, keep only the individual word
 * corrections that each pass the same validator on their own, applied to the
 * doctor's original text. Everything else in the candidate is discarded, and
 * the combined result must pass validation again.
 */
export function salvageClinicalWriting(
  original: string,
  suggested: string,
  policy: FieldPolicy,
  mode: WritingMode = "GRAMMAR",
) {
  const source = wordSpans(original);
  const target = wordSpans(suggested);
  if (!source.length || !target.length || source.length * target.length > 1_000_000)
    return null;
  // Greedy, in reading order: an edit is kept only if the text with every
  // edit kept so far plus this one still validates (including the edit cap).
  const accepted: [WordSpan, WordSpan][] = [];
  for (const edit of substitutedWords(source, target).sort((x, y) => x[0].start - y[0].start))
    if (assessClinicalWriting(original, applyWords(original, [...accepted, edit]), policy, mode).safe)
      accepted.push(edit);
  if (!accepted.length) return null;
  const text = applyWords(original, accepted);
  return {
    text,
    edits: accepted.map(([from, to]) => ({
      originalFragment: from.text,
      suggestedFragment: to.text,
    })),
  };
}

export function validateClinicalMeaningPreserved(
  original: string,
  suggested: string,
  policy: FieldPolicy,
  mode: WritingMode = "GRAMMAR",
): boolean {
  return assessClinicalWriting(original, suggested, policy, mode).safe;
}
