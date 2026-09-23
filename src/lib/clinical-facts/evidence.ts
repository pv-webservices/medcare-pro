import type { EffectiveTranscriptSegment } from "@/lib/transcription/effectiveTranscript";
import {
  CATEGORY_ATTRIBUTES,
  type FactAssertion,
  type FactCategory,
  type FactSubject,
} from "./schema";

/**
 * Deterministic evidence validation for AI-3 (PRD §7). The provider proposes;
 * this module decides. A candidate that fails any rule is discarded and never
 * shown. Reason codes are metadata only (no clinical text).
 */

export type FactCandidate = {
  category: FactCategory;
  assertion: FactAssertion;
  subject: FactSubject;
  statement: string;
  attributes: Record<string, string | undefined>;
  evidence: { segmentId: string; quote: string }[];
};

export type FactEvidence = {
  segmentId: string;
  correctionId: string | null;
  speakerType: string;
  quote: string;
  charStart: number;
  charEnd: number;
};

export type ValidatedFact = Omit<FactCandidate, "evidence" | "attributes"> & {
  attributes: Record<string, string>;
  evidence: FactEvidence[];
};

export type FactRejection =
  | "UNSUPPORTED_ATTRIBUTE"
  | "MISSING_ATTRIBUTE"
  | "UNKNOWN_SEGMENT"
  | "UNCONFIRMED_SPEAKER"
  | "QUOTE_NOT_FOUND"
  | "ATTRIBUTE_NOT_IN_EVIDENCE"
  | "NUMBER_NOT_IN_EVIDENCE"
  | "LATERALITY_NOT_IN_EVIDENCE"
  | "QUESTION_AS_FACT"
  | "NEGATION_WITHOUT_CUE"
  | "NEGATION_MISMATCH"
  | "SUBJECT_UNSUPPORTED";

export type FactValidation =
  | { ok: true; fact: ValidatedFact }
  | { ok: false; reason: FactRejection };

// PRD §13 Q4: English, Hindi and Hinglish (en-IN, hi-IN) negation cues.
// English contractions ("doesn't") are forms of "not".
const NEGATION_CUE =
  /(?<![\p{L}\p{M}])(?:no|not|denies|denied|never|without|none|nil|negative|absent|rules out|ruled out|nahi|nahin|na|mat|nhi|नहीं|ना|मत|[\p{L}]+n['’]t)(?![\p{L}\p{M}])/iu;
const LATERALITY = /(?<![\p{L}])(?:left|right|bilateral|unilateral)(?![\p{L}])/giu;
const NUMBER = /\d+(?:[.,]\d+)?/gu;
const PARTICIPANTS = new Set(["PATIENT", "CAREGIVER", "DOCTOR"]);
// How many words before an anchor a negation cue must be absent for PRESENT.
const NEGATION_WINDOW = 2;

const lower = (value: string) => value.toLocaleLowerCase("en-IN");

function isQuestion(text: string, start: number, end: number): boolean {
  const after = text.slice(end).search(/[.!?\n]/u);
  const terminator = after === -1 ? "" : text[end + after];
  return /\?\s*$/u.test(text.slice(start, end)) || terminator === "?";
}

function negatedAnchor(quote: string, anchor: string): boolean {
  const index = lower(quote).indexOf(lower(anchor));
  if (index < 0) return false;
  const before = quote.slice(0, index).split(/[\s,;:]+/u).filter(Boolean);
  return before
    .slice(-NEGATION_WINDOW)
    .some((word) => NEGATION_CUE.test(word.replace(/[^\p{L}\p{M}'’ ]/gu, "")));
}

export function validateFactCandidate(
  candidate: FactCandidate,
  segments: EffectiveTranscriptSegment[],
): FactValidation {
  const reject = (reason: FactRejection): FactValidation => ({ ok: false, reason });
  const rules = CATEGORY_ATTRIBUTES[candidate.category];
  const allowed = new Set([...rules.anchor, ...rules.optional]);
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate.attributes)) {
    if (value === undefined) continue;
    if (!allowed.has(key)) return reject("UNSUPPORTED_ATTRIBUTE");
    attributes[key] = value;
  }
  if (rules.anchor.some((key) => !attributes[key]?.trim()))
    return reject("MISSING_ATTRIBUTE");

  const byId = new Map(segments.map((s) => [s.segmentId, s]));
  const evidence: FactEvidence[] = [];
  const questions: boolean[] = [];
  for (const item of candidate.evidence) {
    const segment = byId.get(item.segmentId);
    if (!segment) return reject("UNKNOWN_SEGMENT");
    if (segment.speakerType === "UNKNOWN") return reject("UNCONFIRMED_SPEAKER");
    const charStart = segment.text.indexOf(item.quote);
    if (charStart < 0) return reject("QUOTE_NOT_FOUND");
    const charEnd = charStart + item.quote.length;
    evidence.push({
      segmentId: segment.segmentId,
      correctionId: segment.correctionId,
      speakerType: segment.speakerType,
      quote: item.quote,
      charStart,
      charEnd,
    });
    questions.push(isQuestion(segment.text, charStart, charEnd));
  }

  const quotes = evidence.map((e) => e.quote).join("\n");
  const said = lower(quotes);
  if (Object.values(attributes).some((value) => !said.includes(lower(value))))
    return reject("ATTRIBUTE_NOT_IN_EVIDENCE");
  const claimed = [candidate.statement, ...Object.values(attributes)].join("\n");
  const saidNumbers = new Set(quotes.match(NUMBER) ?? []);
  if ((claimed.match(NUMBER) ?? []).some((n) => !saidNumbers.has(n)))
    return reject("NUMBER_NOT_IN_EVIDENCE");
  const saidSides = new Set((quotes.match(LATERALITY) ?? []).map(lower));
  if ((claimed.match(LATERALITY) ?? []).some((side) => !saidSides.has(lower(side))))
    return reject("LATERALITY_NOT_IN_EVIDENCE");

  // A question alone never establishes a fact (PRD §7.3).
  if (questions.every(Boolean)) return reject("QUESTION_AS_FACT");
  const statements = evidence.filter((_, i) => !questions[i]);
  // No negatives from silence (PRD §7.4).
  if (
    candidate.assertion === "NEGATED" &&
    !statements.some((e) => NEGATION_CUE.test(e.quote))
  )
    return reject("NEGATION_WITHOUT_CUE");
  const anchor = attributes[rules.anchor[0]];
  if (
    (candidate.assertion === "PRESENT" || candidate.assertion === "HISTORICAL") &&
    statements.some((e) => negatedAnchor(e.quote, anchor))
  )
    return reject("NEGATION_MISMATCH");
  if (
    candidate.subject === "PATIENT" &&
    !evidence.some((e) => PARTICIPANTS.has(e.speakerType))
  )
    return reject("SUBJECT_UNSUPPORTED");

  return {
    ok: true,
    fact: {
      category: candidate.category,
      assertion: candidate.assertion,
      subject: candidate.subject,
      statement: candidate.statement,
      attributes,
      evidence,
    },
  };
}

function anchorOf(fact: Pick<ValidatedFact, "category" | "attributes">) {
  return lower(fact.attributes[CATEGORY_ATTRIBUTES[fact.category].anchor[0]] ?? "");
}

/** Combine duplicates proposed by overlapping chunks, unioning evidence. */
export function mergeFacts(facts: ValidatedFact[]): ValidatedFact[] {
  const merged = new Map<string, ValidatedFact>();
  for (const fact of facts) {
    const key = [fact.category, fact.subject, fact.assertion, anchorOf(fact)].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...fact, evidence: [...fact.evidence] });
      continue;
    }
    for (const item of fact.evidence)
      if (!existing.evidence.some((e) => e.segmentId === item.segmentId && e.charStart === item.charStart))
        existing.evidence.push(item);
  }
  return [...merged.values()];
}

/** Keys of facts that disagree about the same thing (e.g. "no fever" and
 * "fever yesterday"). They are flagged for the doctor, never auto-resolved. */
export function conflictingFactKeys(
  facts: Pick<ValidatedFact, "category" | "subject" | "assertion" | "attributes">[],
): Set<string> {
  const assertions = new Map<string, Set<string>>();
  for (const fact of facts) {
    const key = [fact.category, fact.subject, anchorOf(fact)].join("|");
    assertions.set(key, (assertions.get(key) ?? new Set()).add(fact.assertion));
  }
  return new Set([...assertions].filter(([, set]) => set.size > 1).map(([key]) => key));
}
export function conflictKeyOf(fact: Pick<ValidatedFact, "category" | "subject" | "attributes">) {
  return [fact.category, fact.subject, anchorOf(fact)].join("|");
}

/** Sequential chunks on segment boundaries, each within maxChars (a single
 * oversized segment forms its own chunk), overlapping by `overlap` segments
 * so facts spanning a boundary keep their context. Never summarizes. */
export function chunkSegments<T extends { text: string }>(
  segments: T[],
  maxChars: number,
  overlap: number,
): T[][] {
  const chunks: T[][] = [];
  let start = 0;
  while (start < segments.length) {
    let end = start;
    let size = 0;
    while (end < segments.length && (end === start || size + segments[end].text.length <= maxChars)) {
      size += segments[end].text.length;
      end++;
    }
    chunks.push(segments.slice(start, end));
    if (end >= segments.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
