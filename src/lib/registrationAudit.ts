/**
 * The registration edit trail — PRD §6.3 (FR-3.6) and §9 (Audit integrity).
 *
 * Pure helpers only: no Prisma, no session. The reads and writes live in
 * src/lib/registrations.ts, which owns the scoping rules; this module owns the
 * *shape* of what gets logged so the format is decided in exactly one place.
 *
 * Two properties the rest of the app depends on:
 *
 *   - Every value is stored as text, already formatted the way the UI shows it.
 *     A log row has to stay readable years later without re-joining the tables
 *     it came from, so the doctor is recorded by NAME, not by id — the same
 *     reasoning as `role_at_time` on the log row itself.
 *   - The log is APPEND-ONLY. Nothing here updates or deletes an entry, and
 *     nothing anywhere else may either, Owner included.
 */

/**
 * The editable surface of a registration — the patient's own details plus the
 * visit. Both halves are logged together because from the front desk they are
 * one record on one form (FR-3.1).
 */
export interface RegistrationSnapshot {
  patientName: string;
  age: number | null;
  gender: string | null;
  mobileNumber: string;
  address: string | null;
  city: string | null;
  /** The doctor's name at the time of the edit — see the note above. */
  doctor: string | null;
  department: string;
  /** Always fixed to 2 decimals, so "500" and "500.00" never read as a change. */
  amount: string;
  /** "New patient" / "Follow-up", by label rather than by stored code. */
  visitType: string;
  /** "YYYY-MM-DD HH:mm" — date and time move as one change, not two. */
  visitAt: string;
}

export type SnapshotField = keyof RegistrationSnapshot;

/** Field order here is the order changes are displayed in. */
export const FIELD_LABELS: Record<SnapshotField, string> = {
  patientName: "Patient name",
  age: "Age",
  gender: "Gender",
  mobileNumber: "Mobile number",
  address: "Address",
  city: "City",
  doctor: "Doctor",
  department: "Department",
  amount: "Amount",
  visitType: "Visit type",
  visitAt: "Visit date & time",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as SnapshotField[];

export interface FieldChange {
  from: string | null;
  to: string | null;
}

/** Stored verbatim in `registration_edit_log.changed_fields`. */
export type ChangedFields = Record<string, FieldChange>;

/** Blank and absent are the same thing in the log: "not recorded". */
function toText(value: string | number | null): string | null {
  if (value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * The per-field before/after set for one write.
 *
 * `before === null` means this is the creation of the record, which is logged
 * too (every field with a `from` of null) — the skill requires a log row for
 * creates as well as edits, so the trail starts with how the record was first
 * entered rather than with the first correction to it.
 */
export function diffSnapshots(
  before: RegistrationSnapshot | null,
  after: RegistrationSnapshot,
): ChangedFields {
  const changed: ChangedFields = {};

  for (const field of FIELD_ORDER) {
    const from = before === null ? null : toText(before[field]);
    const to = toText(after[field]);

    if (from === to) {
      continue;
    }

    changed[field] = { from, to };
  }

  return changed;
}

export interface RenderedChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/**
 * Reads a stored `changed_fields` value back for display.
 *
 * It comes out of a Json column as `unknown`, and rows written by an older
 * version of this format must still render, so anything unrecognised is skipped
 * rather than throwing — a malformed row must not take down the history page.
 */
export function parseChangedFields(value: unknown): RenderedChange[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const changes: RenderedChange[] = [];

  for (const [field, change] of Object.entries(value)) {
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
      continue;
    }

    const { from, to } = change as { from?: unknown; to?: unknown };

    changes.push({
      field,
      // An unknown key is shown under its own name rather than dropped: the log
      // is the record of what happened, not a filtered view of it.
      label: FIELD_LABELS[field as SnapshotField] ?? field,
      from: typeof from === "string" ? from : null,
      to: typeof to === "string" ? to : null,
    });
  }

  const rank = (field: string) => {
    const index = FIELD_ORDER.indexOf(field as SnapshotField);
    return index === -1 ? FIELD_ORDER.length : index;
  };

  return changes.sort((a, b) => rank(a.field) - rank(b.field));
}
