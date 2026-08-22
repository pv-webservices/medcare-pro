import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import RoleList from "@/components/settings/RoleList";
import UserRoleAssignments from "@/components/settings/UserRoleAssignments";
import PageHeader from "@/components/ui/PageHeader";
import { PermissionError } from "@/lib/rbac";
import { getRolesOverview, type RolesOverview } from "@/lib/roles";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Roles — PRD §6.8 (FR-8.1, FR-8.2): create roles, assign with optional clinic scope.
//
// `role:read` gates the page and `role:manage` gates every control on it, both
// enforced in @/lib/roles rather than by hiding anything: reaching this URL
// directly gets the same refusal the API gives.
//
// PRD §4 lists role management under the Owner only, so the seeded Admin does
// not hold either permission. They are ordinary strings, though — an Owner can
// put them on a custom role, which is what "not a hardcoded enum" means.

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
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-label font-medium text-slate-500 transition hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        Settings
      </Link>
        <PageHeader title="Roles & permissions" />
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
          Your role cannot view roles and permissions. Ask the account owner if
          you need access.
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-8">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-label font-medium text-slate-500 transition hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        Settings
      </Link>
      <PageHeader
        title="Roles & permissions"
        meta={overview.canManage
            ? "Create roles, choose what each one can do, and assign them to users."
            : "You can see roles and who holds them, but not change them."}
      />

      <div className="mb-8">
        <RoleList
          roles={overview.roles}
          grantablePermissions={overview.grantablePermissions}
          canManage={overview.canManage}
        />
      </div>

      <UserRoleAssignments
        users={overview.users}
        roles={overview.roles}
        clinics={overview.clinics}
        canManage={overview.canManage}
      />
    </section>
  );
}
