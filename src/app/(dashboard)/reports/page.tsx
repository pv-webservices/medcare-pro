import { redirect } from "next/navigation";
import BreakdownTable from "@/components/reports/BreakdownTable";
import GrowthChart from "@/components/reports/GrowthChart";
import KpiTiles from "@/components/reports/KpiTiles";
import PeriodSelector from "@/components/reports/PeriodSelector";
import { PermissionError } from "@/lib/rbac";
import { REPORT_PERIOD_LABELS } from "@/lib/reportPeriods";
import {
  DEFAULT_PERIOD,
  getRevenueReport,
  reportFilterSchema,
  type RevenueReport,
} from "@/lib/reports";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Revenue report — PRD §6.6 (FR-6.1 … FR-6.4).
//
// The period comes from the URL; the clinic comes from the sidebar switcher,
// as in every other module (FR-2.3), so there is no second clinic control here
// to disagree with it.
//
// `report:read` is enforced in @/lib/reports, not by hiding this page: Staff do
// not hold it, and reaching this URL directly gets them the same refusal the
// API gives.

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
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Revenue report</h1>
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot view revenue reports. Ask an admin or the account
          owner if you need access.
        </p>
      </section>
    );
  }

  const scopeLabel = report.clinicName ?? "all clinics";
  const periodLabel = REPORT_PERIOD_LABELS[report.period].toLowerCase();

  return (
    <section>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Revenue report</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {report.rangeLabel} · {scopeLabel}
        </p>
      </div>

      <div className="mb-6">
        <PeriodSelector selected={report.period} />
      </div>

      {!report.hasClinics ? (
        <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          No clinics to report on yet. Add a clinic and start registering
          patients — revenue appears here as visits are recorded.
        </p>
      ) : (
        <>
          <div className="mb-8">
            <KpiTiles kpis={report.kpis} period={report.period} />
          </div>

          <section aria-labelledby="growth-heading" className="mb-8">
            <h2 id="growth-heading" className="mb-1 text-lg font-semibold">
              Revenue trend
            </h2>
            <p className="mb-3 text-sm text-black/60 dark:text-white/60">
              {/* Names the single series, which is why the chart has no legend. */}
              Revenue per {periodLabel.replace(/ly$/, "")} period across{" "}
              {scopeLabel}, ending with the current one.
            </p>
            <GrowthChart
              series={report.series}
              caption={`Revenue by ${periodLabel} period across ${scopeLabel}`}
            />
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <BreakdownTable
              title="By clinic"
              entityLabel="Clinic"
              rows={report.byClinic}
              emptyMessage="No revenue recorded in this period."
            />
            <BreakdownTable
              title="By doctor"
              entityLabel="Doctor"
              rows={report.byDoctor}
              emptyMessage="No revenue recorded in this period."
            />
          </div>
        </>
      )}
    </section>
  );
}
