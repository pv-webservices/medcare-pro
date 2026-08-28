import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  IndianRupee,
  Stethoscope,
  Users,
} from "lucide-react";
import AreaChart, { type AreaPoint } from "@/components/dashboard/AreaChart";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import {
  Avatar,
  MetricCard,
  PageHeader,
  Panel,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  cx,
} from "@/components/ui";
import {
  comparisonLabel,
  parsePreset,
  presetRange,
  trendInterval,
} from "@/lib/dashboardDateRange";
import { getAccountDashboardData, type DashboardData } from "@/lib/dashboard";
import { formatRupees, formatRupeesCompact } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const skip = new Set(["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms."]);
  const first = words.find((w) => !skip.has(w.toLowerCase()));
  return first ?? name;
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg text-label font-medium text-accent transition-colors duration-150 hover:text-accent-strong"
    >
      {label}
      <ArrowRight aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
    </Link>
  );
}

function formatDelta(change: number | null): number | undefined {
  if (change === null) return undefined;
  return Math.round(change * 10) / 10;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function thinLabels(
  points: readonly { label: string; value: number }[],
  maxTicks: number,
): AreaPoint[] {
  if (points.length <= maxTicks) {
    return points.map((p) => ({ label: p.label, value: p.value }));
  }
  const step = Math.ceil(points.length / maxTicks);
  return points.map((p, i) => ({
    label: i % step === 0 || i === points.length - 1 ? p.label : "",
    value: p.value,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DashboardPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const preset = parsePreset(
    typeof params.range === "string" ? params.range : undefined,
  );

  const actor = await requireActor();
  const selectedClinicId = await resolveSelectedClinicId(actor);

  const now = new Date();
  const range = presetRange(preset, now);
  const interval = trendInterval(preset);
  const deltaCaption = comparisonLabel(preset);

  const [user, clinic, data] = await Promise.all([
    prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    }),
    selectedClinicId
      ? prisma.clinic.findFirst({
          where: { id: selectedClinicId, tenantId: actor.tenantId },
          select: { name: true },
        })
      : Promise.resolve(null),
    getAccountDashboardData(actor, selectedClinicId, preset, range, interval, now),
  ]);

  const greeting = greetingFor(now.getHours());
  const name = firstNameOf(user?.name ?? "there");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${greeting}, ${name}`}
        description="Your account performance at a glance."
        scope={clinic?.name ?? "All clinics"}
        actions={
          <Suspense>
            <DateRangePicker current={preset} />
          </Suspense>
        }
      />

      {/* --- KPI row ------------------------------------------------------ */}
      <KpiRow data={data} deltaCaption={deltaCaption} />

      {/* --- Trend + today ------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <TrendPanel data={data} preset={preset} />
        <TodayPanel data={data} />
      </div>

      {/* --- Clinic + doctor performance ---------------------------------- */}
      {data.clinicPerformance.length > 0 && (
        <ClinicPerformancePanel rows={data.clinicPerformance} />
      )}
      <DoctorPerformancePanel rows={data.doctorPerformance} />

      {/* --- Attention + recent activity ---------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <RecentActivityPanel rows={data.recentActivity} />
        <AttentionPanel items={data.attentionItems} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Row
// ---------------------------------------------------------------------------

function KpiRow({
  data,
  deltaCaption,
}: {
  data: DashboardData;
  deltaCaption: string;
}) {
  const { summary } = data;

  const kpis = [
    {
      label: "Total revenue",
      value: formatRupees(summary.revenue.current),
      delta: formatDelta(summary.revenue.change),
      icon: IndianRupee,
      isUpGood: true,
    },
    {
      label: "Registrations",
      value: summary.registrations.current.toLocaleString("en-IN"),
      delta: formatDelta(summary.registrations.change),
      icon: Users,
      isUpGood: true,
    },
    {
      label: "Appointments",
      value: summary.appointments.current.toLocaleString("en-IN"),
      delta: formatDelta(summary.appointments.change),
      icon: CalendarDays,
      isUpGood: true,
    },
    {
      label: "Active doctors",
      value: summary.activeDoctors.toLocaleString("en-IN"),
      icon: Stethoscope,
      isUpGood: true,
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <MetricCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            delta={"delta" in kpi ? kpi.delta : undefined}
            isUpGood={kpi.isUpGood}
            deltaCaption={
              "delta" in kpi && kpi.delta !== undefined
                ? deltaCaption
                : undefined
            }
            icon={<Icon strokeWidth={2} className="h-[18px] w-[18px]" />}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend panel
// ---------------------------------------------------------------------------

function TrendPanel({
  data,
  preset,
}: {
  data: DashboardData;
  preset: string;
}) {
  const revenuePoints = thinLabels(
    data.trend.map((t) => ({ label: t.label, value: t.revenue })),
    10,
  );

  const hasData = data.trend.some((t) => t.revenue > 0 || t.registrations > 0);

  return (
    <Panel
      title="Revenue trend"
      description="Revenue over the selected period"
      className="xl:col-span-2"
      actions={
        <span className="rounded-full border border-line bg-canvas-deep px-2.5 py-1 text-meta font-medium text-muted">
          {preset === "thisYear" ? "Monthly" : "Daily"}
        </span>
      }
    >
      {hasData ? (
        <AreaChart
          points={revenuePoints}
          caption="Revenue trend over the selected period."
        />
      ) : (
        <div className="flex h-56 items-center justify-center text-body text-muted">
          No revenue recorded in this period.
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Today panel
// ---------------------------------------------------------------------------

function TodayPanel({ data }: { data: DashboardData }) {
  const { today } = data;
  const items = [
    { label: "Appointments", value: today.appointments },
    { label: "Registrations", value: today.registrations },
    { label: "Completed", value: today.completedAppointments },
    { label: "Cancelled", value: today.cancelledAppointments },
  ];

  return (
    <Panel title="Today" description="Current operational snapshot">
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between">
            <span className="text-body text-muted">{item.label}</span>
            <span className="tnum text-body font-semibold text-ink">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Clinic performance
// ---------------------------------------------------------------------------

function ClinicPerformancePanel({
  rows,
}: {
  rows: DashboardData["clinicPerformance"];
}) {
  return (
    <Panel
      title="Clinic performance"
      description="Revenue and activity across your clinics"
      isFlush
      hasDivider
    >
      <Table
        caption="Clinic performance comparison"
        className="rounded-none border-0 shadow-none"
      >
        <THead>
          <TH>Clinic</TH>
          <TH align="end">Revenue</TH>
          <TH align="end">Registrations</TH>
          <TH align="end">Appointments</TH>
          <TH align="end">Doctors</TH>
          <TH align="end">Growth</TH>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.clinicId}>
              <TD isPrimary>{row.clinicName}</TD>
              <TD align="end" className="tnum">
                {formatRupeesCompact(row.revenue)}
              </TD>
              <TD align="end" className="tnum">
                {row.registrations.toLocaleString("en-IN")}
              </TD>
              <TD align="end" className="tnum">
                {row.appointments.toLocaleString("en-IN")}
              </TD>
              <TD align="end" className="tnum">
                {row.doctors}
              </TD>
              <TD align="end">
                {row.revenueChange !== null ? (
                  <span
                    className={cx(
                      "tnum font-semibold",
                      row.revenueChange >= 0
                        ? "text-ok-ink"
                        : "text-alert-ink",
                    )}
                  >
                    {row.revenueChange >= 0 ? "+" : ""}
                    {Math.round(row.revenueChange * 10) / 10}%
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Doctor performance
// ---------------------------------------------------------------------------

function DoctorPerformancePanel({
  rows,
}: {
  rows: DashboardData["doctorPerformance"];
}) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Top doctors"
        description="By registrations in this period"
        actions={<ViewAll href="/doctors" label="All doctors" />}
      >
        <div className="flex h-24 items-center justify-center text-body text-muted">
          No doctor activity in this period.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Top doctors"
      description="By registrations in this period"
      isFlush
      hasDivider
      actions={<ViewAll href="/doctors" label="All doctors" />}
    >
      <Table
        caption="Top doctors by registrations"
        className="rounded-none border-0 shadow-none"
      >
        <THead>
          <TH>Doctor</TH>
          <TH>Clinic</TH>
          <TH align="end">Registrations</TH>
          <TH align="end">Revenue</TH>
        </THead>
        <TBody>
          {rows.map((row, i) => (
            <TR key={row.doctorId ?? i}>
              <TD isPrimary>
                <span className="flex items-center gap-2.5">
                  <Avatar name={row.doctorName} size="sm" />
                  {row.doctorName}
                </span>
              </TD>
              <TD>{row.clinicName}</TD>
              <TD align="end" className="tnum">
                {row.registrations.toLocaleString("en-IN")}
              </TD>
              <TD align="end" className="tnum">
                {formatRupeesCompact(row.revenue)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function RecentActivityPanel({
  rows,
}: {
  rows: DashboardData["recentActivity"];
}) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Recent activity"
        description="Latest registrations and appointments"
        className="xl:col-span-2"
      >
        <div className="flex h-24 items-center justify-center text-body text-muted">
          No recent activity.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Recent activity"
      description="Latest registrations and appointments"
      className="xl:col-span-2"
    >
      <ul className="flex flex-col">
        {rows.map((row, i) => (
          <li
            key={i}
            className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0 last:pb-0 first:pt-0"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink">
              <Activity
                aria-hidden="true"
                strokeWidth={2}
                className="h-4 w-4"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">
                <span className="font-medium">{row.actor}</span>{" "}
                {row.action}{" "}
                <span className="font-medium">{row.subject}</span>
              </p>
              <p className="mt-0.5 text-meta text-muted">
                {relativeTime(row.timestamp)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Attention required
// ---------------------------------------------------------------------------

function AttentionPanel({
  items,
}: {
  items: DashboardData["attentionItems"];
}) {
  if (items.length === 0) {
    return (
      <Panel title="Attention required" description="Issues to review">
        <div className="flex h-24 items-center justify-center text-body text-muted">
          Nothing requires attention right now.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Attention required" description="Issues to review">
      <ul className="flex flex-col gap-3.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-soft-ink">
              <AlertTriangle
                aria-hidden="true"
                strokeWidth={2}
                className="h-3.5 w-3.5"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">{item.message}</p>
              {item.href && (
                <Link
                  href={item.href}
                  className="mt-1 inline-flex items-center gap-1 text-meta font-medium text-accent hover:text-accent-strong"
                >
                  View
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={2}
                    className="h-3 w-3"
                  />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
