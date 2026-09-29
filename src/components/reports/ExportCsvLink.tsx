import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import type { CollectionsExportSection } from "@/lib/billing/collectionsCsv";
import type { ReportExportSection } from "@/lib/reportCsv";
import type { ReportPeriod } from "@/lib/reportPeriods";

/**
 * The download control on a revenue report panel — Stage 7.
 *
 * A plain link, not a button with a fetch behind it: the browser's own download
 * handling is what puts the file somewhere the user can find it, and the server
 * sets the filename in Content-Disposition. Nothing here reads the response.
 *
 * Rendered only for someone holding `reports:export`. That is a courtesy, not
 * the control — @/lib/reports checks the permission again on the way in, so
 * typing the URL gets the same 403.
 *
 * Every panel exports its own section, so the visible label is the same three
 * words on all of them and the distinguishing part is in `aria-label`. A screen
 * reader listing the page's links should not read "Export CSV" three times.
 */

interface ExportCsvLinkProps {
  section: ReportExportSection | CollectionsExportSection;
  period: ReportPeriod;
  /** The sidebar switcher's clinic, so the file matches the screen (FR-2.3). */
  clinicId: string | null;
  /** Completes "Export … as CSV", e.g. "the revenue trend". */
  describes: string;
  /** The report API to download from; the revenue report unless named. */
  endpoint?: "/api/reports/revenue" | "/api/reports/collections";
}

export default function ExportCsvLink({
  section,
  period,
  clinicId,
  describes,
  endpoint = "/api/reports/revenue",
}: ExportCsvLinkProps) {
  const params = new URLSearchParams({ period, format: "csv", section });

  if (clinicId) {
    params.set("clinicId", clinicId);
  }

  return (
    <a
      href={`${endpoint}?${params.toString()}`}
      aria-label={`Export ${describes} as CSV`}
      className={buttonClasses("secondary", "sm")}
    >
      <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
      Export CSV
    </a>
  );
}
