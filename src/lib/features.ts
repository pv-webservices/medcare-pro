import type { FeatureTier } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError } from "@/lib/apiHandler";
import {
  FeatureError,
  isTenantEntitled,
  resolveModuleAccess,
  resolveTenantFeatureAccess,
  type FeatureResolution,
  type ModuleDenialReason,
} from "@/lib/featureResolution";
import {
  UNGATED_MODULES,
  type ModuleFeatureKey,
} from "@/lib/moduleFeatures";
import { prisma } from "@/lib/prisma";
import { WILDCARD } from "@/lib/permissions";
import {
  PermissionError,
  ScopeError,
  requirePermission,
  toPermissionList,
  type ActorContext,
} from "@/lib/rbac";

/**
 * Feature entitlements at runtime — Stage 8.
 *
 * src/lib/featureResolution.ts holds the precedence rule and stays pure. This
 * file is everything around it: loading the four layers out of the database,
 * folding layer 3 across the several roles one person may hold, and the two
 * screens' worth of read and write the Tenant Admin needs.
 *
 * WHY THIS IS NOT lib/rbac.ts. A permission answers "is this action allowed for
 * this person"; an entitlement answers "does this organisation have the module
 * the action lives in". They fail for different reasons, are fixed by different
 * people — your admin versus your account manager — and must be able to change
 * independently. Cancelling a plan should not rewrite anybody's role.
 *
 * THE TWO LOCKOUT GUARDS, both deliberate:
 *
 *   1. UNGATED_MODULES below is never feature-checked. Without that, switching
 *      the settings module off for every role would take away the very screen
 *      that could switch it back on, and the remedy would be SQL against a live
 *      database.
 *   2. A role holding the `*` wildcard is immune to layer 3 — enforced in the
 *      pure resolver, and mirrored here by refusing to write a row for such a
 *      role at all, so the screen never shows a switch that does nothing.
 *
 * Neither guard reaches layers 1 and 2. Those belong to the Platform Owner, and
 * an account owner is as subject to a kill switch as anybody else.
 */

// ---------------------------------------------------------------------------
// Loading the layers
// ---------------------------------------------------------------------------

interface TenantFeature {
  id: string;
  key: string;
  name: string;
  description: string | null;
  tier: FeatureTier;
  globalEnabled: boolean;
  /** Layer 2a — null when the plan does not list the feature at all. */
  planEnabled: boolean | null;
  /** Layer 2b — null when no override row exists. */
  tenantOverride: boolean | null;
}

interface ActorRole {
  id: string;
  name: string;
  holdsWildcard: boolean;
  /** featureId → the explicit layer-3 decision, where one has been made. */
  access: ReadonlyMap<string, boolean>;
}

/**
 * Layers 1 and 2 for every feature in the catalogue, for one organisation.
 *
 * Loaded whole rather than one key at a time: the navigation needs every answer
 * on every page load, and nine rows is cheaper to fetch once than to fetch
 * nine times.
 */
async function loadTenantFeatures(
  tenantId: string,
): Promise<Map<string, TenantFeature>> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { planId: true },
  });

  const [features, planFeatures, overrides] = await Promise.all([
    prisma.feature.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        tier: true,
        globalEnabled: true,
      },
      orderBy: { key: "asc" },
    }),
    tenant?.planId
      ? prisma.planFeature.findMany({
          where: { planId: tenant.planId },
          select: { featureId: true, enabled: true },
        })
      : Promise.resolve([]),
    prisma.tenantFeatureOverride.findMany({
      where: { tenantId },
      select: { featureId: true, enabled: true },
    }),
  ]);

  const planned = new Map(planFeatures.map((row) => [row.featureId, row.enabled]));
  const overridden = new Map(overrides.map((row) => [row.featureId, row.enabled]));

  return new Map(
    features.map((feature) => [
      feature.key,
      {
        ...feature,
        planEnabled: planned.has(feature.id) ? planned.get(feature.id)! : null,
        tenantOverride: overridden.has(feature.id)
          ? overridden.get(feature.id)!
          : null,
      },
    ]),
  );
}

/**
 * Layer 3, per role, for one person.
 *
 * A user may hold several roles — one account-wide, others scoped to a clinic —
 * and lib/rbac.ts already resolves permissions as "granted by ANY of them". The
 * same fold applies here, for the same reason: a receptionist who is also the
 * Beta branch manager should not lose the manager's modules at the front desk.
 *
 * Clinic scope is deliberately NOT part of this. RoleFeatureAccess has no
 * clinic column — an entitlement is something the organisation holds, not
 * something a branch holds — so a role grants its features wherever it applies.
 */
async function loadActorRoles(actor: ActorContext): Promise<ActorRole[]> {
  const assignments = await prisma.userRole.findMany({
    // Guards against a role assignment left over from a different tenant.
    where: { userId: actor.userId, role: { tenantId: actor.tenantId } },
    select: {
      role: {
        select: {
          id: true,
          name: true,
          permissions: true,
          featureAccess: { select: { featureId: true, enabled: true } },
        },
      },
    },
  });

  // A user can hold the same role twice — once account-wide, once for a clinic.
  const byId = new Map<string, ActorRole>();

  for (const { role } of assignments) {
    if (byId.has(role.id)) {
      continue;
    }
    byId.set(role.id, {
      id: role.id,
      name: role.name,
      holdsWildcard: toPermissionList(role.permissions).includes(WILDCARD),
      access: new Map(role.featureAccess.map((row) => [row.featureId, row.enabled])),
    });
  }

  return [...byId.values()];
}

/**
 * One feature's verdict for one person, folding layer 3 across their roles.
 *
 * ANY role that allows the module allows it, matching how permissions already
 * work. The refusal reported when every role denies is the LEAST alarming one
 * they hit — a role switch is a smaller problem than a cancelled plan, and
 * telling someone their plan is cancelled when one of their roles simply has
 * the module switched off would send them to the wrong person.
 */
function foldRoles(
  feature: TenantFeature,
  roles: readonly ActorRole[],
): FeatureResolution {
  const layers = {
    globalEnabled: feature.globalEnabled,
    planEnabled: feature.planEnabled,
    tenantOverride: feature.tenantOverride,
    tier: feature.tier,
  };

  // Someone with no roles at all is treated as one role with no opinion, so the
  // organisation's own layers still decide and a CORE module stays open.
  if (roles.length === 0) {
    return resolveModuleAccess({ ...layers, roleAccess: null, roleHoldsWildcard: false });
  }

  let worst: FeatureResolution | null = null;

  for (const role of roles) {
    const verdict = resolveModuleAccess({
      ...layers,
      roleAccess: role.access.has(feature.id) ? role.access.get(feature.id)! : null,
      roleHoldsWildcard: role.holdsWildcard,
    });

    if (verdict.allowed) {
      return verdict;
    }

    // "role" is the most local, most fixable reason, so it wins the reporting
    // even though every role refused for some reason or other.
    if (worst === null || verdict.reason === "role") {
      worst = verdict;
    }
  }

  return worst!;
}

/**
 * Missing from the catalogue entirely.
 *
 * FAILS CLOSED, and says so in the log. A feature key is a constant from our own
 * catalogue, never user input, so the only way to arrive here is an unseeded or
 * half-migrated database — in which case denying is right and quiet allowing
 * would mean enforcement had silently stopped working.
 */
function missingFeature(featureKey: string): FeatureResolution {
  console.error(
    `Feature "${featureKey}" is not in the features table. Run the Stage 1 seed; access is being denied until it is present.`,
  );
  return { allowed: false, reason: "entitlement" };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** Every feature's verdict for this person, keyed by feature key. */
export async function resolveModulesForActor(
  actor: ActorContext,
): Promise<Map<string, FeatureResolution>> {
  const [features, roles] = await Promise.all([
    loadTenantFeatures(actor.tenantId),
    loadActorRoles(actor),
  ]);

  return new Map(
    [...features.values()].map((feature) => [feature.key, foldRoles(feature, roles)]),
  );
}

/** Module verdicts for one tenant role, used to filter role-default widgets. */
export async function resolveModulesForRole(
  actor: ActorContext,
  roleId: string,
): Promise<Map<string, FeatureResolution>> {
  const [features, role] = await Promise.all([
    loadTenantFeatures(actor.tenantId),
    prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
      select: {
        permissions: true,
        featureAccess: { select: { featureId: true, enabled: true } },
      },
    }),
  ]);

  if (!role) {
    throw new ScopeError();
  }

  const access = new Map(role.featureAccess.map((row) => [row.featureId, row.enabled]));
  const holdsWildcard = toPermissionList(role.permissions).includes(WILDCARD);

  return new Map(
    [...features.values()].map((feature) => [
      feature.key,
      resolveModuleAccess({
        globalEnabled: feature.globalEnabled,
        planEnabled: feature.planEnabled,
        tenantOverride: feature.tenantOverride,
        tier: feature.tier,
        roleAccess: access.get(feature.id) ?? null,
        roleHoldsWildcard: holdsWildcard,
      }),
    ]),
  );
}

export async function resolveModuleForActor(
  actor: ActorContext,
  featureKey: string,
): Promise<FeatureResolution> {
  if (featureKey in UNGATED_MODULES) {
    return { allowed: true, reason: null };
  }

  const verdicts = await resolveModulesForActor(actor);
  return verdicts.get(featureKey) ?? missingFeature(featureKey);
}

/**
 * The call every gated API route and page load makes, alongside — never instead
 * of — its existing permission check.
 *
 * Order matters at the call sites: the feature check runs FIRST, so someone
 * whose organisation does not have a module is told that, rather than being
 * told they lack a permission they may well hold.
 */
export async function requireModule(
  actor: ActorContext,
  featureKey: ModuleFeatureKey,
): Promise<void> {
  const verdict = await resolveModuleForActor(actor, featureKey);

  if (!verdict.allowed) {
    throw new FeatureError(featureKey, verdict.reason as ModuleDenialReason);
  }
}

/**
 * Layers 1-2 only, for a trusted non-human channel such as a validated voice
 * webhook. It deliberately never loads RoleFeatureAccess or action permissions.
 */
export async function requireTenantFeatureEntitlement(
  tenantId: string,
  featureKey: ModuleFeatureKey,
): Promise<void> {
  const [tenant, feature] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planId: true },
    }),
    prisma.feature.findUnique({
      where: { key: featureKey },
      select: { id: true, globalEnabled: true },
    }),
  ]);

  if (!feature) {
    const verdict = missingFeature(featureKey);
    throw new FeatureError(
      featureKey,
      verdict.reason as ModuleDenialReason,
    );
  }

  const [planFeature, tenantOverride] = await Promise.all([
    tenant?.planId
      ? prisma.planFeature.findUnique({
          where: {
            planId_featureId: {
              planId: tenant.planId,
              featureId: feature.id,
            },
          },
          select: { enabled: true },
        })
      : Promise.resolve(null),
    prisma.tenantFeatureOverride.findUnique({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
      select: { enabled: true },
    }),
  ]);

  const verdict = resolveTenantFeatureAccess({
    globalEnabled: feature.globalEnabled,
    planEnabled: planFeature?.enabled ?? null,
    tenantOverride: tenantOverride?.enabled ?? null,
  });

  if (!verdict.allowed) {
    throw new FeatureError(
      featureKey,
      verdict.reason as ModuleDenialReason,
    );
  }
}

// ---------------------------------------------------------------------------
// The Features screen — `feature:view`
// ---------------------------------------------------------------------------

export type EntitlementSource =
  | "plan"
  | "override-granted"
  | "override-revoked"
  | "not-in-plan"
  | "plan-excludes"
  | "global-off";

export interface RoleFeatureRow {
  roleId: string;
  roleName: string;
  /** True when the role holds `*`, so layer 3 cannot touch it. */
  isAccountOwner: boolean;
  /** The stored decision: null means no row, i.e. inherit. */
  access: boolean | null;
  /** What the resolver actually returns for this role today. */
  isEffective: boolean;
  /** False when the switch would be a no-op, so the screen shows why. */
  isEditable: boolean;
}

export interface FeatureOverviewRow {
  key: string;
  name: string;
  description: string | null;
  tier: FeatureTier;
  /** Layers 1 and 2 together — does the organisation hold this at all? */
  isEntitled: boolean;
  entitlementSource: EntitlementSource;
  /** True when nothing checks this key. Explained by `ungatedNote`. */
  isUngated: boolean;
  ungatedNote: string | null;
  /** What an absent layer-3 row means for this tier. */
  inheritsWhenSilent: boolean;
  roles: RoleFeatureRow[];
}

export interface FeatureOverview {
  features: FeatureOverviewRow[];
  planName: string | null;
  canManage: boolean;
}

function describeEntitlement(feature: TenantFeature): EntitlementSource {
  if (!feature.globalEnabled) {
    return "global-off";
  }
  if (feature.tenantOverride === true) {
    return "override-granted";
  }
  if (feature.tenantOverride === false) {
    return "override-revoked";
  }
  if (feature.planEnabled === true) {
    return "plan";
  }
  return feature.planEnabled === false ? "plan-excludes" : "not-in-plan";
}

/**
 * Everything the Features screen shows: the organisation's entitlements, and
 * every role's switch within them.
 *
 * Reads across all of the tenant's roles, not just the caller's — this is an
 * administration screen, so it must show the switch for a role the caller does
 * not hold.
 */
export async function getFeatureOverview(
  actor: ActorContext,
): Promise<FeatureOverview> {
  await requirePermission(actor, "feature:view");

  const [features, roles, tenant, canManage] = await Promise.all([
    loadTenantFeatures(actor.tenantId),
    prisma.role.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        permissions: true,
        featureAccess: { select: { featureId: true, enabled: true } },
      },
    }),
    prisma.tenant.findUnique({
      where: { id: actor.tenantId },
      select: { plan: { select: { name: true } } },
    }),
    holdsFeatureManage(actor),
  ]);

  const rows = [...features.values()].map((feature): FeatureOverviewRow => {
    const isEntitled =
      feature.globalEnabled &&
      isTenantEntitled({
        planEnabled: feature.planEnabled,
        tenantOverride: feature.tenantOverride,
      });
    const ungatedNote = UNGATED_MODULES[feature.key] ?? null;
    const inheritsWhenSilent = feature.tier === "CORE";

    return {
      key: feature.key,
      name: feature.name,
      description: feature.description,
      tier: feature.tier,
      isEntitled,
      entitlementSource: describeEntitlement(feature),
      isUngated: ungatedNote !== null,
      ungatedNote,
      inheritsWhenSilent,
      roles: roles.map((role): RoleFeatureRow => {
        const holdsWildcard = toPermissionList(role.permissions).includes(WILDCARD);
        const stored = role.featureAccess.find(
          (entry) => entry.featureId === feature.id,
        );
        const access = stored ? stored.enabled : null;

        return {
          roleId: role.id,
          roleName: role.name,
          isAccountOwner: holdsWildcard,
          access,
          isEffective: resolveModuleAccess({
            globalEnabled: feature.globalEnabled,
            planEnabled: feature.planEnabled,
            tenantOverride: feature.tenantOverride,
            tier: feature.tier,
            roleAccess: access,
            roleHoldsWildcard: holdsWildcard,
          }).allowed,
          isEditable:
            canManage && isEntitled && !holdsWildcard && ungatedNote === null,
        };
      }),
    };
  });

  return {
    features: rows,
    planName: tenant?.plan?.name ?? null,
    canManage,
  };
}

async function holdsFeatureManage(actor: ActorContext): Promise<boolean> {
  try {
    await requirePermission(actor, "feature:manage");
    return true;
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The write — `feature:manage`
// ---------------------------------------------------------------------------

export const setRoleFeatureSchema = z.object({
  roleId: z.string().min(1, "Choose a role."),
  featureKey: z.string().min(1, "Choose a feature."),
  /** null clears the row, returning the role to inheriting the organisation. */
  enabled: z.boolean().nullable(),
});

export type SetRoleFeatureInput = z.infer<typeof setRoleFeatureSchema>;

/**
 * Writes, clears or flips one role's layer-3 switch.
 *
 * Everything this refuses, and why each refusal is not merely tidiness:
 *
 *   - a role from another tenant           — ScopeError (404), never 403, which
 *                                            would confirm the role exists;
 *   - a feature the organisation lacks     — writing `true` there would look
 *                                            like a grant and resolve to a
 *                                            denial, which is worse than an
 *                                            error;
 *   - a role holding the wildcard          — lockout guard 2; the switch cannot
 *                                            take effect, so it must not be
 *                                            offered or accepted;
 *   - an ungated feature                   — lockout guard 1; nothing checks the
 *                                            key, so the switch would be
 *                                            decorative.
 */
export async function setRoleFeatureAccess(
  actor: ActorContext,
  input: SetRoleFeatureInput,
): Promise<void> {
  await requirePermission(actor, "feature:manage");

  const role = await prisma.role.findFirst({
    where: { id: input.roleId, tenantId: actor.tenantId },
    select: { id: true, name: true, permissions: true },
  });

  if (!role) {
    throw new ScopeError();
  }

  if (toPermissionList(role.permissions).includes(WILDCARD)) {
    throw new BadRequestError(
      "The account owner's role always keeps every feature the organisation holds. Switching it off here would lock the account out of its own settings.",
    );
  }

  if (input.featureKey in UNGATED_MODULES) {
    throw new BadRequestError(
      `“${input.featureKey}” is always available and cannot be switched off for a role.`,
    );
  }

  const features = await loadTenantFeatures(actor.tenantId);
  const feature = features.get(input.featureKey);

  if (!feature) {
    throw new BadRequestError("That feature does not exist.");
  }

  if (
    !feature.globalEnabled ||
    !isTenantEntitled({
      planEnabled: feature.planEnabled,
      tenantOverride: feature.tenantOverride,
    })
  ) {
    throw new BadRequestError(
      "Your organisation does not have this feature, so it cannot be given to a role.",
    );
  }

  const existing = await prisma.roleFeatureAccess.findUnique({
    where: { roleId_featureId: { roleId: role.id, featureId: feature.id } },
    select: { enabled: true },
  });

  const before = existing ? existing.enabled : null;
  if (before === input.enabled) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (input.enabled === null) {
      await tx.roleFeatureAccess.deleteMany({
        where: { roleId: role.id, featureId: feature.id },
      });
    } else {
      await tx.roleFeatureAccess.upsert({
        where: { roleId_featureId: { roleId: role.id, featureId: feature.id } },
        create: { roleId: role.id, featureId: feature.id, enabled: input.enabled },
        update: { enabled: input.enabled },
      });
    }

    await writeAuditLog(tx, {
      action:
        input.enabled === null
          ? AUDIT_ACTIONS.ROLE_FEATURE_RESET
          : input.enabled
            ? AUDIT_ACTIONS.ROLE_FEATURE_ENABLED
            : AUDIT_ACTIONS.ROLE_FEATURE_DISABLED,
      targetType: "Role",
      targetId: role.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { featureKey: feature.key, enabled: before },
      afterValue: { featureKey: feature.key, enabled: input.enabled },
    });
  });
}


/**
 * The page-side counterpart to `requireModule`.
 *
 * Returns the refusal, or null when the module is open. Pages want the reason
 * rather than an exception so they can render `<ModuleLocked>` in place of the
 * screen — a thrown error inside a server component becomes a 500, which is a
 * worse answer than "your plan does not include this".
 */
export async function moduleLock(
  actor: ActorContext,
  featureKey: ModuleFeatureKey,
): Promise<ModuleDenialReason | null> {
  const verdict = await resolveModuleForActor(actor, featureKey);
  return verdict.allowed ? null : (verdict.reason as ModuleDenialReason);
}

// Re-exported so a route imports its guard and its key from one place.
export {
  MODULE_FEATURES,
  UNGATED_MODULES,
  CATALOGUE_FEATURE_KEYS,
  type ModuleFeatureKey,
} from "@/lib/moduleFeatures";
