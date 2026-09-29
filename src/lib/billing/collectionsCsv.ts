import { toCsv, type CsvColumn } from "@/lib/csv";
import type { BreakdownRow } from "@/lib/reports";
import type { ClinicCollectionsRow, CollectionsReport } from "./collectionsReport";

/**
 * CSV export of the collections report — FR-11.23, gated by `reports:export`.
 *
 * Follows src/lib/reportCsv.ts: one table per file, money unformatted under an
 * `(INR)` header so a spreadsheet can sum it, and the filename names the
 * reported window rather than the download date.
 */

export const COLLECTIONS_EXPORT_SECTIONS = ["trend", "modes", "clinics"] as const;
export type CollectionsExportSection = (typeof COLLECTIONS_EXPORT_SECTIONS)[number];

export function isCollectionsExportSection(value: string): value is CollectionsExportSection {
  return (COLLECTIONS_EXPORT_SECTIONS as readonly string[]).includes(value);
}

interface TrendRow {
  bucket: string;
  fullLabel: string;
  bills: number;
  billed: string;
  visitsPaid: number;
  collected: string;
}

const TREND_COLUMNS: readonly CsvColumn<TrendRow>[] = [
  { header: "Period Starting", value: (row) => row.bucket },
  { header: "Period", value: (row) => row.fullLabel },
  { header: "Bills issued", value: (row) => String(row.bills) },
  { header: "Billed (INR)", value: (row) => row.billed },
  { header: "Visits paid", value: (row) => String(row.visitsPaid) },
  { header: "Collected (INR)", value: (row) => row.collected },
];

const MODE_COLUMNS: readonly CsvColumn<BreakdownRow>[] = [
  { header: "Payment mode", value: (row) => row.name },
  { header: "Payments", value: (row) => String(row.registrations) },
  { header: "Collected (INR)", value: (row) => row.revenue },
  { header: "Share %", value: (row) => row.sharePercent.toFixed(2) },
];

const CLINIC_COLUMNS: readonly CsvColumn<ClinicCollectionsRow>[] = [
  { header: "Clinic", value: (row) => row.name },
  { header: "Bills issued", value: (row) => String(row.billCount) },
  { header: "Billed (INR)", value: (row) => row.billed },
  { header: "Payments", value: (row) => String(row.registrations) },
  { header: "Collected (INR)", value: (row) => row.revenue },
  { header: "Discounts (INR)", value: (row) => row.discounts },
  { header: "CGST (INR)", value: (row) => row.cgst },
  { header: "SGST (INR)", value: (row) => row.sgst },
  // Point-in-time, like the Outstanding tile; not bound to the period.
  { header: "Outstanding now (INR)", value: (row) => row.outstanding },
];

export function toCollectionsCsv(report: CollectionsReport, section: CollectionsExportSection): string {
  if (section === "modes") return toCsv(MODE_COLUMNS, report.byPaymentMode);
  if (section === "clinics") return toCsv(CLINIC_COLUMNS, report.byClinic);
  // Both series are built from the same bucket keys, so they line up by index.
  const rows = report.billedSeries.map((point, index) => ({ bucket: point.bucket, fullLabel: point.fullLabel,
    bills: point.registrations, billed: point.revenue, visitsPaid: report.collectedSeries[index].registrations,
    collected: report.collectedSeries[index].revenue }));
  return toCsv(TREND_COLUMNS, rows);
}

const FILENAME_SLUG: Record<CollectionsExportSection, string> = {
  trend: "collections-trend",
  modes: "collections-by-payment-mode",
  clinics: "collections-by-clinic",
};

/** e.g. `collections-by-clinic-monthly-2026-09-01.csv`; the trend is named for its first and last bucket. */
export function collectionsCsvFilename(report: CollectionsReport, section: CollectionsExportSection): string {
  const series = report.billedSeries;
  const window = section === "trend" && series.length > 0
    ? (series[0].bucket === series.at(-1)!.bucket ? series[0].bucket : `${series[0].bucket}-to-${series.at(-1)!.bucket}`)
    : report.rangeStartDate;
  return `${FILENAME_SLUG[section]}-${report.period}-${window}.csv`;
}
