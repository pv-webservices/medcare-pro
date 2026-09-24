/**
 * AI-4 deterministic normalization (PRD §5). Fixed lookup tables only: any
 * value a rule does not recognise returns null, which the caller reports as
 * "not comparable" — never as a match or a discrepancy.
 *
 * The Hinglish entries are clinical content awaiting named-clinician sign-off
 * (PRD §12 Q5); the feature stays behind CLINICAL_RECONCILIATION_ENABLED.
 */

export const RECONCILE_RULES_VERSION = "ai4-rules-v1";

const clean = (raw: string) =>
  raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,;:!?]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
const latinOnly = (text: string) => !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(text);

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6,
  chhah: 6, saat: 7, aath: 8, nau: 9, das: 10,
};
function count(token: string): number | null {
  if (/^\d{1,4}$/u.test(token)) return Number(token) || null;
  return NUMBER_WORDS[token] ?? null;
}

// ---------------------------------------------------------------- drug names

const FORM_WORDS = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules",
  "syp", "syrup", "susp", "suspension", "inj", "injection", "drop", "drops",
  "cream", "ointment", "oint", "gel", "lotion", "inhaler", "powder",
]);
const STRENGTH_TOKEN = /^\d+(?:\.\d+)?(?:mg|mcg|µg|ug|g|gm|ml|iu|%)?$/u;
const UNIT_TOKEN = /^(?:mg|mcg|µg|ug|g|gm|ml|iu|%)$/u;

/** Whole-name comparison key: form words and strengths removed. Non-Latin
 * names are not comparable in v1. Never fuzzy: look-alike names differ. */
export function normalizeDrugName(raw: string): string | null {
  const text = clean(raw);
  if (!text || !latinOnly(text)) return null;
  const tokens = text
    // A full stop splits only outside numbers ("Tab." vs "0.5mg").
    .split(/[\s\-+/(),]+|\.(?!\d)/u)
    .filter((token) => token && !FORM_WORDS.has(token) && !STRENGTH_TOKEN.test(token) && !UNIT_TOKEN.test(token));
  const name = tokens.join(" ");
  return /\p{L}{3}/u.test(name) ? name : null;
}

// ------------------------------------------------------------------ strength

export type Strength = { value: number; unit: "mg" | "ml" | "iu" | "%" };
const STRENGTH_UNITS: Record<string, [Strength["unit"], number]> = {
  mg: ["mg", 1], g: ["mg", 1000], gm: ["mg", 1000], mcg: ["mg", 0.001],
  "µg": ["mg", 0.001], ug: ["mg", 0.001], ml: ["ml", 1], iu: ["iu", 1], "%": ["%", 1],
};

/** "650 mg", "650mg", "0.5 g" (-> 500 mg). A bare number has no unit and is
 * not comparable. */
export function normalizeStrength(raw: string): Strength | null {
  const match = clean(raw).match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|gm|g|ml|iu|%)$/u);
  if (!match) return null;
  const [unit, factor] = STRENGTH_UNITS[match[2]];
  return { value: Math.round(Number(match[1]) * factor * 1e6) / 1e6, unit };
}
export const sameStrength = (a: Strength, b: Strength) => a.unit === b.unit && a.value === b.value;

// ----------------------------------------------------------------- frequency

/** Doses per day ("1/d"), per week ("1/w"), or "PRN". */
export type Frequency = "1/d" | "2/d" | "3/d" | "4/d" | "6/d" | "1/w" | "PRN";
const FREQUENCIES: Record<string, Frequency> = {
  od: "1/d", qd: "1/d", daily: "1/d", "once daily": "1/d", "once a day": "1/d",
  "once per day": "1/d", hs: "1/d", "at night": "1/d", "at bedtime": "1/d",
  "every 24 hours": "1/d", "raat ko": "1/d", "roz ek baar": "1/d",
  bd: "2/d", bid: "2/d", "twice daily": "2/d", "twice a day": "2/d",
  "every 12 hours": "2/d", "subah shaam": "2/d",
  tds: "3/d", tid: "3/d", "thrice daily": "3/d", "thrice a day": "3/d",
  "three times daily": "3/d", "every 8 hours": "3/d",
  qid: "4/d", qds: "4/d", "four times daily": "4/d", "every 6 hours": "4/d",
  "every 4 hours": "6/d",
  weekly: "1/w", "once a week": "1/w", "once weekly": "1/w", "hafte mein ek baar": "1/w",
  sos: "PRN", prn: "PRN", "as needed": "PRN", "as required": "PRN", "when needed": "PRN",
  "when required": "PRN",
};
const PER_DAY: Record<number, Frequency> = { 1: "1/d", 2: "2/d", 3: "3/d", 4: "4/d", 6: "6/d" };

export function normalizeFrequency(raw: string): Frequency | null {
  const text = clean(raw);
  if (FREQUENCIES[text]) return FREQUENCIES[text];
  // Dose-schedule notation: 1-0-1, 1-1-1, 1-1-1-1 (morning-afternoon-night).
  const schedule = text.replace(/\s/gu, "");
  if (/^[01](?:-[01]){2,3}$/u.test(schedule)) return PER_DAY[schedule.split("-").filter((d) => d === "1").length] ?? null;
  // "2 times a day", "three times daily", "din mein do baar", "do baar".
  const spoken = text.match(/^(?:(?:din|roz)(?: (?:mein|me))? )?(\S+) (?:times|time|baar|bar)(?: (?:a|per) day| daily| (?:din|roz)(?: (?:mein|me))?)?$/u);
  if (spoken) {
    const n = count(spoken[1]);
    return n ? PER_DAY[n] ?? null : null;
  }
  return null;
}

// ------------------------------------------------------------------ duration

const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1, din: 1, dino: 1,
  week: 7, weeks: 7, wk: 7, wks: 7, hafta: 7, hafte: 7, hafton: 7,
  month: 30, months: 30, mahina: 30, mahine: 30, mahino: 30,
};
const INTERVAL = /\b(\d{1,4}|[a-z]+) (days?|din|dino|weeks?|wks?|hafta|hafte|hafton|months?|mahina|mahine|mahino)\b/gu;

/** "5 days", "for 5 days", "5 din tak", "ek hafta", "2 weeks later",
 * "7 din baad" -> days. The whole value must be one interval. */
export function normalizeDuration(raw: string): number | null {
  const text = clean(raw)
    .replace(/^(?:for|after|in|next) /u, "")
    .replace(/ (?:tak|ke liye|baad|ke baad|later|ke bad|bad)$/u, "");
  const match = text.match(/^(\S+) (\S+)$/u);
  if (!match) return null;
  const n = count(match[1]);
  const unit = UNIT_DAYS[match[2]];
  return n && unit ? n * unit : null;
}

/** Draft duration fields: numeric value plus the builder's unit list. */
export function draftDurationDays(value: number | null, unit: string): number | null {
  const days = UNIT_DAYS[clean(unit)];
  return value && days ? value * days : null;
}

/** Every interval stated anywhere in free-text follow-up instructions. */
export function intervalsInText(raw: string): number[] {
  const found: number[] = [];
  for (const match of clean(raw).matchAll(INTERVAL)) {
    const n = count(match[1]);
    if (n) found.push(n * UNIT_DAYS[match[2]]);
  }
  return found;
}

export function describeDays(days: number): string {
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? "" : "s"}`;
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}
