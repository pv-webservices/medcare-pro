import type { FeatureTier } from "@prisma/client";
import { BadRequestError } from "@/lib/apiHandler";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { isTenantEntitled } from "@/lib/featureResolution";
import { UNGATED_MODULES } from "@/lib/moduleFeatures";
import { prisma } from "@/lib/prisma";
import { ScopeError } from "@/lib/rbac";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import {
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  describeEntitlementDenial,
  evaluateGlobalSwitch,
  evaluatePlanFeature,
  evaluateReason,
} from "@/lib/platform/entitlementPolicy";
import { resolveEntitlementChanges } from "@/lib/platform/decisionPolicy";
import type { EntitlementRequest } from "@/lib/platform/decisionPolicy";
import type { PlatformActorContext } from "@/lib/platform/context";

/**
 * The Owner's side of the entitlement model — Stage 9, layers 1 and 2.
 *
 * Stage 8 built layers 3 and 4 and the enforcement that ANDs all four together,
 * but left layers 1 and 2 settable only by the seed, by the Stage 3 approval
 * screen, or by SQL. This is the module that closes that gap:
 *
 *   layer 1   Feature.globalEnabled     setFeatureGlobalEnabled
 *   layer 2a  PlanFeature               setPlanFeature
 *   layer 2b  TenantFeatureOverride     setTenantEntitlements
 *
 * WHY THIS IS NOT src/lib/features.ts. That module is tenant-scoped: every
 * function on it takes an `ActorContext` and reads one organisation. Everything
 * here takes a `PlatformActorContext` — which carries no `tenantId` and is
 * therefore not assignable to the other — and queries ACROSS tenants
 * explicitly, in the open, at the call site. Stage 0 decision 7 is what forbids
 * an `if (isOwner)` branch inside the tenant-scoped module instead.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT WRITE:
 *
 *   `RoleFeatureAccess`. When an Owner revokes a feature from an organisation,
 *   that organisation's per-role switches become moot — the resolver ANDs the
 *   layers, so layer 3 cannot re-grant what layer 2 took away. Deleting the rows
 *   would tidy the table and quietly destroy decisions a Tenant Admin made: if
 *   the feature came back, it would come back switched on for every role. A
 *   platform action must not rewrite a tenant's choices, so the rows stay and
 *   simply stop mattering.
 *
 *   `Feature.tier`, `Feature.key`, and the catalogue itself. Adding a feature is
 *   a code change (src/lib/defaultFeatures.ts) because a key nothing checks
 *   gates nothing — the same rule the permission catalogue keeps.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Who last changed something, resolved for display. */
interface ChangeStamp {
  at: Date | null;
  byName: string | null;
  reason: string | null;
}

export interface PlatformFeatureRow {
  key: string;
  name: string;
  description: string | null;
  tier: FeatureTier;
  /** Layer 1. */
  globalEnabled: boolean;
  lastChange: ChangeStamp;
  /**
   * Customer organisations entitled at layer 2 — i.e. how many lose the module
   * the moment layer 1 goes down. Ignores layer 1 itself, so the figure does not
   * collapse to zero as soon as the switch is off and stop being useful for
   * deciding whether to switch it back on.
   */
  entitledTenants: number;
  /** Plans that include it, by name, for the "who is affected" line. */
  plansIncluding: string[];
  /** Organisations carrying an explicit override, in each direction. */
  overridesGranted: number;
  overridesRevoked: number;
  /**
   * False when no code path checks this key — `settings` and `marketing`.
   * The switch still writes, because the column is real; the screen says so,
   * because an Owner flipping it during an incident must not believe they have
   * done something they have not.
   */
  isEnforced: boolean;
  enforcementNote: string | null;
}

export interface PlatformFeatureAdmin {
  features: PlatformFeatureRow[];
  totalCustomerTenants: number;
}

// ---------------------------------------------------------------------------
// Reading layers 1 and 2 across the platform
// ---------------------------------------------------------------------------

/**
 * Every tenant's plan, and every override, in two queries.
 *
 * Resolved in memory rather than by a per-feature aggregate query, because
 * "entitled" is not a column: it is a plan row that an override row may
 * contradict in either direction, and expressing that as SQL would mean one
 * correlated subquery per feature. MEDCARE PRO counts its organisations in the
 * hundreds; if that ever stops being true, this is the function to change and
 * the only one.
 */
async function loadEntitlementCensus() {
  const [tenants, overrides, planFeatures, plans] = await Promise.all([
    prisma.tenant.findMany({
      where: CUSTOMER_TENANT_WHERE,
      select: { id: true, planId: true },
    }),
    prisma.tenantFeatureOverride.findMany({
      // The reserved platform row is not a customer and must not be counted as
      // one, here or anywhere else.
      where: { tenant: CUSTOMER_TENANT_WHERE },
      select: { tenantId: true, featureId: true, enabled: true },
    }),
    prisma.planFeature.findMany({
      select: { planId: true, featureId: true, enabled: true },
    }),
    prisma.plan.findMany({ select: { id: true, name: true } }),
  ]);

  /** planId → featureId → enabled */
  const byPlan = new Map<string, Map<string, boolean>>();
  for (const row of planFeatures) {
    const features = byPlan.get(row.planId) ?? new Map<string, boolean>();
    features.set(row.featureId, row.enabled);
    byPlan.set(row.planId, features);
  }

  /** tenantId → featureId → enabled */
  const byTenant = new Map<string, Map<string, boolean>>();
  for (const row of overrides) {
    const features = byTenant.get(row.tenantId) ?? new Map<string, boolean>();
    features.set(row.featureId, row.enabled);
    byTenant.set(row.tenantId, features);
  }

  return {
    tenants,
    planNames: new Map(plans.map((plan) => [plan.id, plan.name])),
    planFeatures: byPlan,
    tenantOverrides: byTenant,
  };
}

type Census = Awaited<ReturnType<typeof loadEntitlementCensus>>;

/** How many customer organisations hold this feature at layer 2. */
function countEntitled(census: Census, featureId: string): number {
  let count = 0;

  for (const tenant of census.tenants) {
    const planEnabled = tenant.planId
      ? (census.planFeatures.get(tenant.planId)?.get(featureId) ?? null)
      : null;
    const override = census.tenantOverrides.get(tenant.id)?.get(featureId) ?? null;

    // The same predicate the runtime resolver uses, so the count cannot drift
    // from what the tenants actually experience.
    if (isTenantEntitled({ planEnabled, tenantOverride: override })) {
      count += 1;
    }
  }

  return count;
}

/**
 * The whole catalogue with its platform-wide switch and its blast radius.
 *
 * Takes the Owner context although it does not filter by it — same convention
 * as `getPlatformOverview`: the authorization becomes a required argument that
 * only `requirePlatformOwner()` can produce, rather than a call a reader has to
 * go and check happened.
 */
export async function getPlatformFeatureAdmin(
  _owner: PlatformActorContext,
): Promise<PlatformFeatureAdmin> {
  const [features, census] = await Promise.all([
    prisma.feature.findMany({
      orderBy: [{ tier: "asc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        tier: true,
        globalEnabled: true,
        globalChangedAt: true,
        globalChangeReason: true,
        globalChangedBy: { select: { name: true, email: true } },
      },
    }),
    loadEntitlementCensus(),
  ]);

  const rows = features.map((feature): PlatformFeatureRow => {
    const plansIncluding: string[] = [];
    for (const [planId, byFeature] of census.planFeatures) {
      if (byFeature.get(feature.id) === true) {
        plansIncluding.push(census.planNames.get(planId) ?? planId);
      }
    }

    let overridesGranted = 0;
    let overridesRevoked = 0;
    for (const byFeature of census.tenantOverrides.values()) {
      const value = byFeature.get(feature.id);
      if (value === true) {
        overridesGranted += 1;
      } else if (value === false) {
        overridesRevoked += 1;
      }
    }

    const enforcementNote = UNGATED_MODULES[feature.key] ?? null;

    return {
      key: feature.key,
      name: feature.name,
      description: feature.description,
      tier: feature.tier,
      globalEnabled: feature.globalEnabled,
      lastChange: {
        at: feature.globalChangedAt,
        byName: feature.globalChangedBy?.name ?? feature.globalChangedBy?.email ?? null,
        reason: feature.globalChangeReason,
      },
      entitledTenants: countEntitled(census, feature.id),
      plansIncluding: plansIncluding.sort(),
      overridesGranted,
      overridesRevoked,
      isEnforced: enforcementNote === null,
      enforcementNote,
    };
  });

  return { features: rows, totalCustomerTenants: census.tenants.length };
}

// ---------------------------------------------------------------------------
// Layer 1 — the platform-wide kill switch
// ---------------------------------------------------------------------------

export interface GlobalSwitchWriteInput {
  featureKey: string;
  enabled: boolean;
  reason?: string | null;
  /** The feature key, typed out. Required when switching off. */
  confirmation?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface GlobalSwitchOutcome {
  featureKey: string;
  featureName: string;
  enabled: boolean;
  /** Organisations whose access this change turned off, or restored. */
  affectedTenants: number;
  /** False for `settings` and `marketing` — the flip wrote, but gates nothing. */
  isEnforced: boolean;
}

/**
 * Flips `Feature.globalEnabled` for the whole platform.
 *
 * The single largest write available in this codebase: no tenant, no plan and
 * no role can reach past it, which is exactly what makes it useful during an
 * incident and dangerous the rest of the time. `evaluateGlobalSwitch` holds the
 * friction; this function holds the transaction.
 *
 * The audit row records the affected-organisation count as it stood BEFORE the
 * flip. After the flip that number is unrecoverable — the entitlements are
 * unchanged but every one of them is moot — and "how many clinics did this
 * affect" is the question asked afterwards.
 */
export async function setFeatureGlobalEnabled(
  owner: PlatformActorContext,
  input: GlobalSwitchWriteInput,
): Promise<GlobalSwitchOutcome> {
  const feature = await prisma.feature.findUnique({
    where: { key: input.featureKey },
    select: { id: true, key: true, name: true, globalEnabled: true },
  });

  if (!feature) {
    throw new BadRequestError("That feature does not exist.");
  }

  const verdict = evaluateGlobalSwitch({
    featureKey: feature.key,
    currentlyEnabled: feature.globalEnabled,
    requestedEnabled: input.enabled,
    reason: input.reason,
    confirmation: input.confirmation,
  });

  if (!verdict.allowed) {
    throw new BadRequestError(
      describeEntitlementDenial(verdict.denial!, feature.key),
    );
  }

  const census = await loadEntitlementCensus();
  const affectedTenants = countEntitled(census, feature.id);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.feature.update({
      where: { id: feature.id },
      data: {
        globalEnabled: input.enabled,
        globalChangedById: owner.userId,
        globalChangedAt: now,
        globalChangeReason: verdict.normalisedReason,
      },
    });

    await writeAuditLog(tx, {
      action: input.enabled
        ? AUDIT_ACTIONS.FEATURE_GLOBAL_ENABLED
        : AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED,
      targetType: "Feature",
      targetId: feature.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      // Null, not the reserved platform tenant's id: this is a platform-wide
      // act with no single organisation behind it.
      actorTenantId: null,
      reason: verdict.normalisedReason,
      beforeValue: { featureKey: feature.key, globalEnabled: feature.globalEnabled },
      afterValue: {
        featureKey: feature.key,
        globalEnabled: input.enabled,
        entitledTenantsAtChange: affectedTenants,
      },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });

  return {
    featureKey: feature.key,
    featureName: feature.name,
    enabled: input.enabled,
    affectedTenants,
    isEnforced: !(feature.key in UNGATED_MODULES),
  };
}

// ---------------------------------------------------------------------------
// Layer 2a — what a plan includes
// ---------------------------------------------------------------------------

export interface PlanAdminFeature {
  key: string;
  name: string;
  tier: FeatureTier;
  /** Layer 1, shown here because a plan cannot grant past it. */
  globalEnabled: boolean;
  included: boolean;
}

export interface PlanAdminRow {
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Customer organisations currently on this plan. */
  tenantCount: number;
  features: PlanAdminFeature[];
}

export async function getPlanAdmin(
  _owner: PlatformActorContext,
): Promise<PlanAdminRow[]> {
  const [plans, features, counts] = await Promise.all([
    prisma.plan.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isActive: true,
        features: { select: { featureId: true, enabled: true } },
      },
    }),
    prisma.feature.findMany({
      orderBy: [{ tier: "asc" }, { key: "asc" }],
      select: { id: true, key: true, name: true, tier: true, globalEnabled: true },
    }),
    prisma.tenant.groupBy({
      by: ["planId"],
      where: CUSTOMER_TENANT_WHERE,
      _count: { _all: true },
    }),
  ]);

  const tenantsByPlan = new Map(
    counts
      .filter((row): row is typeof row & { planId: string } => row.planId !== null)
      .map((row) => [row.planId, row._count._all]),
  );

  return plans.map((plan) => {
    const included = new Map(plan.features.map((row) => [row.featureId, row.enabled]));

    return {
      key: plan.key,
      name: plan.name,
      description: plan.description,
      isActive: plan.isActive,
      tenantCount: tenantsByPlan.get(plan.id) ?? 0,
      features: features.map((feature) => ({
        key: feature.key,
        name: feature.name,
        tier: feature.tier,
        globalEnabled: feature.globalEnabled,
        included: included.get(feature.id) === true,
      })),
    };
  });
}

export interface PlanFeatureWriteInput {
  planKey: string;
  featureKey: string;
  included: boolean;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PlanFeatureOutcome {
  planKey: string;
  featureKey: string;
  included: boolean;
  /**
   * Organisations on this plan that this change actually moved — i.e. excluding
   * any carrying an override for the feature, whose entitlement the plan does
   * not decide.
   */
  affectedTenants: number;
}

/**
 * Adds a feature to a plan, or takes it out.
 *
 * "Not included" DELETES the PlanFeature row rather than setting `enabled` to
 * false. Both read as "not entitled" through `isTenantEntitled`, so keeping a
 * disabled row would be a second way to say the same thing — and a plan that
 * says nothing about a feature is the honest description of a plan that does not
 * include it. See the note on `evaluatePlanFeature`.
 *
 * Takes effect IMMEDIATELY for every organisation on the plan that has no
 * override. That is what a plan is; the count is reported so the Owner sees the
 * scale before and after, and the reason is required on removal.
 */
export async function setPlanFeature(
  owner: PlatformActorContext,
  input: PlanFeatureWriteInput,
): Promise<PlanFeatureOutcome> {
  const [plan, feature] = await Promise.all([
    prisma.plan.findUnique({
      where: { key: input.planKey },
      select: { id: true, key: true, name: true, isActive: true },
    }),
    prisma.feature.findUnique({
      where: { key: input.featureKey },
      select: { id: true, key: true, name: true },
    }),
  ]);

  if (!plan) {
    throw new BadRequestError("That plan does not exist.");
  }
  if (!feature) {
    throw new BadRequestError("That feature does not exist.");
  }

  const existing = await prisma.planFeature.findUnique({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    select: { enabled: true },
  });

  const verdict = evaluatePlanFeature({
    currentlyIncluded: existing?.enabled === true,
    requestedIncluded: input.included,
    reason: input.reason,
  });

  if (!verdict.allowed) {
    throw new BadRequestError(
      describeEntitlementDenial(verdict.denial!, feature.key),
    );
  }

  // Organisations on this plan whose entitlement the plan actually decides. One
  // carrying an override is unmoved by this change in either direction, and
  // counting it would overstate the blast radius.
  const [onPlan, overridden] = await Promise.all([
    prisma.tenant.findMany({
      where: { ...CUSTOMER_TENANT_WHERE, planId: plan.id },
      select: { id: true },
    }),
    prisma.tenantFeatureOverride.findMany({
      where: { featureId: feature.id, tenant: { ...CUSTOMER_TENANT_WHERE, planId: plan.id } },
      select: { tenantId: true },
    }),
  ]);

  const overriddenIds = new Set(overridden.map((row) => row.tenantId));
  const affectedTenants = onPlan.filter((row) => !overriddenIds.has(row.id)).length;

  await prisma.$transaction(async (tx) => {
    if (input.included) {
      await tx.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
        create: { planId: plan.id, featureId: feature.id, enabled: true },
        update: { enabled: true },
      });
    } else {
      await tx.planFeature.deleteMany({
        where: { planId: plan.id, featureId: feature.id },
      });
    }

    await writeAuditLog(tx, {
      action: input.included
        ? AUDIT_ACTIONS.PLAN_FEATURE_ADDED
        : AUDIT_ACTIONS.PLAN_FEATURE_REMOVED,
      targetType: "Plan",
      targetId: plan.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      reason: verdict.normalisedReason,
      beforeValue: { planKey: plan.key, featureKey: feature.key, included: existing?.enabled === true },
      afterValue: {
        planKey: plan.key,
        featureKey: feature.key,
        included: input.included,
        tenantsFollowingPlan: affectedTenants,
      },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });

  return {
    planKey: plan.key,
    featureKey: feature.key,
    included: input.included,
    affectedTenants,
  };
}

// ---------------------------------------------------------------------------
// Layer 2b — one organisation's entitlements
// ---------------------------------------------------------------------------

export interface TenantEntitlementFeature {
  key: string;
  name: string;
  description: string | null;
  tier: FeatureTier;
  /** Layer 1 — false means no plan or override can reach it. */
  globalEnabled: boolean;
  /** Layer 2a — what the tenant's current plan grants. */
  planDefault: boolean;
  /** Layer 2b — the explicit decision, or null when the plan is being followed. */
  override: boolean | null;
  overrideReason: string | null;
  /** Layers 1 and 2 resolved: does the organisation have it right now? */
  effective: boolean;
  /** True when nothing checks the key, so the toggle changes no behaviour. */
  isEnforced: boolean;
}

export interface TenantEntitlementView {
  tenantId: string;
  clinicName: string;
  status: string;
  planKey: string | null;
  planName: string | null;
  plans: {
    key: string;
    name: string;
    isActive: boolean;
    features: { key: string; enabled: boolean }[];
  }[];
  features: TenantEntitlementFeature[];
}

/**
 * One organisation's entitlements, at any status.
 *
 * Deliberately not restricted to ACTIVE tenants: an Owner preparing an
 * organisation's plan before approving it, or adjusting a suspended one before
 * bringing it back, is doing ordinary work. Entitlements grant nothing on their
 * own — `requireActor()` already refuses every request from a non-ACTIVE tenant
 * — so there is no status at which editing them is unsafe.
 */
export async function getTenantEntitlements(
  _owner: PlatformActorContext,
  tenantId: string,
): Promise<TenantEntitlementView> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...CUSTOMER_TENANT_WHERE },
    select: {
      id: true,
      businessName: true,
      status: true,
      planId: true,
      plan: { select: { key: true, name: true } },
      featureOverrides: {
        select: { featureId: true, enabled: true, reason: true },
      },
    },
  });

  // Covers "no such tenant" and "that id is the reserved platform row" with one
  // indistinguishable answer, so neither can be probed for.
  if (!tenant) {
    throw new ScopeError();
  }

  const [features, plans] = await Promise.all([
    prisma.feature.findMany({
      orderBy: [{ tier: "asc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        tier: true,
        globalEnabled: true,
        plans: { select: { planId: true, enabled: true } },
      },
    }),
    prisma.plan.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        isActive: true,
        features: { select: { enabled: true, feature: { select: { key: true } } } },
      },
    }),
  ]);

  const overrides = new Map(
    tenant.featureOverrides.map((row) => [row.featureId, row]),
  );

  return {
    tenantId: tenant.id,
    clinicName: tenant.businessName,
    status: tenant.status,
    planKey: tenant.plan?.key ?? null,
    planName: tenant.plan?.name ?? null,
    plans: plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      isActive: plan.isActive,
      features: plan.features
        .filter((row) => row.enabled)
        .map((row) => ({ key: row.feature.key, enabled: true })),
    })),
    features: features.map((feature): TenantEntitlementFeature => {
      const planDefault =
        tenant.planId !== null &&
        feature.plans.some((row) => row.planId === tenant.planId && row.enabled);
      const override = overrides.get(feature.id);
      const tenantOverride = override ? override.enabled : null;

      return {
        key: feature.key,
        name: feature.name,
        description: feature.description,
        tier: feature.tier,
        globalEnabled: feature.globalEnabled,
        planDefault,
        override: tenantOverride,
        overrideReason: override?.reason ?? null,
        effective:
          feature.globalEnabled &&
          isTenantEntitled({ planEnabled: planDefault, tenantOverride }),
        isEnforced: !(feature.key in UNGATED_MODULES),
      };
    }),
  };
}

export interface TenantEntitlementWriteInput {
  tenantId: string;
  /** Omit to leave the plan alone. */
  planKey?: string | null;
  /** Features NOT mentioned are left exactly as they are. */
  features?: readonly EntitlementRequest[];
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface TenantEntitlementOutcome {
  tenantId: string;
  clinicName: string;
  planChanged: boolean;
  overridesSet: number;
  overridesCleared: number;
}

/**
 * Sets one organisation's plan and its per-feature overrides.
 *
 * The standalone counterpart to what the Stage 3 approval screen does inside a
 * decision, and it shares that screen's resolver: `resolveEntitlementChanges`
 * turns "here is what the Owner ticked" into the minimum set of rows, so a
 * choice that merely restates the plan CLEARS the override rather than pinning
 * it. That matters more here than at approval — a redundant override would
 * silently stop the organisation tracking its plan the next time the plan
 * changed, which is precisely the mechanism a later plan edit relies on.
 *
 * A feature the caller did not mention is untouched, so a partial submission is
 * safe. Layer-3 rows are never touched at all — see the note at the top.
 */
export async function setTenantEntitlements(
  owner: PlatformActorContext,
  input: TenantEntitlementWriteInput,
): Promise<TenantEntitlementOutcome> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, ...CUSTOMER_TENANT_WHERE },
    select: {
      id: true,
      businessName: true,
      planId: true,
      featureOverrides: {
        select: { enabled: true, feature: { select: { key: true } } },
      },
    },
  });

  if (!tenant) {
    throw new ScopeError();
  }

  // --- The plan ----------------------------------------------------------
  let planId = tenant.planId;
  const requestedPlanKey = input.planKey?.trim();

  if (requestedPlanKey) {
    const plan = await prisma.plan.findUnique({
      where: { key: requestedPlanKey },
      select: { id: true, isActive: true },
    });

    if (!plan) {
      throw new BadRequestError("That plan does not exist.");
    }
    // Same rule the approval screen keeps: a retired plan may be kept, never
    // moved onto. Retiring is how a plan is withdrawn without stripping the
    // organisations already paying for it.
    if (!plan.isActive && plan.id !== tenant.planId) {
      throw new BadRequestError("That plan has been retired. Choose another.");
    }
    planId = plan.id;
  }

  const planChanged = planId !== tenant.planId;

  // --- The overrides -----------------------------------------------------
  const [planFeatures, catalogue] = await Promise.all([
    planId
      ? prisma.planFeature.findMany({
          where: { planId },
          select: { enabled: true, feature: { select: { key: true } } },
        })
      : Promise.resolve([]),
    prisma.feature.findMany({ select: { id: true, key: true } }),
  ]);

  const resolved = resolveEntitlementChanges({
    requested: input.features ?? [],
    planDefaults: new Map(
      planFeatures.map((row) => [row.feature.key, row.enabled]),
    ),
    catalogue: new Set(catalogue.map((row) => row.key)),
    existingOverrides: new Map(
      tenant.featureOverrides.map((row) => [row.feature.key, row.enabled]),
    ),
  });

  if (resolved.unknownFeatureKeys.length > 0) {
    throw new BadRequestError("The submitted feature list is not valid.");
  }

  const nothingToDo =
    !planChanged &&
    resolved.overridesToSet.length === 0 &&
    resolved.overridesToClear.length === 0;

  if (nothingToDo) {
    return {
      tenantId: tenant.id,
      clinicName: tenant.businessName,
      planChanged: false,
      overridesSet: 0,
      overridesCleared: 0,
    };
  }

  // Stage 1's schema makes TenantFeatureOverride.reason non-null: an override
  // that contradicts the plan is exactly the kind of decision nobody can
  // reconstruct later without one.
  const reason = evaluateReason(input.reason, resolved.requiresReason);
  if (reason.denial) {
    throw new BadRequestError(
      reason.denial === "reason-required"
        ? `Overriding a plan's features requires a reason of at least ${MIN_REASON_LENGTH} characters.`
        : reason.denial === "reason-too-short"
          ? `Give a reason of at least ${MIN_REASON_LENGTH} characters.`
          : `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
    );
  }

  const featureIds = new Map(catalogue.map((row) => [row.key, row.id]));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (planChanged) {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { planId },
      });
    }

    for (const entry of resolved.overridesToSet) {
      const featureId = featureIds.get(entry.featureKey);
      if (!featureId) {
        throw new BadRequestError("The submitted feature list is not valid.");
      }

      await tx.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId } },
        create: {
          tenantId: tenant.id,
          featureId,
          enabled: entry.enabled,
          reason: reason.value ?? "",
          changedById: owner.userId,
          changedAt: now,
        },
        update: {
          enabled: entry.enabled,
          reason: reason.value ?? "",
          changedById: owner.userId,
          changedAt: now,
        },
      });
    }

    if (resolved.overridesToClear.length > 0) {
      await tx.tenantFeatureOverride.deleteMany({
        where: {
          tenantId: tenant.id,
          feature: { key: { in: [...resolved.overridesToClear] } },
        },
      });
    }

    // Same action name the approval screen writes, on purpose: a reader
    // following one organisation's entitlement history should see one sequence,
    // not two that have to be interleaved by timestamp.
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET,
      targetType: "Tenant",
      targetId: tenant.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      reason: reason.value,
      beforeValue: { planId: tenant.planId },
      afterValue: {
        planId,
        enabledFeatures: resolved.overridesToSet
          .filter((entry) => entry.enabled)
          .map((entry) => entry.featureKey),
        disabledFeatures: resolved.overridesToSet
          .filter((entry) => !entry.enabled)
          .map((entry) => entry.featureKey),
        clearedOverrides: [...resolved.overridesToClear],
      },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });

  return {
    tenantId: tenant.id,
    clinicName: tenant.businessName,
    planChanged,
    overridesSet: resolved.overridesToSet.length,
    overridesCleared: resolved.overridesToClear.length,
  };
}
