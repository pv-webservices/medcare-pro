import { redirect } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import ActivityLogTable from "@/components/settings/ActivityLogTable";
import { PermissionError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import {
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
  return <section className="space-y-4">{children}</section>;
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
    module: one(params.module),
    decision: one(params.decision),
    role: one(params.role),
    userId: one(params.userId),
    period: one(params.period),
    pageSize: one(params.pageSize),
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
        <PageHeader
          title="Activity log"
          description="Track important actions performed across the system. Filter, search, and review activities."
          breadcrumbs={[
            { label: "Settings", href: "/settings" },
            { label: "Activity log" },
          ]}
        />
        <div className="rounded-2xl border border-line bg-canvas px-5 py-6 text-center text-body text-muted shadow-card">
          Your role cannot view the activity log. Ask the clinic administrator if
          you need access.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Activity log"
        description="Track important actions performed across the system. Filter, search, and review activities."
        breadcrumbs={[
          { label: "Settings", href: "/settings" },
          { label: "Activity log" },
        ]}
      />

      <ActivityLogTable
        entries={trail.entries}
        total={trail.total}
        page={trail.page}
        pageSize={trail.pageSize}
        metrics={trail.metrics}
        availableRoles={trail.availableRoles}
        availableUsers={trail.availableUsers}
        initialFilters={{
          search: trail.search,
          decision: trail.filters.decision,
          role: trail.filters.role,
          module: trail.filters.module,
          userId: trail.filters.userId,
          period: trail.filters.period,
        }}
      />
    </Shell>
  );
}
