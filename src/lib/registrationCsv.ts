import type { RegistrationRecord } from "@/lib/registrations";

/**
 * CSV export of the registration list — PRD §6.3 (FR-3.4).
 *
 * The file is opened in Excel or Sheets by clinic staff, which drives two
 * decisions here:
 *
 *   - A UTF-8 BOM is prepended, or Excel renders non-ASCII patient names as
 *     mojibake.
 *   - Cells that a spreadsheet would evaluate as a formula are prefixed with an
 *     apostrophe, so a patient name typed as `=cmd|…` opens as text rather than
 *     executing (CSV injection).
 */

const BOM = "﻿";

interface Column {
  header: string;
  value: (record: RegistrationRecord) => string;
}

const COLUMNS: readonly Column[] = [
  { header: "Patient ID", value: (r) => r.patientCode },
  { header: "Patient Name", value: (r) => r.patientName },
  { header: "Age", value: (r) => (r.age === null ? "" : String(r.age)) },
  { header: "Gender", value: (r) => r.gender ?? "" },
  { header: "Mobile Number", value: (r) => r.mobileNumber },
  { header: "Address", value: (r) => r.address ?? "" },
  { header: "City", value: (r) => r.city ?? "" },
  { header: "Clinic", value: (r) => r.clinicName },
  { header: "Doctor", value: (r) => r.doctorName ?? "" },
  { header: "Department", value: (r) => r.department },
  { header: "Amount", value: (r) => r.amount },
  { header: "Visit Date", value: (r) => r.visitDate },
];

/**
 * True when a spreadsheet would treat the cell as a formula.
 *
 * `+` and `-` are excluded for values that read as a phone number or a plain
 * figure — quoting every `+91…` mobile number would make the export worse for
 * the common case without closing anything, since neither can name a function.
 */
const PHONE_OR_NUMBER = /^[+-][\d\s()-]*$/;

function needsFormulaGuard(value: string): boolean {
  if (value === "") {
    return false;
  }

  if (/^[=@\t\r]/.test(value)) {
    return true;
  }

  return /^[+-]/.test(value) && !PHONE_OR_NUMBER.test(value);
}

function escapeCell(value: string): string {
  const guarded = needsFormulaGuard(value) ? `'${value}` : value;

  // RFC 4180: quote anything containing a delimiter, quote or newline, and
  // double the quotes inside.
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }

  return guarded;
}

export function toRegistrationCsv(
  records: readonly RegistrationRecord[],
): string {
  const rows = [
    COLUMNS.map((column) => escapeCell(column.header)),
    ...records.map((record) =>
      COLUMNS.map((column) => escapeCell(column.value(record))),
    ),
  ];

  // CRLF line endings — the RFC 4180 default, and what Excel expects.
  return BOM + rows.map((cells) => cells.join(",")).join("\r\n") + "\r\n";
}

/** e.g. `registrations-2026-08-15.csv`. */
export function registrationCsvFilename(today: string): string {
  return `registrations-${today}.csv`;
}
