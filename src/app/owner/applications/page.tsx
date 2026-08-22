import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import {
  APPLICATION_PAGE_SIZE,
  listClinicApplications,
} from "@/lib/platform/applications";
import { formatDateOnly } from "@/lib/dates";
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
  PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  SUSPENDED: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  REJECTED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  ARCHIVED: "bg-slate-500/10 text-slate-300 border-slate-500/30",
};

function parseStatus(value: string | undefined): TenantStatus {
  const match = TABS.find((tab) => tab.status === value);
  return match?.status ?? "PENDING";
}

interface PageProps {
  // Next 16 hands search params to the page as a promise.
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

  function pageHref(next: number): string {
    const query = new URLSearchParams({ status, page: String(next) });
    if (search) {
      query.set("search", search);
    }
    return `/owner/applications?${query.toString()}`;
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <Link
        href="/owner/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Platform overview
      </Link>

      <h1 className="text-xl font-semibold">Clinic applications</h1>
      <p className="mt-1 text-xs text-slate-400">
        {total} organisation{total === 1 ? "" : "s"} with this status
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={`/owner/applications?status=${tab.status}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab.status === status
                ? "border-slate-500 bg-slate-800 text-slate-100"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            }`}
          >
            {tab.label}
            <span className="ml-2 tabular-nums text-slate-500">
              {counts[tab.status]}
            </span>
          </Link>
        ))}
      </div>

      <form method="get" className="mt-4 flex gap-2">
        <input type="hidden" name="status" value={status} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Clinic name, email or city"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 text-sm font-medium text-slate-100 hover:bg-slate-700"
        >
          Search
        </button>
      </form>

      {applications.length === 0 ? (
        <p className="mt-10 rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
          Nothing here.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {applications.map((application) => (
            <li key={application.id}>
              <Link
                href={`/owner/applications/${application.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-100">
                    {application.clinicName}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">
                    {application.email}
                    {application.city ? ` · ${application.city}` : ""}
                    {application.applicantName ? ` · ${application.applicantName}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {application.emailVerifiedAt === null && (
                    <span className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400">
                      Email unverified
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {formatDateOnly(application.createdAt)}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                      STATUS_STYLES[application.status]
                    }`}
                  >
                    {application.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
          <span>
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="hover:text-slate-200">
                Previous
              </Link>
            )}
            {page < lastPage && (
              <Link href={pageHref(page + 1)} className="hover:text-slate-200">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
