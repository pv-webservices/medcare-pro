import { formatRupees } from "@/lib/money";
import { PREVIOUS_PERIOD_LABELS, type ReportPeriod } from "@/lib/reportPeriods";
import type { RevenueKpis } from "@/lib/reports";
import Card from "@/components/ui/Card";

/**
 * The report's headline numbers — PRD §6.6 (FR-6.2).
 *
 * Stat tiles, not a chart: four single values have no shape to plot, and a
 * four-bar bar chart of unrelated units would be worse than the numbers.
 *
 * Values use proportional figures on purpose. `tabular-nums` gives every digit
 * the width of a zero, which makes a large standalone number look gappy; it is
 * kept for columns that have to align vertically, which these do not.
 */

interface KpiTilesProps {
  kpis: RevenueKpis;
  period: ReportPeriod;
}

interface TileProps {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}

function Tile({ label, value, hint, children }: TileProps) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      {children}
      {hint && (
        <p className="mt-2 text-xs text-slate-400">{hint}</p>
      )}
    </Card>
  );
}

/**
 * The change against the previous equivalent period.
 *
 * More revenue is good, so up is green and down is red — the arrow and the sign
 * carry the direction too, since colour alone is not an accessible channel.
 */
function RevenueDelta({
  changePercent,
  previousRevenue,
  period,
}: {
  changePercent: number | null;
  previousRevenue: string;
  period: ReportPeriod;
}) {
  const against = PREVIOUS_PERIOD_LABELS[period];

  if (changePercent === null) {
    return (
      <p className="mt-2 text-xs font-medium text-slate-500">
        {/* Growth from zero is not a percentage — say what happened instead. */}
        {Number(previousRevenue) === 0
          ? `No revenue ${against}`
          : `Compared with ${formatRupees(previousRevenue)} ${against}`}
      </p>
    );
  }

  const isUp = changePercent >= 0;
  const rounded = Math.abs(changePercent).toFixed(1);

  return (
    <p className="mt-2 text-xs font-medium">
      <span
        className={
          isUp
            ? "text-emerald-600"
            : "text-red-600"
        }
      >
        {isUp ? "▲" : "▼"} {rounded}%
      </span>{" "}
      <span className="text-slate-400 ml-1">vs {against}</span>
    </p>
  );
}

export default function KpiTiles({ kpis, period }: KpiTilesProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Total revenue" value={formatRupees(kpis.totalRevenue)}>
        <RevenueDelta
          changePercent={kpis.revenueChangePercent}
          previousRevenue={kpis.previousRevenue}
          period={period}
        />
      </Tile>

      <Tile
        label="Registrations"
        value={String(kpis.registrationCount)}
        hint="Visits recorded in this period"
      />

      <Tile
        label="Patients seen"
        value={String(kpis.patientCount)}
        hint="Distinct people — a follow-up is not a second patient"
      />

      <Tile
        label="Avg. revenue per patient"
        value={formatRupees(kpis.averageRevenuePerPatient)}
        hint="Total revenue ÷ patients seen"
      />
    </div>
  );
}
