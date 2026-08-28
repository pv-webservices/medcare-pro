import type { ClinicScope } from "@/lib/rbac";

export interface DashboardScopeClinic {
  id: string;
  name: string;
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
