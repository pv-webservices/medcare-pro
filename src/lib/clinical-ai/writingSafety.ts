import type { FieldPolicy, WritingMode } from "./writingSchemas";

// Explicitly reviewed corrections remain valid even in VERY_HIGH-risk fields.
// The general typo rule below is deliberately limited to MEDIUM-risk fields.
const reviewedSpelling: Record<string, string> = {
  sever: "severe",
  suffring: "suffering",
  paitent: "patient",
  patinet: "patient",
  headach: "headache",
  fevr: "fever",
};

// Real clinical terms that are a single edit apart are not spelling evidence.
// Keep known ambiguous pairs fail-closed in every field and direction.
const ambiguousClinicalPairs = new Set(["ileum:ilium", "ilium:ileum"]);

const protectedWords = new Set([
  // Negation and uncertainty.
  "no",
  "not",
  "never",
  "neither",
  "nor",
  "denies",
  "denied",
  "without",
  "possible",
  "possibly",
  "probable",
  "probably",
  "suspected",
  "unlikely",
  "uncertain",
  // Laterality, timing, frequency, route, and duration anchors.
  "left",
  "right",
  "bilateral",
  "current",
  "previous",
  "prior",
  "today",
  "tomorrow",
  "yesterday",
  "before",
  "after",
  "from",
  "for",
  "once",
  "twice",
  "daily",
  "weekly",
  "monthly",
  "hourly",
  "oral",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "topical",
  "inhaled",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  // Common units and abbreviated frequencies.
  "mg",
  "mcg",
  "g",
  "kg",
  "ml",
  "l",
  "od",
  "bd",
  "tid",
  "qid",
  "prn",
  // Number words are clinical anchors too; do not rewrite 7 as seven.
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
]);

const harmlessArticle = "the";
const agreement: Record<string, string> = {
  are: "is",
  were: "was",
  have: "has",
};

type Token =
  | { kind: "word"; value: string }
  | { kind: "anchor"; value: string };

function tokens(text: string): Token[] {
  return (
    text
      .toLowerCase()
      .match(/(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}]+|[%°/+<>=≥≤?-]/gu) ?? []
  ).map((value) => ({
    kind: /^\p{L}+$/u.test(value) ? "word" : "anchor",
    value,
  }));
}

// Damerau-Levenshtein distance capped at one. We only need to distinguish an
// exact token, one insertion/deletion/substitution, or one adjacent transpose.
function isSingleTypo(source: string, target: string): boolean {
  if (source === target || Math.abs(source.length - target.length) > 1)
    return false;
  if (source.length === target.length) {
    const different: number[] = [];
    for (let index = 0; index < source.length; index++)
      if (source[index] !== target[index]) different.push(index);
    if (different.length === 1) return true;
    return (
      different.length === 2 &&
      different[1] === different[0] + 1 &&
      source[different[0]] === target[different[1]] &&
      source[different[1]] === target[different[0]]
    );
  }
  const shorter = source.length < target.length ? source : target;
  const longer = source.length < target.length ? target : source;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++;
      longIndex++;
    } else if (skipped) return false;
    else {
      skipped = true;
      longIndex++;
    }
  }
  return true;
}

function lexicalChangeAllowed(
  source: string,
  target: string,
  policy: FieldPolicy,
): boolean {
  if (source === target) return true;
  if (protectedWords.has(source) || protectedWords.has(target)) return false;
  if (ambiguousClinicalPairs.has(`${source}:${target}`)) return false;
  if (reviewedSpelling[source] === target) return true;
  return policy.semanticRisk === "MEDIUM" && isSingleTypo(source, target);
}

function spellingPreserved(
  source: Token[],
  target: Token[],
  policy: FieldPolicy,
): boolean {
  if (source.length !== target.length) return false;
  return source.every((token, index) => {
    const candidate = target[index];
    if (token.kind !== candidate.kind) return false;
    if (token.kind === "anchor" || candidate.kind === "anchor")
      return token.value === candidate.value;
    return lexicalChangeAllowed(token.value, candidate.value, policy);
  });
}

function grammarPreserved(
  source: Token[],
  target: Token[],
  policy: FieldPolicy,
): boolean {
  // Article insertion/removal is the only token-count change allowed. Removing
  // it before ordered comparison cannot insert, delete, or reorder content.
  const withoutArticles = (list: Token[]) =>
    list.filter(
      (token) => token.kind !== "word" || token.value !== harmlessArticle,
    );
  const left = withoutArticles(source);
  const right = withoutArticles(target);
  if (left.length !== right.length) return false;
  return left.every((token, index) => {
    const candidate = right[index];
    if (token.kind !== candidate.kind) return false;
    if (token.kind === "anchor" || candidate.kind === "anchor")
      return token.value === candidate.value;
    if (lexicalChangeAllowed(token.value, candidate.value, policy)) return true;
    // Keep agreement changes directional and narrow: the reviewed contract is
    // for a singular "patient", not arbitrary clinical nouns or tense changes.
    return (
      index > 0 &&
      left[index - 1]?.kind === "word" &&
      left[index - 1]?.value === "patient" &&
      agreement[token.value] === candidate.value
    );
  });
}

export function validateClinicalMeaningPreserved(
  original: string,
  suggested: string,
  policy: FieldPolicy,
  mode: WritingMode = "GRAMMAR",
): boolean {
  if (!suggested.trim()) return false;
  const source = tokens(original);
  const target = tokens(suggested);
  if (!source.length || !target.length) return false;
  return mode === "SPELLING"
    ? spellingPreserved(source, target, policy)
    : grammarPreserved(source, target, policy);
}
