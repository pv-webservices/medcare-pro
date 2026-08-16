import { redirect } from "next/navigation";
import RoleList from "@/components/settings/RoleList";
import UserRoleAssignments from "@/components/settings/UserRoleAssignments";
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
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Roles &amp; permissions</h1>
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot view roles and permissions. Ask the account owner if
          you need access.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Roles &amp; permissions</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {overview.canManage
            ? "Create roles, choose what each one can do, and assign them to users."
            : "You can see roles and who holds them, but not change them."}
        </p>
      </div>

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
