import { Info, Sparkles, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import BreakdownTable from "@/components/reports/BreakdownTable";
import ExportCsvLink from "@/components/reports/ExportCsvLink";
import GrowthChart from "@/components/reports/GrowthChart";
import KpiTiles, { MiniSparkline } from "@/components/reports/KpiTiles";
import PeriodSelector from "@/components/reports/PeriodSelector";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { formatRupees } from "@/lib/money";
import {
  holdsAnywhere,
  permissionsHeldAnywhere,
  PermissionError,
} from "@/lib/rbac";
import { PREVIOUS_PERIOD_LABELS, REPORT_PERIOD_LABELS } from "@/lib/reportPeriods";
import {
  DEFAULT_PERIOD,
  getRevenueReport,
  REPORT_EXPORT_PERMISSION,
  reportFilterSchema,
  type RevenueReport,
} from "@/lib/reports";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// Revenue report — PRD §6.6 (FR-6.1 … FR-6.4).
//
// The period comes from the URL; the clinic comes from the sidebar switcher,
// as in every other module (FR-2.3), so there is no second clinic control here
// to disagree with it.
//
// `report:read` is enforced in @/lib/reports, not by hiding this page: Staff do
// not hold it, and reaching this URL directly gets them the same refusal the
// API gives.
//
// The export controls (Stage 7) need `reports:export` as well, and are simply
// absent without it — a download offered and then refused is worse than no
// download offered. The API re-checks regardless.

interface ReportsPageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.reports);
  if (locked) {
    return <ModuleLocked title="Revenue reports" reason={locked} />;
  }

  const params = await searchParams;
  const requested = Array.isArray(params.period) ? params.period[0] : params.period;
  const selectedClinicId = await resolveSelectedClinicId(actor);

  // An unknown ?period= falls back to the default rather than erroring: a stale
  // bookmark should show a report, not a stack trace.
  const parsed = reportFilterSchema.safeParse({
    period: requested,
    clinicId: selectedClinicId ?? undefined,
  });

  const filters = parsed.success
    ? parsed.data
    : { period: DEFAULT_PERIOD, clinicId: selectedClinicId ?? undefined };

  let report: RevenueReport | null = null;
  try {
    report = await getRevenueReport(actor, filters);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!report) {
    return (
      <section className="space-y-4">
        <PageHeader title="Revenue report" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view revenue reports. Ask an admin or the account
          owner if you need access.
        </div>
      </section>
    );
  }

  const scopeLabel = report.clinicName ?? "all clinics";
  const periodLabel = REPORT_PERIOD_LABELS[report.period].toLowerCase();

  // One query for all three controls, resolved after the report so a role that
  // cannot read reports never pays for it.
  const canExport = holdsAnywhere(
    await permissionsHeldAnywhere(actor),
    REPORT_EXPORT_PERMISSION,
  );

  const againstLabel = PREVIOUS_PERIOD_LABELS[report.period];
  const isUp = (report.kpis.revenueChangePercent ?? 0) >= 0;
  const currentRev = Number(report.kpis.totalRevenue) || 0;
  const prevRev = Number(report.kpis.previousRevenue) || 0;
  const diff = Math.abs(currentRev - prevRev);
  const diffText =
    prevRev === 0 && currentRev === 0
      ? `No revenue recorded ${againstLabel}.`
      : isUp
        ? `You earned ${formatRupees(diff)} more than in ${againstLabel.replace(/^the\s+/i, "")}.`
        : `You earned ${formatRupees(diff)} less than in ${againstLabel.replace(/^the\s+/i, "")}.`;

  const topDoctor = [...report.byDoctor].sort(
    (a, b) => Number(b.revenue) - Number(a.revenue),
  )[0];

  let insightText = `Total revenue stands at ${formatRupees(report.kpis.totalRevenue)} across ${report.kpis.registrationCount} visit${report.kpis.registrationCount === 1 ? "" : "s"}.`;
  if (report.kpis.revenueChangePercent && report.kpis.revenueChangePercent > 0) {
    insightText = `Revenue grew sharply in ${report.rangeLabel}. Keep up the momentum!`;
  } else if (topDoctor && Number(topDoctor.revenue) > 0) {
    insightText = `${topDoctor.name} generated the highest revenue (${formatRupees(topDoctor.revenue)}) this period.`;
  }

  const sparklineValues =
    report.series.length > 0 ? report.series.map((s) => s.value) : [0, currentRev];

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title="Revenue report"
        description="Understand clinic performance and revenue over time."
        meta={report.rangeLabel}
        scope={report.clinicName ?? "All clinics"}
        actions={<PeriodSelector selected={report.period} />}
      />

      {!report.hasClinics ? (
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" strokeWidth={2} />}
          title="Nothing to report on yet"
          guidance="Revenue appears here as visits are recorded against a clinic."
        />
      ) : (
        <>
          {/* Top KPI Cards Row */}
          <KpiTiles
            kpis={report.kpis}
            period={report.period}
            series={report.series}
            byDoctor={report.byDoctor}
          />

          {/* Revenue Trend & Side Cards */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            <div className="lg:col-span-8 xl:col-span-9">
              <GrowthChart
                series={report.series}
                caption={`Revenue per ${periodLabel.replace(/ly$/, "")} period across ${scopeLabel}, ending with the current one.`}
                actions={
                  canExport ? (
                    <ExportCsvLink
                      section="trend"
                      period={report.period}
                      clinicId={selectedClinicId}
                      describes="the revenue trend"
                    />
                  ) : null
                }
              />
            </div>

            {/* Side Analytics Cards */}
            <div className="space-y-6 lg:col-span-4 xl:col-span-3">
              {/* Growth vs last period */}
              <section className="rounded-3xl border border-line bg-canvas p-6 shadow-card flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-label font-semibold text-ink">
                      <span>Growth vs {againstLabel}</span>
                      <Info className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    </div>
                  </div>

                  <div className="mt-3">
                    {report.kpis.revenueChangePercent !== null ? (
                      <p
                        className={`text-2xl font-bold tracking-tight ${
                          isUp ? "text-ok-ink" : "text-alert-ink"
                        }`}
                      >
                        {isUp ? "▲" : "▼"} {Math.abs(report.kpis.revenueChangePercent).toFixed(0)}%
                      </p>
                    ) : (
                      <p className="text-2xl font-bold tracking-tight text-ink">—</p>
                    )}
                    <p className="mt-1 text-label text-muted leading-snug">
                      {diffText}
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-line/40">
                  <MiniSparkline
                    data={sparklineValues}
                    color={isUp ? "#10B981" : "#EF4444"}
                    width={220}
                    height={44}
                  />
                </div>
              </section>

              {/* Operational Insight */}
              <section className="rounded-3xl border border-line bg-canvas p-6 shadow-card">
                <div className="mb-2 flex items-center gap-2 text-accent font-semibold text-label">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Insight</span>
                </div>
                <p className="text-label text-ink-soft leading-relaxed">
                  {insightText}
                </p>
              </section>
            </div>
          </div>

          {/* Breakdown Tables */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownTable
              title="By clinic"
              entityLabel="Clinic"
              rows={report.byClinic}
              emptyMessage="No revenue recorded in this period."
              actions={
                canExport && report.byClinic.length > 0 ? (
                  <ExportCsvLink
                    section="clinics"
                    period={report.period}
                    clinicId={selectedClinicId}
                    describes="revenue by clinic"
                  />
                ) : null
              }
            />

            <BreakdownTable
              title="By doctor"
              entityLabel="Doctor"
              rows={report.byDoctor}
              emptyMessage="No revenue recorded in this period."
              actions={
                canExport && report.byDoctor.length > 0 ? (
                  <ExportCsvLink
                    section="doctors"
                    period={report.period}
                    clinicId={selectedClinicId}
                    describes="revenue by doctor"
                  />
                ) : null
              }
            />
          </div>
        </>
      )}
    </section>
  );
}
