import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Home,
  Layers,
  Mail,
  MapPin,
  PauseCircle,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getClinicApplication } from "@/lib/platform/applications";
import { describeAuditAction } from "@/lib/auditDescriptions";
import DecisionPanel from "@/components/owner/DecisionPanel";
import type { TenantStatus } from "@prisma/client";
import { cx } from "@/components/ui";

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_BADGES: Record<
  TenantStatus,
  { bg: string; text: string; border: string; label: string }
> = {
  PENDING: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    label: "Awaiting approval",
  },
  ACTIVE: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    label: "Active",
  },
  SUSPENDED: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
    label: "Suspended",
  },
  REJECTED: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
    label: "Rejected",
  },
  ARCHIVED: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
    label: "Archived",
  },
};

function formatDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function formatDateTime(date: Date): string {
  const months = [
    "Aug",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const m = months[date.getUTCMonth()];
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  let hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const h = String(hours).padStart(2, "0");
  return `${m} ${d}, ${y}\n${h}:${minutes}:${seconds} ${ampm}`;
}

function getTimelineMarker(action: string) {
  if (
    action.includes("APPROV") ||
    action.includes("ACTIVE") ||
    action.includes("REACTIVAT")
  ) {
    return {
      dotClass: "border-emerald-500/50 bg-emerald-950/90 text-emerald-400",
      icon: CheckCircle2,
    };
  }
  if (
    action.includes("ENTITLEMENT") ||
    action.includes("PLAN") ||
    action.includes("FEATURE") ||
    action.includes("SUSPEND")
  ) {
    return {
      dotClass: "border-amber-500/50 bg-amber-950/90 text-amber-400",
      icon: PauseCircle,
    };
  }
  if (
    action.includes("REJECT") ||
    action.includes("DENY") ||
    action.includes("FAIL")
  ) {
    return {
      dotClass: "border-rose-500/50 bg-rose-950/90 text-rose-400",
      icon: XCircle,
    };
  }
  return {
    dotClass: "border-indigo-500/50 bg-indigo-950/90 text-indigo-400",
    icon: CheckCircle2,
  };
}

export default async function OwnerApplicationDetailPage({ params }: PageProps) {
  const owner = await requireOwnerPage();
  const { id } = await params;

  const application = await getClinicApplication(owner, id);
  if (!application) {
    notFound();
  }

  const badge = STATUS_BADGES[application.status];

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6 text-white font-sans">
      {/* Breadcrumb & Top Navigation */}
      <div>
        <Link
          href={`/owner/applications?status=${application.status}`}
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to applications</span>
        </Link>

        {/* Page Header */}
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                {application.clinicName}
              </h1>
              <span
                className={cx(
                  "rounded-md border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                  badge.bg,
                  badge.text,
                  badge.border,
                )}
              >
                {application.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Registered on {formatDate(application.createdAt)}
              {application.slug ? ` · /${application.slug}` : ""}
            </p>
          </div>

          <Link
            href={`/owner/applications/${application.id}/entitlements`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-[#0d1427]/80 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-600 shadow-sm transition-all self-start sm:self-auto"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Plan and entitlements</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </Link>
        </div>
      </div>

      {/* Main 2-Column Responsive Desktop Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column ~58% (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Card A: Application Summary */}
          <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 sm:p-6 shadow-lg backdrop-blur-md space-y-5">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/50 text-indigo-400">
                  <User className="h-4 w-4" />
                </div>
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Application summary
                </h2>
              </div>
            </div>

            {/* 10 Fields Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Field 1: Applicant */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Applicant
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.applicantName ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 2: Login email */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Login email
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.email}
                  </span>
                </div>
              </div>

              {/* Field 3: City */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    City
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.city ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 4: Phone */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Phone className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Phone
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.phone ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 5: Address */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Home className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Address
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.address ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 6: Business contact email */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Business contact email
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.primaryContactEmail ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 7: Email verified */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Calendar className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Email verified
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.emailVerifiedAt
                      ? formatDate(application.emailVerifiedAt)
                      : "Not yet"}
                  </span>
                </div>
              </div>

              {/* Field 8: Terms accepted */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Terms accepted
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.termsAcceptedAt
                      ? formatDate(application.termsAcceptedAt)
                      : "Not recorded"}
                  </span>
                </div>
              </div>

              {/* Field 9: Plan */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Plan
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.planName ?? "—"}
                  </span>
                </div>
              </div>

              {/* Field 10: Logins */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#090e23]/80 text-indigo-400">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Logins
                  </span>
                  <span className="block text-xs font-semibold text-slate-100 truncate mt-0.5">
                    {application.userCount}
                  </span>
                </div>
              </div>
            </div>

            {application.status === "REJECTED" && application.rejectionReason && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                <span className="font-bold">Rejected: </span>
                {application.rejectionReason}
              </div>
            )}
            {application.status === "SUSPENDED" && application.suspensionReason && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3.5 text-xs text-orange-200">
                <span className="font-bold">Suspended: </span>
                {application.suspensionReason}
              </div>
            )}
          </section>

          {/* Card B: Make a Decision */}
          <DecisionPanel
            tenantId={application.id}
            status={application.status}
            emailVerified={application.emailVerifiedAt !== null}
            plans={application.plans}
            currentPlanKey={application.planKey}
            features={application.features}
          />
        </div>

        {/* Right Column ~42% (5 cols) — Decision history */}
        <div className="lg:col-span-5">
          <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 sm:p-6 shadow-lg backdrop-blur-md space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/50 text-indigo-400">
                  <Clock className="h-4 w-4" />
                </div>
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Decision history
                </h2>
              </div>
              <span className="rounded-lg bg-slate-800/80 border border-slate-700/50 px-2.5 py-0.5 text-xs font-semibold text-slate-300 tabular-nums">
                {application.history.length}
              </span>
            </div>

            {/* Timeline Content */}
            {application.history.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Nothing recorded yet.
              </p>
            ) : (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-slate-800">
                {application.history.map((record, index) => {
                  const marker = getTimelineMarker(record.action);
                  const Icon = marker.icon;
                  const isCurrent = index === 0;
                  const desc = describeAuditAction(record.action);

                  return (
                    <div key={record.id} className="relative group">
                      {/* Timeline Dot Marker */}
                      <span
                        className={cx(
                          "absolute -left-6 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-xs transition-transform group-hover:scale-110",
                          marker.dotClass,
                        )}
                      >
                        <Icon className="h-3 w-3" />
                      </span>

                      {/* Timeline Item Content */}
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-200">
                              {record.action}
                            </span>
                            {isCurrent && (
                              <span className="rounded bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                                Current
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap tabular-nums text-right">
                            {formatDateTime(record.createdAt)}
                          </span>
                        </div>

                        <p className="text-xs text-slate-400">
                          {record.actorName ?? "Super Admin"}
                        </p>

                        {/* Description Box */}
                        <div className="rounded-xl border border-slate-800/80 bg-[#090e23]/70 p-3 text-xs text-slate-300 leading-relaxed">
                          {record.reason || desc.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer View All Link */}
            <div className="pt-3 border-t border-slate-800/60">
              <Link
                href="/owner/audit"
                className="group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-300" />
                <span>View all activity log</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-500 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
