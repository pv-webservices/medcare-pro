import { Activity, Info, UserCheck, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { formatRupees } from "@/lib/money";
import { PREVIOUS_PERIOD_LABELS, type ReportPeriod } from "@/lib/reportPeriods";
import type { BreakdownRow, RevenueKpis, RevenuePoint } from "@/lib/reports";

interface KpiTilesProps {
  kpis: RevenueKpis;
  period: ReportPeriod;
  series?: readonly RevenuePoint[];
  byDoctor?: readonly BreakdownRow[];
}

export function MiniSparkline({
  data,
  color,
  width = 80,
  height = 34,
}: {
  data: readonly number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 3;
  const plotHeight = height - padding * 2;
  const plotWidth = width - padding * 2;

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * plotWidth;
    const y = padding + plotHeight - ((val - min) / range) * plotHeight;
    return { x, y };
  });

  const pathD = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={3}
        fill={color}
      />
    </svg>
  );
}

interface TileProps {
  label: string;
  value: string;
  icon: ReactNode;
  iconBg: string;
  delta: ReactNode;
  sparklineData: readonly number[];
  sparklineColor: string;
}

function Tile({
  label,
  value,
  icon,
  iconBg,
  delta,
  sparklineData,
  sparklineColor,
}: TileProps) {
  return (
    <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card flex flex-col justify-between transition-shadow duration-150 hover:shadow-md">
      <div className="flex items-start gap-3.5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-label font-medium text-muted">
            <span className="truncate">{label}</span>
            <Info className="h-3.5 w-3.5 text-muted/60 shrink-0" aria-hidden="true" />
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink truncate">
            {value}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 pt-1 border-t border-line/40">
        <div className="min-w-0 flex-1">{delta}</div>
        <div className="shrink-0">
          <MiniSparkline data={sparklineData} color={sparklineColor} />
        </div>
      </div>
    </div>
  );
}

function DeltaPill({
  changePercent,
  previousRevenue,
  period,
}: {
  changePercent: number | null;
  previousRevenue?: string;
  period: ReportPeriod;
}) {
  const against = PREVIOUS_PERIOD_LABELS[period];

  if (changePercent === null) {
    return (
      <p className="text-micro font-medium text-muted">
        {previousRevenue && Number(previousRevenue) > 0
          ? `vs ${against}`
          : `No prior ${against}`}
      </p>
    );
  }

  const isUp = changePercent >= 0;
  const rounded = Math.abs(changePercent).toFixed(0);

  return (
    <p className="text-micro font-medium flex items-center gap-1.5 flex-wrap">
      <span className="text-muted">vs {against}</span>
      <span
        className={`inline-flex items-center gap-0.5 font-semibold ${
          isUp ? "text-ok-ink" : "text-alert-ink"
        }`}
      >
        {isUp ? "▲" : "▼"} {rounded}%
      </span>
    </p>
  );
}

export default function KpiTiles({
  kpis,
  period,
  series = [],
  byDoctor = [],
}: KpiTilesProps) {
  // Compute registration growth
  const regCurrent =
    series.length > 0
      ? series[series.length - 1].registrations
      : kpis.registrationCount;
  const regPrior =
    series.length >= 2 ? series[series.length - 2].registrations : 0;
  const regGrowth =
    regPrior > 0
      ? ((regCurrent - regPrior) / regPrior) * 100
      : regCurrent > 0
        ? 100
        : null;

  // Active doctors count (doctors with recorded registrations in this window)
  const activeDoctors = byDoctor.filter((d) => d.registrations > 0).length || byDoctor.length;

  const revenueSparkData =
    series.length > 0 ? series.map((s) => s.value) : [0, Number(kpis.totalRevenue) || 0];
  const regSparkData =
    series.length > 0
      ? series.map((s) => s.registrations)
      : [0, kpis.registrationCount || 0];
  const avgSparkData =
    series.length > 0
      ? series.map((s) => (s.registrations > 0 ? s.value / s.registrations : 0))
      : [0, Number(kpis.averageRevenuePerPatient) || 0];
  const docSparkData =
    series.length > 0
      ? series.map((s, idx) => (s.registrations > 0 ? Math.min(activeDoctors, idx + 1) : 0))
      : [0, activeDoctors || 0];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Total revenue"
        value={formatRupees(kpis.totalRevenue)}
        icon={<Wallet className="h-5 w-5" strokeWidth={2} />}
        iconBg="bg-[#EEF2FF] text-[#4F46E5]"
        delta={
          <DeltaPill
            changePercent={kpis.revenueChangePercent}
            previousRevenue={kpis.previousRevenue}
            period={period}
          />
        }
        sparklineData={revenueSparkData}
        sparklineColor="#4F46E5"
      />

      <Tile
        label="Registrations"
        value={String(kpis.registrationCount)}
        icon={<Users className="h-5 w-5" strokeWidth={2} />}
        iconBg="bg-[#ECFDF5] text-[#10B981]"
        delta={<DeltaPill changePercent={regGrowth} period={period} />}
        sparklineData={regSparkData}
        sparklineColor="#10B981"
      />

      <Tile
        label="Avg. revenue per patient"
        value={formatRupees(kpis.averageRevenuePerPatient)}
        icon={<UserCheck className="h-5 w-5" strokeWidth={2} />}
        iconBg="bg-[#EFF6FF] text-[#3B82F6]"
        delta={
          <DeltaPill
            changePercent={kpis.revenueChangePercent}
            previousRevenue={kpis.previousRevenue}
            period={period}
          />
        }
        sparklineData={avgSparkData}
        sparklineColor="#3B82F6"
      />

      <Tile
        label="Active doctors"
        value={String(activeDoctors)}
        icon={<Activity className="h-5 w-5" strokeWidth={2} />}
        iconBg="bg-[#FFF7ED] text-[#F97316]"
        delta={
          <DeltaPill
            changePercent={activeDoctors > 0 ? 100 : null}
            period={period}
          />
        }
        sparklineData={docSparkData}
        sparklineColor="#F97316"
      />
    </div>
  );
}
