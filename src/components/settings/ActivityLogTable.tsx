"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CheckSquare,
  KeyRound,
  Mail,
  Settings,
  Sliders,
  Shield,
  Building2,
  LayoutDashboard,
  Search,
  RotateCcw,
  Check,
  Ban,
  AlertCircle,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Eye,
  User as UserIcon,
} from "lucide-react";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import Menu, { menuItemClasses } from "@/components/ui/Menu";
import type {
  AuditEntryView,
  AuditMetricsSummary,
  AuditFilterOption,
} from "@/lib/auditTrail";

interface ActivityLogTableProps {
  entries: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
  metrics: AuditMetricsSummary;
  availableRoles: AuditFilterOption[];
  availableUsers: AuditFilterOption[];
  initialFilters: {
    decision?: string;
    role?: string;
    module?: string;
    userId?: string;
    period?: string;
    search?: string;
  };
}

function getActionIcon(action: string, category: string) {
  if (action.includes("APPOINTMENT")) {
    return <Calendar className="h-4 w-4 text-purple-600" />;
  }
  if (action.includes("TASK")) {
    return <CheckSquare className="h-4 w-4 text-blue-600" />;
  }
  if (action.includes("DASHBOARD")) {
    return <LayoutDashboard className="h-4 w-4 text-indigo-600" />;
  }
  if (
    action.includes("PASSWORD") ||
    action.includes("LOGIN") ||
    action.includes("SESSION")
  ) {
    return <KeyRound className="h-4 w-4 text-rose-600" />;
  }
  if (action.includes("INVITATION") || action.includes("TEAM")) {
    return <Mail className="h-4 w-4 text-sky-600" />;
  }
  if (action.includes("ROLE") || action.includes("ADMIN_ASSIGNED")) {
    return <Sliders className="h-4 w-4 text-amber-600" />;
  }
  if (action.includes("CLINIC") || category === "organisation") {
    return <Building2 className="h-4 w-4 text-teal-600" />;
  }
  if (action.includes("FEATURE") || action.includes("ENTITLEMENT")) {
    return <Settings className="h-4 w-4 text-slate-600" />;
  }
  return <Shield className="h-4 w-4 text-indigo-600" />;
}

function getIconContainerBg(action: string, category: string) {
  if (action.includes("APPOINTMENT")) return "bg-purple-50";
  if (action.includes("TASK")) return "bg-blue-50";
  if (action.includes("DASHBOARD")) return "bg-indigo-50";
  if (
    action.includes("PASSWORD") ||
    action.includes("LOGIN") ||
    action.includes("SESSION")
  )
    return "bg-rose-50";
  if (action.includes("INVITATION") || action.includes("TEAM"))
    return "bg-sky-50";
  if (action.includes("ROLE") || action.includes("ADMIN_ASSIGNED"))
    return "bg-amber-50";
  if (action.includes("CLINIC") || category === "organisation")
    return "bg-teal-50";
  if (action.includes("FEATURE") || action.includes("ENTITLEMENT"))
    return "bg-slate-100";
  return "bg-indigo-50";
}

function getModuleBadgeStyle(moduleName: string) {
  switch (moduleName.toLowerCase()) {
    case "appointments":
      return "bg-purple-50 text-purple-700 border-purple-100";
    case "tasks":
      return "bg-blue-50 text-blue-700 border-blue-100";
    case "dashboard":
      return "bg-indigo-50 text-indigo-700 border-indigo-100";
    case "security":
      return "bg-rose-50 text-rose-700 border-rose-100";
    case "team":
      return "bg-sky-50 text-sky-700 border-sky-100";
    case "settings":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "roles":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "clinic":
      return "bg-teal-50 text-teal-700 border-teal-100";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function getInitials(name: string | null, email: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    return email.slice(0, 2).toUpperCase();
  }
  return "SY";
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

export default function ActivityLogTable({
  entries,
  total,
  page,
  pageSize,
  metrics,
  availableRoles,
  availableUsers,
  initialFilters,
}: ActivityLogTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local filter states
  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [decision, setDecision] = useState(initialFilters.decision ?? "");
  const [role, setRole] = useState(initialFilters.role ?? "");
  const [moduleFilter, setModuleFilter] = useState(
    initialFilters.module ?? "",
  );
  const [userId, setUserId] = useState(initialFilters.userId ?? "");
  const [period, setPeriod] = useState(initialFilters.period ?? "30d");

  // Selected entry for details inspection modal
  const [inspectedEntry, setInspectedEntry] = useState<AuditEntryView | null>(
    null,
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromCount = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toCount = Math.min(page * pageSize, total);

  function applyFilters(overridePage?: number, overridePageSize?: number) {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (decision) params.set("decision", decision);
    if (role) params.set("role", role);
    if (moduleFilter) params.set("module", moduleFilter);
    if (userId) params.set("userId", userId);
    if (period && period !== "all") params.set("period", period);

    const currentPageSize = overridePageSize ?? pageSize;
    if (currentPageSize !== 50) {
      params.set("pageSize", String(currentPageSize));
    }

    const targetPage = overridePage ?? 1;
    if (targetPage > 1) {
      params.set("page", String(targetPage));
    }

    startTransition(() => {
      router.push(`/settings/audit?${params.toString()}`);
    });
  }

  function handleReset() {
    setSearch("");
    setDecision("");
    setRole("");
    setModuleFilter("");
    setUserId("");
    setPeriod("30d");

    startTransition(() => {
      router.push("/settings/audit");
    });
  }

  // Generate pagination items
  const renderPaginationButtons = () => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("ellipsis");

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }

    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => applyFilters(page - 1)}
          disabled={page <= 1 || isPending}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pages.map((p, idx) => {
          if (p === "ellipsis") {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="flex h-8 w-8 items-center justify-center text-caption text-faint"
              >
                ...
              </span>
            );
          }

          const isActive = p === page;
          return (
            <button
              key={`page-${p}`}
              type="button"
              onClick={() => applyFilters(p)}
              disabled={isPending}
              className={`flex h-8 min-w-[2rem] px-2 items-center justify-center rounded-lg text-caption font-semibold transition ${
                isActive
                  ? "bg-accent-soft text-accent border border-accent/30 font-bold"
                  : "border border-line bg-canvas text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => applyFilters(page + 1)}
          disabled={page >= totalPages || isPending}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 2-row Filters Panel */}
      <div className="rounded-2xl border border-line bg-canvas p-4 sm:p-5 shadow-card space-y-3">
        {/* Row 1: Search, Decision, Apply, Reset */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              strokeWidth={1.75}
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters(1);
              }}
              placeholder="Search by name, email or action..."
              className="h-10 w-full rounded-xl border border-line bg-canvas py-2 pl-10 pr-4 text-input text-ink placeholder:text-faint transition focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="w-full sm:w-56">
            <Select
              id="filter-decision"
              name="decision"
              label="Decision"
              isLabelHidden
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="">All decisions</option>
              <option value="success">Success</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed / not allowed</option>
            </Select>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => applyFilters(1)}
              disabled={isPending}
              className="h-10 rounded-xl bg-accent px-6 text-label font-semibold text-accent-ink transition hover:bg-accent-strong disabled:opacity-60 shadow-sm"
            >
              Apply
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={isPending}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-canvas px-4 text-label font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4 text-muted" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Row 2: Roles, Modules, Users, Period */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Select
              id="filter-role"
              name="role"
              label="Role"
              isLabelHidden
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">All roles</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Select
              id="filter-module"
              name="module"
              label="Module"
              isLabelHidden
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              <option value="">All modules</option>
              <option value="appointments">Appointments</option>
              <option value="tasks">Tasks</option>
              <option value="dashboard">Dashboard</option>
              <option value="security">Security</option>
              <option value="team">Team</option>
              <option value="settings">Settings</option>
              <option value="clinic">Clinic</option>
              <option value="roles">Roles</option>
            </Select>
          </div>

          <div>
            <Select
              id="filter-user"
              name="userId"
              label="User"
              isLabelHidden
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">All users</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Select
              id="filter-period"
              name="period"
              label="Period"
              isLabelHidden
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="30d">Last 30 days</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Summary Metrics Strip (4 Cards) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Total activities */}
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-caption font-medium text-muted">
              Total activities
            </p>
            <p className="text-2xl font-bold tracking-tight text-ink">
              {metrics.totalActivities.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Success */}
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Check className="h-5 w-5 stroke-[2.5]" />
          </div>
          <div className="min-w-0">
            <p className="text-caption font-medium text-muted">Success</p>
            <p className="text-2xl font-bold tracking-tight text-ink">
              {metrics.successCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Failed / not allowed */}
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Ban className="h-5 w-5 stroke-[2.5]" />
          </div>
          <div className="min-w-0">
            <p className="text-caption font-medium text-muted truncate">
              Failed / not allowed
            </p>
            <p className="text-2xl font-bold tracking-tight text-ink">
              {metrics.failedCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Unique users */}
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <UserIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-caption font-medium text-muted">Unique users</p>
            <p className="text-2xl font-bold tracking-tight text-ink">
              {metrics.uniqueUsersCount.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Activity Table Card */}
      <div className="rounded-2xl border border-line bg-canvas shadow-card overflow-hidden">
        {/* Table Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 text-label text-muted">
          <div className="font-medium text-ink">
            {total > 0 ? (
              <span>
                {fromCount}–{toCount} of {total} activities
              </span>
            ) : (
              <span>0 activities</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted">Show</span>
              <div className="w-20">
                <Select
                  id="page-size-selector"
                  name="pageSize"
                  label="Show"
                  isLabelHidden
                  value={String(pageSize)}
                  onChange={(e) => applyFilters(1, Number(e.target.value))}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </Select>
              </div>
            </div>

            {renderPaginationButtons()}
          </div>
        </div>

        {/* Operational Table (Desktop / Tablet view) */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-body">
            <thead>
              <tr className="border-b border-line bg-canvas-subtle/60 text-caption font-semibold text-muted tracking-wider uppercase">
                <th scope="col" className="px-5 py-3">
                  Activity
                </th>
                <th scope="col" className="px-5 py-3">
                  User
                </th>
                <th scope="col" className="px-5 py-3">
                  Role
                </th>
                <th scope="col" className="px-5 py-3">
                  Module
                </th>
                <th scope="col" className="px-5 py-3">
                  Decision
                </th>
                <th scope="col" className="px-5 py-3">
                  <span className="inline-flex items-center gap-1">
                    Date & time <span className="text-xs">↓</span>
                  </span>
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-muted">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="h-8 w-8 text-faint" />
                      <p className="text-body font-medium text-ink">
                        No activities match your filters
                      </p>
                      <p className="text-label text-muted max-w-md">
                        Try loosening search keywords or clearing selected
                        filters to view recorded activities.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const initials = getInitials(
                    entry.actorName,
                    entry.actorEmail,
                  );
                  const icon = getActionIcon(entry.action, entry.category);
                  const iconBg = getIconContainerBg(
                    entry.action,
                    entry.category,
                  );
                  const moduleBadgeClass = getModuleBadgeStyle(entry.module);

                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-canvas-subtle/50 transition-colors"
                    >
                      {/* Activity */}
                      <td className="px-5 py-3.5 align-middle">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
                          >
                            {icon}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-ink text-body leading-snug">
                              {entry.label}
                            </p>
                            <p className="text-caption text-muted truncate max-w-sm">
                              {entry.detail}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* User */}
                      <td className="px-5 py-3.5 align-middle">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-caption font-semibold">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-ink text-body leading-tight truncate max-w-[150px]">
                              {entry.actorName ??
                                (entry.byPlatform ? "MEDCARE PRO" : "System")}
                            </p>
                            {entry.actorEmail && (
                              <p className="text-caption text-muted truncate max-w-[150px]">
                                {entry.actorEmail}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-3.5 align-middle text-body font-normal text-muted">
                        {entry.actorRole}
                      </td>

                      {/* Module */}
                      <td className="px-5 py-3.5 align-middle">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-caption font-medium border ${moduleBadgeClass}`}
                        >
                          {entry.module}
                        </span>
                      </td>

                      {/* Decision */}
                      <td className="px-5 py-3.5 align-middle">
                        {entry.decision === "success" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                            Success
                          </span>
                        )}
                        {entry.decision === "cancelled" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-medium bg-amber-50 text-amber-700 border border-amber-200/80">
                            <Ban className="h-3.5 w-3.5 stroke-[2.5]" />
                            Cancelled
                          </span>
                        )}
                        {entry.decision === "failed" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-medium bg-rose-50 text-rose-700 border border-rose-200/80">
                            <AlertCircle className="h-3.5 w-3.5 stroke-[2.5]" />
                            Failed / Denied
                          </span>
                        )}
                      </td>

                      {/* Date & time */}
                      <td className="px-5 py-3.5 align-middle whitespace-nowrap">
                        <p className="text-body font-medium text-ink leading-tight">
                          {formatDate(entry.createdAt)}
                        </p>
                        <p className="text-caption text-muted mt-0.5">
                          {formatTime(entry.createdAt)}
                        </p>
                      </td>

                      {/* Action */}
                      <td className="px-5 py-3.5 align-middle text-right">
                        <Menu
                          label="Activity actions"
                          align="end"
                          usePortal
                          trigger={() => (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas-subtle hover:text-ink transition"
                              aria-label="View activity options"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setInspectedEntry(entry)}
                            className={menuItemClasses()}
                          >
                            <Eye className="h-4 w-4 text-muted" />
                            <span>View details</span>
                          </button>
                        </Menu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile / Compact Representation (< 1024px) */}
        <div className="block lg:hidden divide-y divide-line/60">
          {entries.length === 0 ? (
            <div className="px-5 py-10 text-center text-muted">
              <Search className="mx-auto h-8 w-8 text-faint mb-2" />
              <p className="text-body font-medium text-ink">
                No activities match your filters
              </p>
            </div>
          ) : (
            entries.map((entry) => {
              const initials = getInitials(entry.actorName, entry.actorEmail);
              const icon = getActionIcon(entry.action, entry.category);
              const iconBg = getIconContainerBg(entry.action, entry.category);
              const moduleBadgeClass = getModuleBadgeStyle(entry.module);

              return (
                <div key={entry.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
                      >
                        {icon}
                      </div>
                      <div>
                        <p className="font-semibold text-ink text-body">
                          {entry.label}
                        </p>
                        <p className="text-caption text-muted">
                          {entry.detail}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setInspectedEntry(entry)}
                      className="p-1 text-muted hover:text-ink"
                      aria-label="View details"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-caption">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border ${moduleBadgeClass}`}
                    >
                      {entry.module}
                    </span>

                    {entry.decision === "success" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                        <Check className="h-3 w-3 stroke-[2.5]" />
                        Success
                      </span>
                    )}
                    {entry.decision === "cancelled" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80">
                        <Ban className="h-3 w-3 stroke-[2.5]" />
                        Cancelled
                      </span>
                    )}
                    {entry.decision === "failed" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/80">
                        <AlertCircle className="h-3 w-3 stroke-[2.5]" />
                        Failed
                      </span>
                    )}

                    <span className="text-muted ml-auto">
                      {formatDate(entry.createdAt)} ·{" "}
                      {formatTime(entry.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-line/40 text-caption text-muted">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-semibold text-[10px]">
                      {initials}
                    </div>
                    <span className="font-medium text-ink truncate">
                      {entry.actorName ??
                        (entry.byPlatform ? "MEDCARE PRO" : "System")}
                    </span>
                    <span className="text-faint">({entry.actorRole})</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Table Bottom Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-label text-muted">
          <div>
            Showing {fromCount} to {toCount} of {total} activities
          </div>
          <div>{renderPaginationButtons()}</div>
        </div>
      </div>

      {/* Read-Only Details Inspection Modal */}
      {inspectedEntry && (
        <Modal
          isOpen={true}
          onClose={() => setInspectedEntry(null)}
          title="Activity Details"
          description="Detailed read-only inspection of this recorded system activity."
          size="md"
        >
          <div className="space-y-4 py-2 text-body">
            <div className="rounded-xl border border-line bg-canvas-subtle p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-caption font-semibold text-muted uppercase">
                  Action
                </span>
                <span className="text-caption font-mono text-faint">
                  {inspectedEntry.action}
                </span>
              </div>
              <p className="font-semibold text-ink text-body">
                {inspectedEntry.label}
              </p>
              <p className="text-label text-muted">{inspectedEntry.detail}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-label">
              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Actor
                </span>
                <p className="font-medium text-ink mt-0.5">
                  {inspectedEntry.actorName ??
                    (inspectedEntry.byPlatform ? "MEDCARE PRO" : "System")}
                </p>
                {inspectedEntry.actorEmail && (
                  <p className="text-caption text-muted">
                    {inspectedEntry.actorEmail}
                  </p>
                )}
              </div>

              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Role
                </span>
                <p className="font-medium text-ink mt-0.5">
                  {inspectedEntry.actorRole}
                </p>
              </div>

              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Module
                </span>
                <p className="font-medium text-ink mt-0.5">
                  {inspectedEntry.module}
                </p>
              </div>

              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Decision
                </span>
                <p className="font-medium text-ink mt-0.5 capitalize">
                  {inspectedEntry.decision}
                </p>
              </div>

              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Target Type
                </span>
                <p className="font-medium text-ink mt-0.5">
                  {inspectedEntry.targetType}
                </p>
              </div>

              <div>
                <span className="text-caption font-semibold text-muted uppercase block">
                  Target ID
                </span>
                <p className="font-mono text-xs text-muted mt-0.5 truncate">
                  {inspectedEntry.targetId ?? "—"}
                </p>
              </div>
            </div>

            {inspectedEntry.reason && (
              <div className="rounded-xl border border-line bg-canvas p-3">
                <span className="text-caption font-semibold text-muted uppercase block">
                  Reason
                </span>
                <p className="text-body text-ink mt-1 italic">
                  “{inspectedEntry.reason}”
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-line text-caption text-muted">
              <span>Recorded timestamp</span>
              <span className="font-mono">
                {new Date(inspectedEntry.createdAt).toISOString()}
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
