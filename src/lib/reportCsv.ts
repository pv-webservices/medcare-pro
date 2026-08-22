import { toCsv, type CsvColumn } from "@/lib/csv";
import type { BreakdownRow, RevenuePoint, RevenueReport } from "@/lib/reports";

/**
 * CSV export of the revenue report — PRD §6.6, gated by `reports:export`.
 *
 * ONE TABLE PER FILE. The report on screen is four things — KPI tiles, a growth
 * series and two breakdowns — and stacking them into a single download would
 * produce a file no spreadsheet can total without hand-editing it first. So
 * each panel exports itself, and every file is a plain header row followed by
 * data rows.
 *
 * The KPI tiles have no export of their own on purpose: every figure on them is
 * either a total of a column below (`SUM`) or a ratio of two, so a file holding
 * six numbers would be a worse copy of arithmetic the spreadsheet already does.
 *
 * Money is written unformatted and unsymboled under an `(INR)` header, matching
 * the registration export — `formatRupees` output like `₹1,50,000.00` is text
 * to a spreadsheet, not a number it can add.
 */

export const REPORT_EXPORT_SECTIONS = ["trend", "clinics", "doctors"] as const;
export type ReportExportSection = (typeof REPORT_EXPORT_SECTIONS)[number];

export function isReportExportSection(
  value: string,
): value is ReportExportSection {
  return (REPORT_EXPORT_SECTIONS as readonly string[]).includes(value);
}

/**
 * `sharePercent` is a float derived from two exact decimal strings. Two places
 * is one more than the screen shows and is plenty — anyone needing it exact can
 * divide the revenue column by its own total, which is why that column is
 * exported unrounded.
 */
function formatShare(row: BreakdownRow): string {
  return row.sharePercent.toFixed(2);
}

const TREND_COLUMNS: readonly CsvColumn<RevenuePoint>[] = [
  // ISO first so the file sorts correctly on the column a reader would sort by;
  // the written label follows for anyone reading it rather than charting it.
  { header: "Period Starting", value: (point) => point.bucket },
  { header: "Period", value: (point) => point.fullLabel },
  { header: "Registrations", value: (point) => String(point.registrations) },
  { header: "Revenue (INR)", value: (point) => point.revenue },
];

function breakdownColumns(
  entityLabel: string,
): readonly CsvColumn<BreakdownRow>[] {
  return [
    { header: entityLabel, value: (row) => row.name },
    { header: "Registrations", value: (row) => String(row.registrations) },
    { header: "Revenue (INR)", value: (row) => row.revenue },
    { header: "Share %", value: formatShare },
  ];
}

/** The rows of one section, in the order the screen shows them. */
export function toReportCsv(
  report: RevenueReport,
  section: ReportExportSection,
): string {
  if (section === "trend") {
    return toCsv(TREND_COLUMNS, report.series);
  }

  return section === "clinics"
    ? toCsv(breakdownColumns("Clinic"), report.byClinic)
    : toCsv(breakdownColumns("Doctor"), report.byDoctor);
}

const FILENAME_SLUG: Record<ReportExportSection, string> = {
  trend: "revenue-trend",
  clinics: "revenue-by-clinic",
  doctors: "revenue-by-doctor",
};

/**
 * e.g. `revenue-by-clinic-monthly-2026-08-01.csv`.
 *
 * The date names the window the figures cover, NOT the day of the download: two
 * people exporting the same report a week apart should get the same filename,
 * and a folder of these should sort by reporting period.
 *
 * The trend spans further back than the reported period — it is the graph, not
 * the current bucket — so it is named for its own first and last bucket rather
 * than borrowing the period's start date and understating what is in the file.
 *
 * The clinic filter is deliberately left out. A clinic's name can hold a comma,
 * a slash or a non-Latin script, none of which survive a Content-Disposition
 * header intact; the file's scope is stated on the screen it was downloaded
 * from, and the by-clinic column names it inside the file.
 */
export function reportCsvFilename(
  report: RevenueReport,
  section: ReportExportSection,
): string {
  const window =
    section === "trend"
      ? trendWindow(report.series, report.rangeStartDate)
      : report.rangeStartDate;

  return `${FILENAME_SLUG[section]}-${report.period}-${window}.csv`;
}

function trendWindow(
  series: readonly RevenuePoint[],
  fallback: string,
): string {
  if (series.length === 0) {
    return fallback;
  }

  const first = series[0].bucket;
  const last = series[series.length - 1].bucket;

  return first === last ? first : `${first}-to-${last}`;
}
