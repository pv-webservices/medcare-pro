import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import {
  OWNER_AUDIT_PAGE_SIZE,
  listAuditLog,
  ownerAuditFilterSchema,
} from "@/lib/platform/auditLog";
import AuditChangeCell from "@/components/owner/AuditChangeCell";
import { cx } from "@/components/ui";

/**
 * The cross-tenant audit trail — Stage 11, Owner surface.
 *
 * Rendered on the server, filters included: the rows span every organisation on
 * the platform, so shipping them to a client component to filter would put the
 * whole trail into a browser to render a hundred lines. Filters are a GET form,
 * which also makes the current view a URL an Owner can paste into a ticket.
 *
 * The export link is a plain anchor to the API route rather than a fetch: the
 * browser's own download handling is what a support engineer expects, and a
 * blob built in JavaScript would put a second copy of the file in memory for no
 * gain.
 */

interface PageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatUtcTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function getPaginationPages(currentPage: number, maxPage: number): (number | string)[] {
  if (maxPage <= 7) {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, "...", maxPage];
  }
  if (currentPage >= maxPage - 2) {
    return [1, "...", maxPage - 2, maxPage - 1, maxPage];
  }
  return [1, "...", currentPage, "...", maxPage];
}

export default async function OwnerAuditPage({ searchParams }: PageProps) {
  const owner = await requireOwnerPage();
  const params = await searchParams;

  const filters = ownerAuditFilterSchema.parse({
    category: one(params.category),
    action: one(params.action),
    tenantId: one(params.tenantId),
    search: one(params.search),
    from: one(params.from),
    to: one(params.to),
    page: one(params.page),
  });

  const result = await listAuditLog(owner, filters);
  const lastPage = Math.max(1, Math.ceil(result.total / OWNER_AUDIT_PAGE_SIZE));
  const page = result.page;
  const pageSize = result.pageSize;
  const total = result.total;
  const startIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  function withPage(next: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(result.filters)) {
      if (value) {
        query.set(key, String(value));
      }
    }
    query.set("page", String(next));
    return `/owner/audit?${query.toString()}`;
  }

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(result.filters)) {
    if (value) {
      exportQuery.set(key, String(value));
    }
  }
  exportQuery.set("format", "csv");

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6 text-white font-sans">
      {/* Breadcrumbs & Header */}
      <div>
        <Link
          href="/owner/dashboard"
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Platform overview</span>
        </Link>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Activity log
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-400 leading-relaxed">
              <strong className="font-semibold text-slate-200 tabular-nums">
                {result.total}
              </strong>{" "}
              records across every organisation. Append-only &mdash; nothing here can be edited or removed.
            </p>
          </div>

          <a
            href={`/api/owner/audit?${exportQuery.toString()}`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 hover:border-slate-700 shadow-sm transition-all self-start sm:self-auto"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Filter Toolbar Card */}
      <form
        method="get"
        className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-3 sm:p-3.5 shadow-lg backdrop-blur-md flex flex-wrap items-center gap-2.5 sm:gap-3"
      >
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] sm:min-w-[240px] flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-500" />
          <input
            type="search"
            name="search"
            defaultValue={result.filters.search}
            placeholder="Who — name or email"
            className="w-full rounded-xl border border-slate-800/90 bg-slate-900/70 py-2 pl-10 pr-3.5 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
        </div>

        {/* Organisation Dropdown */}
        <div className="w-full sm:w-48 shrink-0">
          <Select
            id="owner-audit-tenant"
            name="tenantId"
            label="Organisation"
            isLabelHidden
            defaultValue={result.filters.tenantId ?? ""}
          >
            <option value="">Every organisation</option>
            {result.tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Category Dropdown */}
        <div className="w-full sm:w-44 shrink-0">
          <Select
            id="owner-audit-category"
            name="category"
            label="Category"
            isLabelHidden
            defaultValue={result.filters.category ?? ""}
          >
            <option value="">Every category</option>
            {result.categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>

        {/* From Date */}
        <div className="w-full sm:w-36 shrink-0">
          <DatePicker
            id="owner-audit-from"
            name="from"
            label="From date"
            isLabelHidden
            defaultValue={result.filters.from ?? ""}
            placeholder="From date"
          />
        </div>

        {/* To Date */}
        <div className="w-full sm:w-36 shrink-0">
          <DatePicker
            id="owner-audit-to"
            name="to"
            label="To date"
            isLabelHidden
            defaultValue={result.filters.to ?? ""}
            placeholder="To date"
          />
        </div>

        {/* Apply Filters Button */}
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] transition-all shrink-0 ml-auto sm:ml-0"
        >
          Apply filters
        </button>
      </form>

      {/* Activity Table */}
      {result.entries.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-12 text-center text-xs text-slate-400 shadow-lg backdrop-blur-md">
          Nothing matches those filters.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 shadow-lg backdrop-blur-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[64rem]">
              <thead>
                <tr className="border-b border-slate-800/80 bg-[#090e23]/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <span>When (UTC)</span>
                      <ChevronDown className="h-3 w-3 text-slate-500" />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 font-semibold">Action</th>
                  <th className="py-3.5 px-4 font-semibold">Organisation</th>
                  <th className="py-3.5 px-4 font-semibold">Who</th>
                  <th className="py-3.5 px-4 font-semibold">Target</th>
                  <th className="py-3.5 px-4 font-semibold">Reason</th>
                  <th className="py-3.5 px-4 font-semibold">Change</th>
                  <th className="py-3.5 px-4 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-xs">
                {result.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-slate-800/30 transition-colors group align-top"
                  >
                    {/* Timestamp */}
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {formatUtcTimestamp(entry.createdAt)}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {entry.label}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-500 uppercase tracking-wider">
                        {entry.action}
                      </div>
                    </td>

                    {/* Organisation */}
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      {entry.tenantName ?? (
                        <span className="text-slate-500">&mdash; platform &mdash;</span>
                      )}
                    </td>

                    {/* Who */}
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      {entry.actorName ?? entry.actorEmail ?? (
                        <span className="text-slate-500">System</span>
                      )}
                    </td>

                    {/* Target */}
                    <td className="py-3 px-4 text-slate-300">
                      <div className="font-medium text-slate-200">
                        {entry.targetType}
                      </div>
                      {entry.targetId && (
                        <div
                          className="mt-0.5 font-mono text-[10px] text-slate-500 truncate max-w-[150px]"
                          title={entry.targetId}
                        >
                          {entry.targetId}
                        </div>
                      )}
                    </td>

                    {/* Reason */}
                    <td className="py-3 px-4 text-slate-400 max-w-[14rem] truncate">
                      {entry.reason ? (
                        <span title={entry.reason}>{entry.reason}</span>
                      ) : (
                        <span className="text-slate-600 font-medium">&mdash;</span>
                      )}
                    </td>

                    {/* Change */}
                    <td className="py-3 px-4 max-w-[16rem]">
                      <AuditChangeCell
                        beforeValue={entry.beforeValue}
                        afterValue={entry.afterValue}
                      />
                    </td>

                    {/* IP */}
                    <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap tabular-nums">
                      {entry.ip || <span className="text-slate-600">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800/60 text-xs text-slate-400">
          <div>
            Showing <span className="tabular-nums font-semibold text-slate-200">{startIndex}</span> to{" "}
            <span className="tabular-nums font-semibold text-slate-200">{endIndex}</span> of{" "}
            <span className="tabular-nums font-semibold text-slate-200">{total}</span> records
          </div>

          {lastPage > 1 && (
            <div className="flex items-center gap-1.5">
              {/* Previous Page */}
              {page > 1 ? (
                <Link
                  href={withPage(page - 1)}
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

              {/* Numbered Pages */}
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
                    href={withPage(p)}
                    className={cx(
                      "flex h-8 min-w-8 px-2.5 items-center justify-center rounded-lg text-xs font-semibold transition-all select-none",
                      isCurrent
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                        : "border border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    {p}
                  </Link>
                );
              })}

              {/* Next Page */}
              {page < lastPage ? (
                <Link
                  href={withPage(page + 1)}
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
