import { toCsv, type CsvColumn } from "@/lib/csv";
import type { DueRecord } from "./dues";

/**
 * CSV export of the dues list — billing PRD FR-11.18.
 *
 * Follows src/lib/registrationCsv.ts: this file owns the columns, src/lib/csv.ts
 * owns the BOM, formula guard and quoting. Money is unformatted with the
 * currency in the header, so a spreadsheet can sum it.
 */
const IST_OFFSET_MS = 19_800_000;
function istDateTime(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

const COLUMNS: readonly CsvColumn<DueRecord>[] = [
  { header: "Invoice number", value: (r) => r.invoiceNumber },
  { header: "Issued (IST)", value: (r) => istDateTime(r.issuedAt) },
  { header: "Age (days)", value: (r) => String(r.ageDays) },
  { header: "Patient ID", value: (r) => r.patientCode },
  { header: "Patient Name", value: (r) => r.patientName },
  { header: "Mobile Number", value: (r) => r.mobileNumber },
  { header: "Clinic", value: (r) => r.clinicName },
  { header: "Doctor", value: (r) => r.doctorName ?? "" },
  { header: "Grand total (INR)", value: (r) => r.grandTotal },
  { header: "Paid (INR)", value: (r) => r.amountPaid },
  { header: "Balance due (INR)", value: (r) => r.balanceDue },
];

export function toDuesCsv(records: readonly DueRecord[]): string {
  return toCsv(COLUMNS, records);
}

/** e.g. `dues-2026-09-29.csv`, dated in India time. */
export function duesCsvFilename(now: Date = new Date()): string {
  return `dues-${new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)}.csv`;
}
