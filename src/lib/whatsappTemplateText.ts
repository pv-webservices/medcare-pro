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

/**
 * Filled at send time — from the patient and their latest VISIT, or, for an
 * appointment reminder, from the APPOINTMENT itself.
 *
 * THE TWO GROUPS DESCRIBE DIFFERENT THINGS AND MUST NOT BE CONFUSED — AP-8.
 * `visitDate` is the date of a registration that has already happened;
 * `appointmentDate` is a slot still ahead of the patient. Writing "your
 * appointment is on {visitDate}" would send somebody the date of their LAST
 * visit, which is why the appointment group exists rather than the reminder
 * borrowing the visit group's tokens.
 *
 * A token from the wrong group is not an error — it renders as MISSING_VALUE,
 * the same as any known placeholder with nothing behind it. The template editor
 * lists both groups with labels saying which is which.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "patientName",
  "patientCode",
  "clinicName",
  "doctorName",
  "department",
  "visitDate",
  "visitTime",
  "amount",
  // AP-8 — the appointment group. Filled only by an appointment reminder.
  "appointmentDate",
  "appointmentTime",
  "serviceName",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  patientName: "Patient name",
  patientCode: "Patient ID",
  clinicName: "Clinic name",
  doctorName: "Doctor name",
  department: "Department",
  visitDate: "Visit date (last visit)",
  visitTime: "Visit time (last visit)",
  amount: "Amount",
  appointmentDate: "Appointment date (reminders only)",
  appointmentTime: "Appointment time (reminders only)",
  serviceName: "Service (reminders only)",
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
