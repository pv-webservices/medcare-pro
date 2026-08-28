import { TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import BreakdownTable from "@/components/reports/BreakdownTable";
import ExportCsvLink from "@/components/reports/ExportCsvLink";
import GrowthChart from "@/components/reports/GrowthChart";
import KpiTiles from "@/components/reports/KpiTiles";
import PeriodSelector from "@/components/reports/PeriodSelector";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import {
  holdsAnywhere,
  permissionsHeldAnywhere,
  PermissionError,
} from "@/lib/rbac";
import { REPORT_PERIOD_LABELS } from "@/lib/reportPeriods";
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

  return (
    <section className="space-y-4">
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
          <KpiTiles kpis={report.kpis} period={report.period} />

          <section aria-labelledby="growth-heading">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="growth-heading"
                  className="text-heading font-semibold text-ink"
                >
                  Revenue trend
                </h2>
                <p className="mt-1 text-body text-muted">
                  {/* Names the single series, which is why the chart has no legend. */}
                  Revenue per {periodLabel.replace(/ly$/, "")} period across{""}
                  {scopeLabel}, ending with the current one.
                </p>
              </div>
              {canExport && (
                <ExportCsvLink
                  section="trend"
                  period={report.period}
                  clinicId={selectedClinicId}
                  describes="the revenue trend"
                />
              )}
            </div>
            <GrowthChart
              series={report.series}
              caption={`Revenue by ${periodLabel} period across ${scopeLabel}`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
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
