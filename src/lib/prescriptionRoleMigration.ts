import snapshots from "@/lib/prePrescriptionRoles.json";
import { PRESCRIPTION_PERMISSIONS } from "@/lib/permissions";

/** Literal EP-0 snapshots: later catalogue additions cannot change eligibility. */
export const PRE_PRESCRIPTION_ROLE_PERMISSIONS: Readonly<
  Record<string, readonly string[]>
> = snapshots.roles;
export const PRESCRIPTION_ROLE_TOP_UPS: Readonly<
  Record<string, readonly string[]>
> = {
  CLINIC_ADMIN: PRESCRIPTION_PERMISSIONS,
  DOCTOR: ["prescription:read", "prescription:draft", "prescription:issue"],
};
export function planPrescriptionRoleMigration(role: {
  key: string | null;
  isSystem: boolean;
  permissions: unknown;
}) {
  const topUp = role.key ? PRESCRIPTION_ROLE_TOP_UPS[role.key] : undefined;
  if (!topUp) return { status: "NOT_TARGETED", additions: [] as string[] };
  if (
    !Array.isArray(role.permissions) ||
    !role.permissions.every((entry) => typeof entry === "string")
  )
    return { status: "CUSTOMIZED_OR_OLDER", additions: [] as string[] };
  const before = PRE_PRESCRIPTION_ROLE_PERMISSIONS[role.key!];
  const held = new Set(role.permissions);
  if (topUp.every((permission) => held.has(permission)))
    return { status: "ALREADY_CURRENT", additions: [] as string[] };
  if (
    !role.isSystem ||
    held.size !== before.length ||
    !before.every((permission) => held.has(permission))
  )
    return { status: "CUSTOMIZED_OR_OLDER", additions: [] as string[] };
  return {
    status: "ELIGIBLE",
    additions: topUp.filter((permission) => !held.has(permission)),
  };
}
