import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Search, ShieldCheck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";
import StatusPill from "@/components/ui/StatusPill";
import { PermissionError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import {
  AUDIT_PAGE_SIZE,
  auditFilterSchema,
  getAuditTrail,
  type AuditTrailPage,
} from "@/lib/auditTrail";

// Activity log — Stage 11, the tenant side.
//
// `audit:read` gates the page, enforced in @/lib/auditTrail rather than by
// hiding anything: reaching this URL directly gets the same refusal.
//
// WHAT THIS SCREEN SHOWS AND WHAT IT WITHHOLDS. Every row is one decision, in a
// sentence: who did what, to what, when, and why if a reason was written. No IP
// address, no device string, no raw JSON — those are platform incident tools
// and lib/auditTrail.ts does not even select them, so there is no redaction step
// here that a later edit could skip.
//
// Rendered on the server, filters included, for the same reason the Owner list
// is: the rows are this organisation's own history, and a GET form makes the
// current view a URL somebody can share with a colleague.

interface PageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      {children}
    </section>
  );
}

export default async function AuditSettingsPage({ searchParams }: PageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const params = await searchParams;
  const filters = auditFilterSchema.parse({
    category: one(params.category),
    search: one(params.search),
    page: one(params.page),
  });

  let trail: AuditTrailPage | null = null;
  try {
    trail = await getAuditTrail(actor, filters);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!trail) {
    return (
      <Shell>
        <PageHeader title="Activity log" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view the activity log. Ask the account owner if you
          need access.
        </div>
      </Shell>
    );
  }

  const lastPage = Math.max(1, Math.ceil(trail.total / AUDIT_PAGE_SIZE));

  function withPage(next: number): string {
    const query = new URLSearchParams();
    if (trail!.category) {
      query.set("category", trail!.category);
    }
    if (trail!.search) {
      query.set("search", trail!.search);
    }
    query.set("page", String(next));
    return `/settings/audit?${query.toString()}`;
  }

  return (
    <Shell>
      <PageHeader
        title="Activity log"
        description="Every recorded change, oldest untouched."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Activity log" }]}
        meta={`${trail.total} record${trail.total === 1 ? "" : "s"} · nothing here can be edited or removed`}
      />

      <form method="get" className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            name="search"
            defaultValue={trail.search}
            placeholder="Search by who — name or email"
            className="min-h-11 w-full rounded-2xl bg-canvas py-2 pl-9 pr-3 text-input text-ink placeholder:text-faint border border-line"
          />
        </div>

        <div className="w-full sm:w-56">
          <Select
            id="audit-category"
            name="category"
            label="Category"
            isLabelHidden
            defaultValue={trail.category ?? ""}
          >
            <option value="">Decisions (default)</option>
            {trail.categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>

        <button
          type="submit"
          className="min-h-11 rounded-md bg-accent px-5 text-label font-semibold text-accent-ink transition hover:bg-accent-strong"
        >
          Apply
        </button>
      </form>

      {trail.entries.length === 0 ? (
        <div className="rounded-2xl bg-canvas px-6 py-10 text-center border border-line shadow-card">
          <p className="text-body font-medium text-muted">
            {trail.search || trail.category
              ? "Nothing matches those filters."
              : "Nothing has been recorded yet. Team changes, role changes and account decisions will appear here."}
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {trail.entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-xl bg-canvas px-5 py-4 border border-line shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-ink">
                      {entry.label}
                    </span>
                    {entry.byPlatform ? (
                      <StatusPill tone="neutral">
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className="h-3.5 w-3.5"
                          />
                          By MEDCARE PRO
                        </span>
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">
                        <span className="inline-flex items-center gap-1">
                          <Building2
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className="h-3.5 w-3.5"
                          />
                          {entry.actorName ?? "System"}
                        </span>
                      </StatusPill>
                    )}
                  </div>
                  <p className="mt-1 text-label text-muted">{entry.detail}</p>
                  {entry.reason && (
                    <p className="mt-1.5 text-label text-muted">
                      Reason: “{entry.reason}”
                    </p>
                  )}
                </div>

                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="shrink-0 text-label tnum text-faint"
                >
                  {entry.createdAt.toISOString().slice(0, 16).replace("T", "")}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-between text-label text-muted">
          <span>
            Page <span className="tnum">{trail.page}</span> of{""}
            <span className="tnum">{lastPage}</span>
          </span>
          <div className="flex gap-2">
            {trail.page > 1 && (
              <Link
                href={withPage(trail.page - 1)}
                className="rounded-md border border-line px-4 py-2 font-medium transition hover:border-accent hover:text-accent"
              >
                Previous
              </Link>
            )}
            {trail.page < lastPage && (
              <Link
                href={withPage(trail.page + 1)}
                className="rounded-md border border-line px-4 py-2 font-medium transition hover:border-accent hover:text-accent"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
