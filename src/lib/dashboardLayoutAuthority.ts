import { WILDCARD } from "@/lib/permissions";
import { evaluateRoleGrantAuthority } from "@/lib/roleAuthority";

/** Pure role-default authority policy. The protected wildcard role is never a target. */
export function mayManageRoleDashboardDefault(options: {
  actorPermissions: ReadonlySet<string>;
  targetPermissions: readonly string[];
}): boolean {
  if (options.targetPermissions.includes(WILDCARD)) return false;
  return evaluateRoleGrantAuthority({
    actorPermissions: options.actorPermissions,
    targetPermissions: options.targetPermissions,
    isAccountOwner: options.actorPermissions.has(WILDCARD),
    tenantWide: false,
  }) === null;
}
