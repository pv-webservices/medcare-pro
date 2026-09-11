import {
  PRE_APPOINTMENTS_ROLE_PERMISSIONS,
  PRE_DASHBOARD_ROLE_PERMISSIONS,
  PRE_DOCTOR_SELF_ROLE_PERMISSIONS,
  PRE_TASK_ROLE_PERMISSIONS,
  ROLE_KEYS,
  TASK_ROLE_TOP_UPS,
  type RoleKey,
} from "@/lib/defaultRoles";

export type DoctorSelfRoleClassification =
  | "ALREADY_CURRENT"
  | "KNOWN_PRE_APPOINTMENTS"
  | "KNOWN_POST_APPOINTMENTS"
  | "KNOWN_PRE_TASKS"
  | "KNOWN_PARTIAL_DASHBOARD_ROLLOUT"
  | "KNOWN_POST_TASKS"
  | "KNOWN_LEGACY_DASHBOARD_VOCABULARY"
  | "KNOWN_PRE_DASHBOARD_CUSTOMIZE"
  | "KNOWN_PRE_DOCTOR_SELF"
  | "CUSTOMIZED"
  | "UNKNOWN_SYSTEM_STATE"
  | "NON_SYSTEM_ROLE"
  | "NOT_TARGETED";

export type DoctorSelfRoleAction = "ALREADY_CURRENT" | "MIGRATE" | "SKIP";

export interface KnownDoctorPermissionSnapshot {
  classification: DoctorSelfRoleClassification;
  permissions: readonly string[];
  sourceConstant: string;
  safeToAutoMigrate: boolean;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((permission) => rightSet.has(permission))
  );
}

function replaceDashboardVocabulary(
  permissions: readonly string[],
): string[] {
  return permissions.flatMap((permission) => {
    if (permission === "dashboard:patients:view") {
      return ["dashboard:registrations:view"];
    }
    if (permission === "dashboard:messages:view") {
      return ["dashboard:notifications:view"];
    }
    if (permission === "dashboard:schedule:view") return [];
    return [permission];
  });
}

const preDoctorSelfDoctor =
  PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;

/**
 * Exact Doctor defaults that MEDCARE PRO previously seeded or produced through
 * its guarded role backfills. The pre-appointments state is recognized for
 * diagnostics only: this migration must not introduce appointment access into
 * a tenant that has not completed the AP-1 rollout.
 */
export const KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS: readonly KnownDoctorPermissionSnapshot[] =
  [
    {
      classification: "KNOWN_PRE_APPOINTMENTS",
      permissions: PRE_APPOINTMENTS_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR],
      sourceConstant: "PRE_APPOINTMENTS_ROLE_PERMISSIONS[DOCTOR]",
      safeToAutoMigrate: false,
    },
    {
      classification: "KNOWN_POST_APPOINTMENTS",
      permissions: PRE_DASHBOARD_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR],
      sourceConstant: "PRE_DASHBOARD_ROLE_PERMISSIONS[DOCTOR]",
      safeToAutoMigrate: true,
    },
    {
      classification: "KNOWN_PRE_TASKS",
      permissions: PRE_TASK_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR],
      sourceConstant: "PRE_TASK_ROLE_PERMISSIONS[DOCTOR]",
      safeToAutoMigrate: true,
    },
    {
      // This exact state exists in legacy tenants where the independent Tasks
      // and dashboard-layout permission stages landed on the post-AP-1 Doctor
      // role before the dashboard data-rights stage. Every member comes from a
      // frozen historical set/top-up; no permission is inferred from role name.
      classification: "KNOWN_PARTIAL_DASHBOARD_ROLLOUT",
      permissions: unique([
        ...PRE_DASHBOARD_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR],
        ...(TASK_ROLE_TOP_UPS[ROLE_KEYS.DOCTOR] ?? []),
        ...preDoctorSelfDoctor.filter(
          (permission) => permission === "dashboard:customize",
        ),
      ]),
      sourceConstant:
        "PRE_DASHBOARD_ROLE_PERMISSIONS[DOCTOR] + TASK_ROLE_TOP_UPS[DOCTOR] + historical dashboard layout top-up",
      safeToAutoMigrate: true,
    },
    {
      classification: "KNOWN_POST_TASKS",
      permissions: unique([
        ...PRE_TASK_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR],
        ...(TASK_ROLE_TOP_UPS[ROLE_KEYS.DOCTOR] ?? []),
      ]),
      sourceConstant:
        "PRE_TASK_ROLE_PERMISSIONS[DOCTOR] + TASK_ROLE_TOP_UPS[DOCTOR]",
      safeToAutoMigrate: true,
    },
    {
      classification: "KNOWN_LEGACY_DASHBOARD_VOCABULARY",
      permissions: replaceDashboardVocabulary(preDoctorSelfDoctor),
      sourceConstant:
        "PRE_DOCTOR_SELF_ROLE_PERMISSIONS[DOCTOR] mapped through the historical dashboard vocabulary",
      safeToAutoMigrate: true,
    },
    {
      classification: "KNOWN_PRE_DASHBOARD_CUSTOMIZE",
      permissions: preDoctorSelfDoctor.filter(
        (permission) => permission !== "dashboard:customize",
      ),
      sourceConstant:
        "PRE_DOCTOR_SELF_ROLE_PERMISSIONS[DOCTOR] without dashboard:customize",
      safeToAutoMigrate: true,
    },
    {
      classification: "KNOWN_PRE_DOCTOR_SELF",
      permissions: preDoctorSelfDoctor,
      sourceConstant: "PRE_DOCTOR_SELF_ROLE_PERMISSIONS[DOCTOR]",
      safeToAutoMigrate: true,
    },
  ];

export interface DoctorSelfRoleMigrationPlan {
  action: DoctorSelfRoleAction;
  classification: DoctorSelfRoleClassification;
  currentPermissions: readonly string[];
  nextPermissions: readonly string[];
  matchedSnapshot: KnownDoctorPermissionSnapshot | null;
  reason: string;
}

function replaceBroadDoctorRead(
  permissions: readonly string[],
): string[] {
  let selfReadAdded = permissions.includes("appointment:self:read");
  const next: string[] = [];

  for (const permission of permissions) {
    if (permission !== "appointment:read") {
      next.push(permission);
      continue;
    }
    if (!selfReadAdded) {
      next.push("appointment:self:read");
      selfReadAdded = true;
    }
  }

  return next;
}

function isRelatedToKnownSnapshot(permissions: readonly string[]): boolean {
  const held = new Set(permissions);
  return KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.some((snapshot) => {
    const known = new Set(snapshot.permissions);
    return (
      [...held].every((permission) => known.has(permission)) ||
      [...known].every((permission) => held.has(permission))
    );
  });
}

export function planDoctorSelfRoleMigration(input: {
  key: string | null;
  isSystem: boolean;
  permissions: readonly string[];
}): DoctorSelfRoleMigrationPlan {
  const currentPermissions = [...input.permissions];
  const base = {
    currentPermissions,
    nextPermissions: currentPermissions,
    matchedSnapshot: null,
  } as const;

  if (input.key === ROLE_KEYS.CLINIC_ADMIN) {
    if (currentPermissions.includes("appointment:self:read")) {
      return {
        ...base,
        action: "ALREADY_CURRENT",
        classification: "ALREADY_CURRENT",
        reason: "Clinic Admin already has self read; broad read remains unchanged.",
      };
    }
    const adminBefore = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.CLINIC_ADMIN];
    if (input.isSystem && adminBefore && sameSet(currentPermissions, adminBefore)) {
      return {
        ...base,
        action: "MIGRATE",
        classification: "KNOWN_PRE_DOCTOR_SELF",
        nextPermissions: [...currentPermissions, "appointment:self:read"],
        reason: "Known untouched Clinic Admin state; add self read and preserve broad read.",
      };
    }
    return {
      ...base,
      action: "SKIP",
      classification: input.isSystem ? "UNKNOWN_SYSTEM_STATE" : "NON_SYSTEM_ROLE",
      reason: "Clinic Admin state is not the exact known pre-doctor-self system default.",
    };
  }

  if (input.key !== ROLE_KEYS.DOCTOR) {
    return {
      ...base,
      action: "SKIP",
      classification: "NOT_TARGETED",
      reason: "Only Doctor and Clinic Admin roles are targeted.",
    };
  }

  const hasBroadRead = currentPermissions.includes("appointment:read");
  const hasSelfRead = currentPermissions.includes("appointment:self:read");
  if (hasSelfRead && !hasBroadRead) {
    return {
      ...base,
      action: "ALREADY_CURRENT",
      classification: "ALREADY_CURRENT",
      reason: "Doctor has self read and no broad appointment read.",
    };
  }

  if (!input.isSystem) {
    return {
      ...base,
      action: "SKIP",
      classification: "NON_SYSTEM_ROLE",
      reason: "Non-system Doctor roles are never changed automatically.",
    };
  }

  const matchedSnapshot =
    KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.find((snapshot) =>
      sameSet(currentPermissions, snapshot.permissions),
    ) ?? null;

  if (matchedSnapshot) {
    if (!matchedSnapshot.safeToAutoMigrate) {
      return {
        ...base,
        matchedSnapshot,
        action: "SKIP",
        classification: matchedSnapshot.classification,
        reason:
          "Known pre-appointments state; run and verify the AP-1 rollout before doctor-self migration.",
      };
    }
    return {
      ...base,
      matchedSnapshot,
      action: "MIGRATE",
      classification: matchedSnapshot.classification,
      nextPermissions: replaceBroadDoctorRead(currentPermissions),
      reason: "Exact known historical Doctor system-role state.",
    };
  }

  const classification = isRelatedToKnownSnapshot(currentPermissions)
    ? "CUSTOMIZED"
    : "UNKNOWN_SYSTEM_STATE";
  return {
    ...base,
    action: "SKIP",
    classification,
    reason:
      hasBroadRead && hasSelfRead
        ? "Broad and self read coexist in an unrecognized state; review required."
        : "Permission set does not exactly match any known historical seeded snapshot.",
  };
}

export function isRoleKey(value: string | null): value is RoleKey {
  return Object.values(ROLE_KEYS).includes(value as RoleKey);
}
