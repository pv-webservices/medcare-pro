import { Suspense } from "react";
import { redirect } from "next/navigation";
import RolesViewManager from "@/components/settings/RolesViewManager";
import PageHeader from "@/components/ui/PageHeader";
import Skeleton from "@/components/ui/Skeleton";
import { PermissionError } from "@/lib/rbac";
import { getRolesOverview, type RolesOverview } from "@/lib/roles";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Roles & permissions — PRD §6.8 (FR-8.1, FR-8.2).
//
// `role:read` gates the page and `role:manage` gates every control on it, both
// enforced in @/lib/roles rather than by hiding anything.
//
// Overview matching 02-roles-permission.png and permission manager matching
// 03-edit-permission.png, keeping all RBAC guarantees, grantable boundaries,
// and audit rules unchanged.

export default async function RolesSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  let overview: RolesOverview | null = null;
  try {
    overview = await getRolesOverview(actor);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!overview) {
    return (
      <section className="space-y-4">
        <PageHeader title="Roles & permissions" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view roles and permissions. Ask the account owner if
          you need access.
        </div>
      </section>
    );
  }

  return (
    <Suspense fallback={<RolesPageSkeleton />}>
      <RolesViewManager overview={overview} />
    </Suspense>
  );
}

function RolesPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-canvas-deep" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-44 rounded-3xl border border-line bg-canvas p-6 shadow-card"
          >
            <div className="flex items-center gap-3.5">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-24 rounded-lg" />
                <Skeleton className="h-3 w-32 rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
