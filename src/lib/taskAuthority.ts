import { WILDCARD } from "@/lib/permissions";

export type TaskAssignmentRefusal =
  | "different-tenant"
  | "missing-task-assign"
  | "clinic-out-of-scope"
  | "target-owner"
  | "target-not-below-actor"
  | "target-user-inactive";

/**
 * Pure, permission-derived task assignment authority.
 *
 * Role names and seeded role keys are intentionally absent. A non-owner may
 * assign only to a strict subset of their own effective permissions in the
 * selected clinic. A tenant-wide target is never below a clinic-scoped actor.
 */
export function canAssignTaskToUser(options: {
  actorPermissions: ReadonlySet<string>;
  targetPermissions: ReadonlySet<string>;
  isAccountOwner: boolean;
  sameTenant: boolean;
  actorHasTaskAssign: boolean;
  actorClinicScopeCoversTargetClinic: boolean;
  actorHasTenantWideAuthority: boolean;
  targetHasTenantWideAuthority: boolean;
  targetIsActive: boolean;
}): TaskAssignmentRefusal | null {
  if (!options.sameTenant) return "different-tenant";
  if (!options.actorHasTaskAssign) return "missing-task-assign";
  if (!options.actorClinicScopeCoversTargetClinic) return "clinic-out-of-scope";
  if (!options.targetIsActive) return "target-user-inactive";
  if (options.isAccountOwner) return null;
  if (options.targetPermissions.has(WILDCARD)) return "target-owner";

  if (
    options.targetHasTenantWideAuthority &&
    !options.actorHasTenantWideAuthority
  ) {
    return "target-not-below-actor";
  }

  const actorHasWildcard = options.actorPermissions.has(WILDCARD);
  if (
    !actorHasWildcard &&
    [...options.targetPermissions].some(
      (permission) => !options.actorPermissions.has(permission),
    )
  ) {
    return "target-not-below-actor";
  }

  const actorHasStrictlyMore =
    actorHasWildcard ||
    [...options.actorPermissions].some(
      (permission) => !options.targetPermissions.has(permission),
    );

  return actorHasStrictlyMore ? null : "target-not-below-actor";
}

export function mayViewTask(options: {
  isCreator: boolean;
  isAssignee: boolean;
  hasView: boolean;
  hasManage: boolean;
}): boolean {
  return options.hasManage || (options.hasView && (options.isCreator || options.isAssignee));
}

export function taskMutationAuthority(options: {
  isCreator: boolean;
  isAssignee: boolean;
  hasUpdate: boolean;
  hasComplete: boolean;
  hasDelete: boolean;
  hasManage: boolean;
}): { canEdit: boolean; canComplete: boolean; canArchive: boolean } {
  return {
    canEdit: options.hasManage || (options.isCreator && options.hasUpdate),
    canComplete: options.hasManage || (options.isAssignee && options.hasComplete),
    canArchive: options.hasManage || options.hasDelete,
  };
}
