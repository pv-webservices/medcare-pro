import Link from "next/link";
import { ArrowLeft, Download, Search } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import {
  OWNER_AUDIT_PAGE_SIZE,
  listAuditLog,
  ownerAuditFilterSchema,
} from "@/lib/platform/auditLog";

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

/** JSON small enough to read in a table cell, and obvious when it is not. */
function preview(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
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
    <div className="mx-auto max-w-7xl p-8">
      <Link
        href="/owner/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Platform overview
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Activity log</h1>
          <p className="mt-1 text-xs text-slate-400">
            <span className="tabular-nums text-slate-200">{result.total}</span>{" "}
            record{result.total === 1 ? "" : "s"} across every organisation.
            Append-only — nothing here can be edited or removed.
          </p>
        </div>

        <a
          href={`/api/owner/audit?${exportQuery.toString()}`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </div>

      <form method="get" className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            name="search"
            defaultValue={result.filters.search}
            placeholder="Who — name or email"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none"
          />
        </div>

        <select
          name="tenantId"
          defaultValue={result.filters.tenantId ?? ""}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-600 focus:outline-none"
        >
          <option value="">Every organisation</option>
          {result.tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>

        <select
          name="category"
          defaultValue={result.filters.category ?? ""}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-600 focus:outline-none"
        >
          <option value="">Every category</option>
          {result.categories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          name="from"
          defaultValue={result.filters.from ?? ""}
          aria-label="From date"
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-600 focus:outline-none"
        />
        <input
          type="date"
          name="to"
          defaultValue={result.filters.to ?? ""}
          aria-label="To date"
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-600 focus:outline-none"
        />

        <button
          type="submit"
          className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white lg:col-span-1"
        >
          Apply filters
        </button>
      </form>

      {result.entries.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[64rem] text-left text-xs">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">When (UTC)</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Organisation</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Change</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950">
              {result.entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-400">
                    {entry.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-slate-100">{entry.label}</span>
                    <code className="mt-0.5 block text-[10px] text-slate-500">
                      {entry.action}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {entry.tenantName ?? (
                      <span className="text-slate-500">— platform —</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {entry.actorName ?? entry.actorEmail ?? (
                      <span className="text-slate-500">System</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {entry.targetType}
                    {entry.targetId && (
                      <code className="mt-0.5 block text-[10px] text-slate-600">
                        {entry.targetId}
                      </code>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-2 text-slate-400">
                    {entry.reason ?? ""}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2">
                    {entry.beforeValue !== null && (
                      <code className="block break-all text-[10px] text-rose-300/80">
                        {preview(entry.beforeValue)}
                      </code>
                    )}
                    {entry.afterValue !== null && (
                      <code className="block break-all text-[10px] text-emerald-300/80">
                        {preview(entry.afterValue)}
                      </code>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">
                    {entry.ip ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>
            Page <span className="tabular-nums">{result.page}</span> of{" "}
            <span className="tabular-nums">{lastPage}</span>
          </span>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Link
                href={withPage(result.page - 1)}
                className="rounded-lg border border-slate-800 px-3 py-1.5 hover:border-slate-600"
              >
                Previous
              </Link>
            )}
            {result.page < lastPage && (
              <Link
                href={withPage(result.page + 1)}
                className="rounded-lg border border-slate-800 px-3 py-1.5 hover:border-slate-600"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
