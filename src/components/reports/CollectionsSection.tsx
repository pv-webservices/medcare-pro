import { BadgePercent, Clock, HandCoins, Info, Landmark, Receipt } from "lucide-react";
import BreakdownTable from "@/components/reports/BreakdownTable";
import ExportCsvLink from "@/components/reports/ExportCsvLink";
import GrowthChart from "@/components/reports/GrowthChart";
import { Tile } from "@/components/reports/KpiTiles";
import type { CollectionsReport } from "@/lib/billing/collectionsReport";
import { formatRupees } from "@/lib/money";
import { PREVIOUS_PERIOD_LABELS, REPORT_PERIOD_LABELS } from "@/lib/reportPeriods";

/**
 * The Billing section of /reports — FR-11.23. Rendered only for an actor the
 * collections report admits (report:read AND invoice:read, billing enabled);
 * the page drops it on refusal, and the API re-checks for every download.
 *
 * GrowthChart plots one series, so Billed and Collected are two charts side by
 * side, stacked on a phone, each titled through GrowthChart's own heading.
 */

const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function Change({ current, previous, against }: { current: string; previous: string; against: string }) {
  const before = Number(previous);
  // Change from nothing is not a percentage.
  if (!before) return <p className="text-micro font-medium text-muted">Nothing {against}</p>;
  const change = ((Number(current) - before) / before) * 100;
  return <p className="flex flex-wrap items-center gap-1.5 text-micro font-medium">
    <span className="text-muted">vs {against}</span>
    <span className={change >= 0 ? "font-semibold text-ok-ink" : "font-semibold text-alert-ink"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%</span>
  </p>;
}
const note = (text: string) => <p className="text-micro font-medium text-muted">{text}</p>;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default function CollectionsSection({ report, canExport, clinicId }: {
  report: CollectionsReport;
  canExport: boolean;
  /** The sidebar switcher's clinic, so an export matches the screen. */
  clinicId: string | null;
}) {
  const { kpis } = report;
  const against = PREVIOUS_PERIOD_LABELS[report.period];
  const unit = REPORT_PERIOD_LABELS[report.period].toLowerCase().replace(/ly$/, "").replace(/^dai$/, "day");
  const scope = report.clinicName ?? "all clinics";
  const exportLink = (section: "trend" | "modes" | "clinics", describes: string) => canExport
    ? <ExportCsvLink endpoint="/api/reports/collections" section={section} period={report.period} clinicId={clinicId} describes={describes} />
    : null;

  return <section aria-labelledby="billing-report-title" className="space-y-6">
    <div className="space-y-2 border-t border-line pt-6">
      <h2 id="billing-report-title" className="text-section font-semibold text-ink">Billing</h2>
      <p className="text-label text-muted">Bills and payments for {report.rangeLabel} across {scope}.</p>
      <p role="note" className="flex items-center gap-2 rounded-2xl border border-line bg-canvas-deep px-4 py-3 text-label text-ink">
        <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        Revenue is by visit date. Collections are by payment date.
      </p>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      <Tile label="Billed" value={formatRupees(kpis.billed)} icon={<Receipt className="h-5 w-5" strokeWidth={2} />} iconBg="bg-[#EEF2FF] text-[#4F46E5]"
        delta={<Change current={kpis.billed} previous={kpis.previousBilled} against={against} />}
        sparklineData={report.billedSeries.map((point) => point.value)} sparklineColor="#4F46E5" />
      <Tile label="Collected" value={formatRupees(kpis.collected)} icon={<HandCoins className="h-5 w-5" strokeWidth={2} />} iconBg="bg-[#ECFDF5] text-[#10B981]"
        delta={<Change current={kpis.collected} previous={kpis.previousCollected} against={against} />}
        sparklineData={report.collectedSeries.map((point) => point.value)} sparklineColor="#10B981" />
      <Tile label="Outstanding now" value={formatRupees(kpis.outstanding)} icon={<Clock className="h-5 w-5" strokeWidth={2} />} iconBg="bg-[#FFF7ED] text-[#F97316]"
        delta={note(`${plural(kpis.outstandingCount, "bill", "bills")} owing · as of ${IST_TIME.format(new Date(report.asOf))}`)} />
      <Tile label="Discounts given" value={formatRupees(kpis.discounts)} icon={<BadgePercent className="h-5 w-5" strokeWidth={2} />} iconBg="bg-[#EFF6FF] text-[#3B82F6]"
        delta={note(`On ${plural(kpis.billCount, "issued bill", "issued bills")}`)} />
      <Tile label="GST" value={formatRupees(kpis.gst)} icon={<Landmark className="h-5 w-5" strokeWidth={2} />} iconBg="bg-[#F5F3FF] text-[#7C3AED]"
        delta={note(`CGST ${formatRupees(kpis.cgst)} · SGST ${formatRupees(kpis.sgst)}`)} />
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <GrowthChart series={report.billedSeries} title="Billed" legend="Billed"
        caption={`Billed per ${unit} by issue date across ${scope}; cancelled bills excluded. Registrations are visits billed.`}
        actions={exportLink("trend", "the billed and collected trend")} />
      <GrowthChart series={report.collectedSeries} title="Collected" legend="Collected"
        caption={`Collected per ${unit} by payment date across ${scope}; voided payments excluded. Registrations are visits paid for.`} />
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <BreakdownTable title="Collected by payment mode" entityLabel="Payment mode" rows={report.byPaymentMode}
        countLabel="Payments" amountLabel="Collected" emptyMessage="No payments recorded in this period."
        actions={report.byPaymentMode.length > 0 ? exportLink("modes", "collections by payment mode") : null} />
      <BreakdownTable title="Collected by clinic" entityLabel="Clinic" rows={report.byClinic}
        countLabel="Payments" amountLabel="Collected" emptyMessage="No clinics in scope."
        actions={report.byClinic.length > 0 ? exportLink("clinics", "billing figures by clinic") : null} />
    </div>
  </section>;
}
