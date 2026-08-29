import type { ClinicScope } from "@/lib/rbac";

export interface DashboardScopeClinic {
  id: string;
  name: string;
}

export const ADMIN_DASHBOARD_ACTION_PERMISSIONS = [
  "appointment:create",
  "registration:create",
  "doctor:create",
  "team:manage",
  "role:manage",
  "task:create",
  "task:manage",
] as const;

export const ADMIN_DASHBOARD_DATA_PERMISSIONS = [
  "dashboard:view",
  "dashboard:patients:view",
  "dashboard:appointments:view",
  "dashboard:revenue:view",
  "dashboard:doctors:view",
  "dashboard:messages:view",
  "dashboard:tasks:view",
  "dashboard:schedule:view",
  "dashboard:activity:view",
  "dashboard:team:view",
  "dashboard:clinics:view",
] as const;

export type AdminDashboardActionPermission =
  (typeof ADMIN_DASHBOARD_ACTION_PERMISSIONS)[number];
export type AdminDashboardDataPermission =
  (typeof ADMIN_DASHBOARD_DATA_PERMISSIONS)[number];

export interface AdminDashboardClinicAccess {
  dashboard: Readonly<Record<AdminDashboardDataPermission, string[]>>;
  actions: Readonly<Record<AdminDashboardActionPermission, string[]>>;
}

/**
 * Intersects a permission's server-resolved scope with tenant-owned clinics
 * and the user-editable clinic selection. A selection outside either set
 * matches nothing; it can never widen back to the account view.
 */
export function clinicIdsForDashboardScope(
  scope: ClinicScope | undefined,
  clinics: readonly DashboardScopeClinic[],
  selectedClinicId: string | null,
): string[] {
  if (!scope || scope.scope === "none") return [];

  const allowed =
    scope.scope === "all"
      ? clinics.map((clinic) => clinic.id)
      : clinics
          .filter((clinic) => scope.clinicIds.includes(clinic.id))
          .map((clinic) => clinic.id);

  return selectedClinicId
    ? allowed.filter((clinicId) => clinicId === selectedClinicId)
    : allowed;
}

/**
 * Resolves dashboard data and action scopes independently. `dashboard:view`
 * is the master data gate; selectedClinicId is applied inside the same
 * intersection and therefore can only narrow access.
 */
export function resolveAdminDashboardClinicAccess(
  scopes: ReadonlyMap<string, ClinicScope>,
  clinics: readonly DashboardScopeClinic[],
  selectedClinicId: string | null,
): AdminDashboardClinicAccess {
  const idsFor = (permission: string) =>
    clinicIdsForDashboardScope(
      scopes.get(permission),
      clinics,
      selectedClinicId,
    );
  const intersect = (left: readonly string[], right: readonly string[]) => {
    const rightIds = new Set(right);
    return left.filter((id) => rightIds.has(id));
  };
  const dashboardViewIds = idsFor("dashboard:view");

  return {
    dashboard: Object.fromEntries(
      ADMIN_DASHBOARD_DATA_PERMISSIONS.map((permission) => [
        permission,
        permission === "dashboard:view"
          ? dashboardViewIds
          : intersect(dashboardViewIds, idsFor(permission)),
      ]),
    ) as unknown as Record<AdminDashboardDataPermission, string[]>,
    actions: Object.fromEntries(
      ADMIN_DASHBOARD_ACTION_PERMISSIONS.map((permission) => [
        permission,
        idsFor(permission),
      ]),
    ) as unknown as Record<AdminDashboardActionPermission, string[]>,
  };
}
