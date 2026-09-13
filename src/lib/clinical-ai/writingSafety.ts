import type { FieldPolicy } from "./writingSchemas";
// Small reviewed equivalences only. No edit-distance matching of medical words:
// similar spelling is NOT evidence of equivalent diagnoses or medicines.
const equivalents: Record<string, string> = {
  sever: "severe",
  suffring: "suffering",
  paitent: "patient",
  patinet: "patient",
  headach: "headache",
  fevr: "fever",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};
// Preserve temporal meaning; past findings must not become current findings.
const grammar = new Set(["the"]);
const agreement: Record<string, string> = {
  are: "is",
  were: "was",
  have: "has",
};
function tokens(text: string) {
  return (
    text
      .toLowerCase()
      .match(/(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}]+|[%°/+:<>=≥≤?-]/gu) ?? []
  ).map((t) => equivalents[t] ?? agreement[t] ?? t);
}
export function validateClinicalMeaningPreserved(
  original: string,
  suggested: string,
  _policy: FieldPolicy,
): boolean {
  if (!suggested.trim()) return false;
  const source = tokens(original);
  const target = tokens(suggested);
  // Ordered clinical anchors preserve number/unit binding, negation, uncertainty,
  // medication/diagnosis words, dates, frequency and clinically meaningful details.
  // Prepositions can encode cause or timing; never equate from/for.
  // Decimal spellings remain exact: .5 -> 0.5 is conservatively rejected.
  const normalize = (list: string[]) => list.filter((t) => !grammar.has(t));
  return (
    JSON.stringify(normalize(source)) === JSON.stringify(normalize(target))
  );
}
