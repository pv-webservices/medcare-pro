import { WILDCARD } from "@/lib/permissions";

export type RoleGrantRefusal =
  | "tenant-wide-owner-only"
  | "owner-role-owner-only"
  | "beyond-actor-permissions"
  | "not-below-actor-authority";

/**
 * Permission-derived assignment authority. It deliberately uses neither role
 * names nor role keys: a non-owner may grant only a strict subset of what they
 * effectively hold in the target clinic, while tenant-wide and wildcard roles
 * remain reserved for an account-wide wildcard holder.
 */
export function evaluateRoleGrantAuthority(options: {
  actorPermissions: ReadonlySet<string>;
  targetPermissions: readonly string[];
  isAccountOwner: boolean;
  tenantWide: boolean;
}): RoleGrantRefusal | null {
  const { actorPermissions, targetPermissions } = options;

  if (options.tenantWide && !options.isAccountOwner) {
    return "tenant-wide-owner-only";
  }
  if (
    targetPermissions.includes(WILDCARD) &&
    !options.isAccountOwner
  ) {
    return "owner-role-owner-only";
  }
  if (options.isAccountOwner) {
    return null;
  }
  if (
    targetPermissions.some(
      (permission) => !actorPermissions.has(permission),
    )
  ) {
    return "beyond-actor-permissions";
  }

  const target = new Set(targetPermissions);
  const hasStrictlyMoreAuthority = [...actorPermissions].some(
    (permission) => permission !== WILDCARD && !target.has(permission),
  );
  return hasStrictlyMoreAuthority ? null : "not-below-actor-authority";
}
