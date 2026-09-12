import snapshots from "@/lib/prePatientPortalRoles.json";
export const PRE_PATIENT_PORTAL_ROLES: Readonly<
  Record<string, readonly string[]>
> = snapshots.roles;
export function planPatientPortalRoleMigration(role: {
  key: string | null;
  isSystem: boolean;
  permissions: unknown;
}) {
  if (role.key !== "CLINIC_ADMIN" && role.key !== "RECEPTIONIST")
    return { status: "NOT_TARGETED", additions: [] as string[] };
  if (
    !Array.isArray(role.permissions) ||
    !role.permissions.every((p) => typeof p === "string")
  )
    return { status: "CUSTOMIZED_OR_OLDER", additions: [] as string[] };
  const held = new Set(role.permissions);
  if (held.has("patient_portal:manage"))
    return { status: "ALREADY_CURRENT", additions: [] as string[] };
  const before = PRE_PATIENT_PORTAL_ROLES[role.key];
  if (
    !role.isSystem ||
    role.permissions.length !== held.size ||
    held.size !== before.length ||
    !before.every((p) => held.has(p))
  )
    return { status: "CUSTOMIZED_OR_OLDER", additions: [] as string[] };
  return { status: "ELIGIBLE", additions: ["patient_portal:manage"] };
}
