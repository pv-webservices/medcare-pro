import Link from "next/link";
import { ArrowLeft, Download, Search } from "lucide-react";
import Select from "@/components/ui/Select";
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
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Platform overview
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Activity log</h1>
          <p className="mt-1 text-xs text-muted">
            <span className="tabular-nums text-ink">{result.total}</span>{""}
            record{result.total === 1 ? "" : "s"} across every organisation.
            Append-only — nothing here can be edited or removed.
          </p>
        </div>

        <a
          href={`/api/owner/audit?${exportQuery.toString()}`}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink transition hover:border-line"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </div>

      <form method="get" className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            name="search"
            defaultValue={result.filters.search}
            placeholder="Who — name or email"
            className="w-full rounded-2xl bg-canvas py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint shadow-neu-inset"
          />
        </div>

        <div className="w-full sm:w-56">
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

        <div className="w-full sm:w-56">
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

        <input
          type="date"
          name="from"
          defaultValue={result.filters.from ?? ""}
          aria-label="From date"
          className="rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
        />
        <input
          type="date"
          name="to"
          defaultValue={result.filters.to ?? ""}
          aria-label="To date"
          className="rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
        />

        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-strong lg:col-span-1"
        >
          Apply filters
        </button>
      </form>

      {result.entries.length === 0 ? (
        <p className="mt-8 rounded-3xl bg-canvas p-6 text-center text-sm text-muted shadow-neu-raised-sm">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[64rem] text-left text-xs">
            <thead className="bg-canvas text-muted">
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
            <tbody className="divide-y divide-line bg-canvas">
              {result.entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                    {entry.createdAt.toISOString().slice(0, 19).replace("T", "")}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-ink">{entry.label}</span>
                    <code className="mt-0.5 block text-[10px] text-faint">
                      {entry.action}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {entry.tenantName ?? (
                      <span className="text-faint">— platform —</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {entry.actorName ?? entry.actorEmail ?? (
                      <span className="text-faint">System</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {entry.targetType}
                    {entry.targetId && (
                      <code className="mt-0.5 block text-[10px] text-faint">
                        {entry.targetId}
                      </code>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-2 text-muted">
                    {entry.reason ?? ""}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2">
                    {entry.beforeValue !== null && (
                      <code className="block break-all text-[10px] text-alert-ink/80">
                        {preview(entry.beforeValue)}
                      </code>
                    )}
                    {entry.afterValue !== null && (
                      <code className="block break-all text-[10px] text-ok-ink/80">
                        {preview(entry.afterValue)}
                      </code>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-faint">
                    {entry.ip ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>
            Page <span className="tabular-nums">{result.page}</span> of{""}
            <span className="tabular-nums">{lastPage}</span>
          </span>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Link
                href={withPage(result.page - 1)}
                className="rounded-lg border border-line px-3 py-1.5 hover:border-line"
              >
                Previous
              </Link>
            )}
            {result.page < lastPage && (
              <Link
                href={withPage(result.page + 1)}
                className="rounded-lg border border-line px-3 py-1.5 hover:border-line"
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
