import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MapPin,
  Search,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import {
  APPLICATION_PAGE_SIZE,
  listClinicApplications,
} from "@/lib/platform/applications";
import { formatDateOnly } from "@/lib/dates";
import { cx } from "@/components/ui";
import type { TenantStatus } from "@prisma/client";

/**
 * The clinic application queue — Stage 3 item 5.
 *
 * Rendered on the server, including the filter tabs and the search box: the
 * data is Owner-only, so shipping it to a client component to filter would put
 * every organisation's contact details into the browser to render one page of
 * twenty-five. Tabs are links and search is a GET form, which also makes the
 * current view a URL an Owner can bookmark or share with a colleague.
 */

const TABS: readonly { label: string; status: TenantStatus }[] = [
  { label: "Awaiting approval", status: "PENDING" },
  { label: "Active", status: "ACTIVE" },
  { label: "Suspended", status: "SUSPENDED" },
  { label: "Rejected", status: "REJECTED" },
  { label: "Archived", status: "ARCHIVED" },
];

const STATUS_STYLES: Record<TenantStatus, string> = {
  PENDING: "border-amber-500/30 bg-amber-950/60 text-amber-300",
  ACTIVE: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
  SUSPENDED: "border-blue-500/30 bg-blue-950/60 text-blue-300",
  REJECTED: "border-rose-500/30 bg-rose-950/60 text-rose-300",
  ARCHIVED: "border-slate-700/60 bg-slate-900/60 text-slate-400",
};

function parseStatus(value: string | undefined): TenantStatus {
  const match = TABS.find((tab) => tab.status === value);
  return match?.status ?? "PENDING";
}

function formatSubmittedAt(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  let hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = String(hours).padStart(2, "0");
  return `${y}-${m}-${d} at ${formattedHours}:${minutes} ${ampm} (UTC)`;
}

function getPaginationPages(currentPage: number, maxPage: number): (number | string)[] {
  if (maxPage <= 7) {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", maxPage];
  }
  if (currentPage >= maxPage - 3) {
    return [1, "...", maxPage - 4, maxPage - 3, maxPage - 2, maxPage - 1, maxPage];
  }
  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", maxPage];
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OwnerApplicationsPage({ searchParams }: PageProps) {
  const owner = await requireOwnerPage();
  const params = await searchParams;

  const statusParam = Array.isArray(params.status) ? params.status[0] : params.status;
  const searchParam = Array.isArray(params.search) ? params.search[0] : params.search;
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;

  const status = parseStatus(statusParam);
  const search = searchParam?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const { applications, counts, total } = await listClinicApplications(owner, {
    status,
    search: search || null,
    page,
  });

  const lastPage = Math.max(1, Math.ceil(total / APPLICATION_PAGE_SIZE));
  const startIndex = total === 0 ? 0 : (page - 1) * APPLICATION_PAGE_SIZE + 1;
  const endIndex = Math.min(page * APPLICATION_PAGE_SIZE, total);

  function pageHref(next: number): string {
    const query = new URLSearchParams({ status, page: String(next) });
    if (search) {
      query.set("search", search);
    }
    return `/owner/applications?${query.toString()}`;
  }

  function tabHref(tabStatus: TenantStatus): string {
    const query = new URLSearchParams({ status: tabStatus });
    if (search) {
      query.set("search", search);
    }
    return `/owner/applications?${query.toString()}`;
  }

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6 text-white font-sans">
      {/* Breadcrumbs & Header Title */}
      <div>
        <Link
          href="/owner/dashboard"
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Platform overview</span>
        </Link>

        <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">
          Clinic applications
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-400 leading-relaxed">
          Manage and review applications from clinics requesting access to the platform.
        </p>
      </div>

      {/* Segmented Status Tabs Capsule */}
      <div className="flex items-center gap-1.5 rounded-2xl border border-slate-800/80 bg-[#0c1226]/80 p-1.5 w-fit max-w-full overflow-x-auto shadow-sm">
        {TABS.map((tab) => {
          const isSelected = tab.status === status;
          const count = counts[tab.status] ?? 0;

          return (
            <Link
              key={tab.status}
              href={tabHref(tab.status)}
              className={cx(
                "inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition-all duration-150 select-none",
                isSelected
                  ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white font-semibold shadow-md shadow-indigo-600/25"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] tabular-nums font-semibold",
                  isSelected
                    ? "bg-indigo-950/80 text-white border border-indigo-400/30"
                    : "bg-slate-800/80 text-slate-400",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Search & Filter Toolbar */}
      <form
        method="get"
        className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-3 sm:p-3.5 shadow-lg backdrop-blur-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3"
      >
        <input type="hidden" name="status" value={status} />

        <div className="relative flex-1 min-w-0 flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-500" />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search by clinic name, email or city"
            className="w-full rounded-xl bg-transparent py-2 pl-10 pr-4 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
        </div>

        <div className="flex items-center gap-2.5 shrink-0 justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <span>More filters</span>
          </button>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] transition-all"
          >
            <span>Search</span>
          </button>
        </div>
      </form>

      {/* Applications List Container */}
      <div className="space-y-3">
        {/* Results Header */}
        <div className="flex items-center justify-between px-1 text-xs text-slate-400">
          <div>
            <span className="font-medium">
              {total} application{total === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white transition-colors">
            <span className="text-slate-400">Sort by:</span>
            <span className="font-semibold text-white">Newest first</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>

        {/* Applications Rows */}
        {applications.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-12 text-center shadow-lg backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400 shadow-sm">
              <Building2 className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-white">No applications found</h3>
            <p className="mt-1 text-xs text-slate-400">
              {search
                ? `No clinic applications matched "${search}" in this category.`
                : "There are no clinic applications under this status tab."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map((application) => {
              const statusBadgeStyle =
                STATUS_STYLES[application.status] || STATUS_STYLES.PENDING;

              return (
                <div
                  key={application.id}
                  className="group relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-700"
                >
                  {/* Left Clinic Information */}
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400 shadow-sm transition-transform duration-150 group-hover:scale-105">
                      <Building2 className="h-6 w-6" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {application.clinicName}
                      </h3>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className="truncate max-w-xs">{application.email}</span>
                        </span>

                        {application.city && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-slate-600">&middot;</span>
                            <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span>{application.city}</span>
                          </span>
                        )}

                        {application.applicantName && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-slate-600">&middot;</span>
                            <User className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span>{application.applicantName}</span>
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 text-[11px] text-slate-500">
                        Submitted on {formatSubmittedAt(application.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* Right Status & Action Controls */}
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6 shrink-0 lg:ml-auto">
                    {/* Email Verification State */}
                    {application.emailVerifiedAt === null ? (
                      <span className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-[11px] font-medium text-slate-400">
                        Email unverified
                      </span>
                    ) : (
                      <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-medium text-emerald-400">
                        Email verified
                      </span>
                    )}

                    {/* Submitted Date */}
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-500 shrink-0" />
                      <div>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
                          Submitted
                        </span>
                        <span className="block text-xs font-medium text-slate-300 leading-tight mt-0.5 tabular-nums">
                          {formatDateOnly(application.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
                        Status
                      </span>
                      <span
                        className={cx(
                          "mt-0.5 inline-block rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
                          statusBadgeStyle,
                        )}
                      >
                        {application.status}
                      </span>
                    </div>

                    {/* Review Application Action Link */}
                    <Link
                      href={`/owner/applications/${application.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-950/50 hover:bg-indigo-900/70 text-indigo-300 hover:text-white px-4 py-2 text-xs font-semibold shadow-xs transition-all duration-150 active:scale-[0.99]"
                    >
                      <span>Review application</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800/60 text-xs text-slate-400">
          <div>
            {total <= APPLICATION_PAGE_SIZE ? (
              <span>
                Showing {total} of {total} application{total === 1 ? "" : "s"}
              </span>
            ) : (
              <span>
                Showing {startIndex}&ndash;{endIndex} of {total} applications
              </span>
            )}
          </div>

          {lastPage > 1 && (
            <div className="flex items-center gap-1.5">
              {/* Previous Button */}
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  aria-label="Previous page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800/40 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </span>
              )}

              {/* Numbered Page Buttons */}
              {getPaginationPages(page, lastPage).map((p, idx) => {
                if (typeof p === "string") {
                  return (
                    <span
                      key={`ellipsis-${idx}`}
                      className="flex h-8 w-8 items-center justify-center text-xs text-slate-600 select-none"
                    >
                      &hellip;
                    </span>
                  );
                }

                const isCurrent = p === page;
                return (
                  <Link
                    key={`page-${p}`}
                    href={pageHref(p)}
                    className={cx(
                      "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-all select-none",
                      isCurrent
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                        : "border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    {p}
                  </Link>
                );
              })}

              {/* Next Button */}
              {page < lastPage ? (
                <Link
                  href={pageHref(page + 1)}
                  aria-label="Next page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800/40 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
