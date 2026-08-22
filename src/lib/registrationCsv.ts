import { toCsv, type CsvColumn } from "@/lib/csv";
import {
  VISIT_TYPE_LABELS,
  type RegistrationRecord,
} from "@/lib/registrations";

/**
 * CSV export of the registration list — PRD §6.3 (FR-3.4).
 *
 * This file owns the columns. The BOM, the formula guard and the RFC 4180
 * quoting live in src/lib/csv.ts, shared with the revenue report export so the
 * two can never disagree about what is safe to write into a cell.
 *
 * Gated by `registration:read`, not by `reports:export`: this is the list on
 * screen, downloaded. The revenue export is the separate gate.
 */

const COLUMNS: readonly CsvColumn<RegistrationRecord>[] = [
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
  { header: "Visit Type", value: (r) => VISIT_TYPE_LABELS[r.visitType] },
  // Unformatted and unsymboled: a spreadsheet needs to sum this column, so the
  // currency belongs in the header rather than in every cell.
  { header: "Amount (INR)", value: (r) => r.amount },
  { header: "Visit Date", value: (r) => r.visitDate },
  { header: "Visit Time", value: (r) => r.visitTime },
];

export function toRegistrationCsv(
  records: readonly RegistrationRecord[],
): string {
  return toCsv(COLUMNS, records);
}

/** e.g. `registrations-2026-08-15.csv`. */
export function registrationCsvFilename(today: string): string {
  return `registrations-${today}.csv`;
}
