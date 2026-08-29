import { redirect } from "next/navigation";
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
    <section className="space-y-5">
      <PageHeader
        title="Roles & permissions"
        description="Define what each role can see and change."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Roles & permissions" }]}
        meta={overview.canManage
            ? "Create roles, choose what each one can do, and assign them to users."
            : "You can see roles and who holds them, but not change them."}
      />

      <div className="mb-5">
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
        canAssignAccountWide={overview.canAssignAccountWide}
      />
    </section>
  );
}
