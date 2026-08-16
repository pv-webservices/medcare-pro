/**
 * Template wording and placeholder substitution — FR-9.1.
 *
 * Pure helpers only: no Prisma, no session, no server-only imports. The reads
 * and writes live in src/lib/whatsappTemplates.ts, which owns the scoping
 * rules; this module owns the *text* so the composer's live preview and the
 * server's actual send run the identical substitution. A preview that renders
 * differently from what goes out is worse than no preview.
 *
 * Same split, and same reason, as src/lib/registrationAudit.ts.
 */

/** Filled from the patient and their latest visit at send time. */
export const TEMPLATE_PLACEHOLDERS = [
  "patientName",
  "patientCode",
  "clinicName",
  "doctorName",
  "department",
  "visitDate",
  "visitTime",
  "amount",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  patientName: "Patient name",
  patientCode: "Patient ID",
  clinicName: "Clinic name",
  doctorName: "Doctor name",
  department: "Department",
  visitDate: "Visit date",
  visitTime: "Visit time",
  amount: "Amount",
};

/** Stands in for a known placeholder with nothing behind it. */
export const MISSING_VALUE = "—";

const PLACEHOLDER_PATTERN = /\{([a-zA-Z]+)\}/g;

export const MAX_BODY_LENGTH = 4000;

/** The values a template renders against. Every key is a known placeholder. */
export type TemplateValues = Partial<Record<TemplatePlaceholder, string>>;

export function isKnownPlaceholder(value: string): value is TemplatePlaceholder {
  return (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(value);
}

/** Every `{token}` in the body that is not one we can fill. */
export function unknownPlaceholders(body: string): string[] {
  const found = [...body.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
  return [...new Set(found.filter((token) => !isKnownPlaceholder(token)))];
}

/** Which known placeholders a body actually uses, in first-seen order. */
export function usedPlaceholders(body: string): TemplatePlaceholder[] {
  const found = [...body.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => match[1])
    .filter(isKnownPlaceholder);

  return [...new Set(found)];
}

/**
 * Substitutes placeholders into a body.
 *
 * An unknown token is left exactly as written rather than blanked: a template
 * saying "{appointmnetDate}" should look obviously wrong in the preview rather
 * than silently sending a sentence with a hole in it. A KNOWN token with no
 * value behind it — no doctor on the visit, say — becomes an em dash, for the
 * same reason: visible, but not a broken sentence.
 */
export function renderTemplate(body: string, values: TemplateValues): string {
  return body.replace(PLACEHOLDER_PATTERN, (whole, token: string) => {
    if (!isKnownPlaceholder(token)) {
      return whole;
    }
    const value = values[token];
    return value === undefined || value.trim() === "" ? MISSING_VALUE : value;
  });
}
