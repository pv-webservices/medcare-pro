import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Layers,
  PauseCircle,
  ScrollText,
  ToggleLeft,
  Users,
  XCircle,
} from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getPlatformOverview } from "@/lib/platform/overview";
import { listClinicApplications } from "@/lib/platform/applications";
import { getPlanAdmin } from "@/lib/platform/entitlements";
import type { TenantStatus } from "@prisma/client";

function ShieldPulseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M8.5 12h2l1.5-3 2 6 1.5-3h2" />
    </svg>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "CL";
}

function formatShortTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 60) return `${Math.max(1, diffMinutes)}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

const STATUS_BADGE_CONFIG: Record<
  TenantStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Awaiting approval",
    className: "border-violet-500/30 bg-violet-950/60 text-violet-300",
  },
  ACTIVE: {
    label: "Active",
    className: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "border-blue-500/30 bg-blue-950/60 text-blue-300",
  },
  REJECTED: {
    label: "Rejected",
    className: "border-rose-500/30 bg-rose-950/60 text-rose-300",
  },
  ARCHIVED: {
    label: "Archived",
    className: "border-slate-700/60 bg-slate-900/60 text-slate-400",
  },
};

const PLAN_PALETTE = [
  { stroke: "#818cf8", dotClass: "bg-indigo-400", barClass: "bg-indigo-500" },
  { stroke: "#38bdf8", dotClass: "bg-sky-400", barClass: "bg-sky-500" },
  { stroke: "#34d399", dotClass: "bg-emerald-400", barClass: "bg-emerald-500" },
  { stroke: "#fbbf24", dotClass: "bg-amber-400", barClass: "bg-amber-500" },
  { stroke: "#c084fc", dotClass: "bg-purple-400", barClass: "bg-purple-500" },
];

/**
 * Platform Owner dashboard — Stage 2, extended in Stage 3.
 */
export default async function OwnerDashboardPage() {
  const owner = await requireOwnerPage();

  const [overview, applicationsData, plansData] = await Promise.all([
    getPlatformOverview(owner),
    listClinicApplications(owner, { page: 1 }),
    getPlanAdmin(owner),
  ]);

  const total = overview.totalCustomerTenants;

  const kpis = [
    {
      label: "Awaiting approval",
      value: overview.tenants.PENDING,
      status: "PENDING" as const,
      icon: Clock,
      tileClass: "border-violet-500/30 bg-violet-950/60 text-violet-400",
      dotClass: "bg-violet-400",
      cardGlow: "from-violet-500/5",
    },
    {
      label: "Active",
      value: overview.tenants.ACTIVE,
      status: "ACTIVE" as const,
      icon: Users,
      tileClass: "border-emerald-500/30 bg-emerald-950/60 text-emerald-400",
      dotClass: "bg-emerald-400",
      cardGlow: "from-emerald-500/5",
    },
    {
      label: "Suspended",
      value: overview.tenants.SUSPENDED,
      status: "SUSPENDED" as const,
      icon: PauseCircle,
      tileClass: "border-blue-500/30 bg-blue-950/60 text-blue-400",
      dotClass: "bg-blue-400",
      cardGlow: "from-blue-500/5",
    },
    {
      label: "Rejected",
      value: overview.tenants.REJECTED,
      status: "REJECTED" as const,
      icon: XCircle,
      tileClass: "border-rose-500/30 bg-rose-950/60 text-rose-400",
      dotClass: "bg-rose-400",
      cardGlow: "from-rose-500/5",
    },
  ];

  const recentApplications = applicationsData.applications.slice(0, 5);

  // Calculate plan distribution for Donut Chart with immutable prior offset
  const circumference = 2 * Math.PI * 40; // ~251.327
  const planDistribution = plansData.map((plan, idx) => {
    const palette = PLAN_PALETTE[idx % PLAN_PALETTE.length] ?? PLAN_PALETTE[0];
    const fraction = total > 0 ? plan.tenantCount / total : 0;
    const percentage = total > 0 ? Math.round(fraction * 100) : 0;
    const priorFractions = plansData
      .slice(0, idx)
      .reduce((sum, p) => sum + (total > 0 ? p.tenantCount / total : 0), 0);
    const strokeDasharray = `${fraction * circumference} ${circumference}`;
    const strokeDashoffset = -priorFractions * circumference;

    return {
      name: plan.name,
      count: plan.tenantCount,
      percentage,
      stroke: palette.stroke,
      dotClass: palette.dotClass,
      barClass: palette.barClass,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-600/30 border border-indigo-500/30 text-indigo-400 shadow-md shadow-indigo-500/10">
            <ShieldPulseIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Platform overview
            </h1>
            <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
              <span className="font-semibold text-slate-300">{total}</span> clinic organisation
              {total === 1 ? "" : "s"} on the platform
            </p>
          </div>
        </div>

        <div>
          <Link
            href="/owner/applications?status=PENDING"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99]"
          >
            <span>Review clinic applications</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const percentage = total > 0 ? Math.round((kpi.value / total) * 100) : 0;

          return (
            <Link
              key={kpi.label}
              href={`/owner/applications?status=${kpi.status}`}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700"
            >
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-b ${kpi.cardGlow} to-transparent blur-xl`}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${kpi.tileClass} shadow-sm transition-transform duration-150 group-hover:scale-105`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold tabular-nums text-white">
                    {kpi.value}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-400" />
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-300">
                  {kpi.label}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className={`h-2 w-2 rounded-full ${kpi.dotClass}`} />
                  <span>{percentage}% of total</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Management Navigation Cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {/* Platform Features */}
        <Link
          href="/owner/features"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400 shadow-sm transition-transform duration-150 group-hover:scale-105">
              <ToggleLeft className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm sm:text-base font-semibold text-white">
              Platform features
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Switch a feature off for every organisation at once. Layer 1.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 transition-colors group-hover:text-indigo-300">
            <span>Manage features</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Plans */}
        <Link
          href="/owner/plans"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-950/60 text-blue-400 shadow-sm transition-transform duration-150 group-hover:scale-105">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm sm:text-base font-semibold text-white">
              Plans
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              What each plan includes, and who follows it. Layer 2.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 transition-colors group-hover:text-indigo-300">
            <span>Manage plans</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* Activity Log */}
        <Link
          href="/owner/audit"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-950/60 text-purple-400 shadow-sm transition-transform duration-150 group-hover:scale-105">
              <ScrollText className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm sm:text-base font-semibold text-white">
              Activity log
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Every decision taken on the platform. Append-only, exportable.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 transition-colors group-hover:text-indigo-300">
            <span>View activity log</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </div>
        </Link>
      </div>

      {/* Lower Analytics Section: Real Recent Applications & Real Plan Distribution */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Recent Clinic Applications */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <h2 className="text-sm sm:text-base font-semibold text-white">
                Recent clinic applications
              </h2>
              <Link
                href="/owner/applications"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
              >
                <span>View all</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {recentApplications.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No clinic applications received yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50 mt-1">
                {recentApplications.map((app) => {
                  const badge =
                    STATUS_BADGE_CONFIG[app.status] || STATUS_BADGE_CONFIG.PENDING;
                  return (
                    <Link
                      key={app.id}
                      href={`/owner/applications/${app.id}`}
                      className="group flex items-center justify-between gap-3 py-3 transition-colors hover:bg-slate-800/30 px-2 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-950/60 text-xs font-bold text-indigo-300">
                          {getInitials(app.clinicName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs sm:text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">
                            {app.clinicName}
                          </div>
                          <div className="truncate text-[11px] text-slate-400">
                            {app.city || app.email}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {formatShortTimeAgo(app.createdAt)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {applicationsData.total > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-800/50 text-center text-xs text-slate-500">
              Showing {recentApplications.length} of {applicationsData.total}
            </div>
          )}
        </div>

        {/* Real Plan Distribution */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <h2 className="text-sm sm:text-base font-semibold text-white">
                Plan distribution
              </h2>
              <Link
                href="/owner/plans"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
              >
                <span>View plans</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-5 flex flex-col gap-6 items-center">
              {/* SVG Donut Chart */}
              <div className="relative mx-auto flex h-36 w-36 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                  {/* Background Track */}
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#182240"
                    strokeWidth="14"
                    fill="none"
                  />
                  {/* Plan Segments */}
                  {total > 0 &&
                    planDistribution.map((item, idx) => (
                      <circle
                        key={idx}
                        cx="50"
                        cy="50"
                        r="38"
                        stroke={item.stroke}
                        strokeWidth="14"
                        strokeDasharray={item.strokeDasharray}
                        strokeDashoffset={item.strokeDashoffset}
                        fill="none"
                        strokeLinecap="round"
                      />
                    ))}
                </svg>

                {/* Center Content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-2xl font-bold text-white tabular-nums">
                    {total}
                  </span>
                  <span className="text-[10px] text-slate-400">Total clinics</span>
                </div>
              </div>

              {/* Breakdown Legend Table */}
              <div className="w-full space-y-3.5">
                {planDistribution.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No plans configured yet.
                  </div>
                ) : (
                  planDistribution.map((item, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${item.dotClass}`} />
                          <span className="font-medium text-slate-200">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-slate-400 font-medium">{item.count}</span>
                          <span className="w-9 text-right font-semibold text-white">
                            {item.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-800/80 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${item.barClass}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

