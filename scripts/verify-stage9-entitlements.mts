/**
 * Stage-9 verification — the Owner's entitlement layers, exercised against a
 * LOCAL database.
 *
 *     npm run verify:stage9
 *
 * The unit tests cover the rules, which are pure. What only a database can
 * answer is whether the three writes move the organisations they claim to move
 * and leave alone the ones they claim to leave alone — a kill switch reaching
 * every tenant, a plan edit reaching only the tenants on that plan, an override
 * reaching exactly one, and none of the three touching a Tenant Admin's own
 * per-role settings.
 *
 * WHAT THIS SCRIPT DELIBERATELY NEVER TOUCHES: the `standard` plan, and the
 * global switch on any feature a module actually checks. Real local tenants
 * follow that plan and would silently change underneath a developer's dev
 * server. Every layer-1 and layer-2a write below is aimed at a throwaway
 * feature and a throwaway plan this script creates and then deletes.
 *
 * The one exception is `settings`, which IS switched off and back on — because
 * proving Stage 8's lockout guard survives a Stage 9 kill switch is worth more
 * than the cost, and `settings` gates nothing, so the flip has no effect on
 * anything but the row itself. Its prior state is captured at build and
 * restored in the cleanup, whether or not the run succeeds.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { BadRequestError } from "@/lib/apiHandler";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { getFeatureOverview, resolveModuleForActor } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { ScopeError, type ActorContext } from "@/lib/rbac";
import { PLATFORM_TENANT_SLUG } from "@/lib/platformTenant";
import type { PlatformActorContext } from "@/lib/platform/context";
import {
  getPlanAdmin,
  getPlatformFeatureAdmin,
  getTenantEntitlements,
  setFeatureGlobalEnabled,
  setPlanFeature,
  setTenantEntitlements,
} from "@/lib/platform/entitlements";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

async function expectRefusal(
  label: string,
  contains: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(
      label,
      error instanceof BadRequestError && error.message.includes(contains),
      error,
    );
  }
}

async function expectThrows(
  label: string,
  is: (error: unknown) => boolean,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const TEST_TENANT_NAME = "verify-stage9";
const CORE_KEY = "verify-stage9-core";
const PREMIUM_KEY = "verify-stage9-premium";
const PLAN_KEY = "verify-stage9-plan";
const RETIRED_PLAN_KEY = "verify-stage9-retired";
const REASON = "Verification run — this row is deleted by the script's cleanup";

/** Captured at build so the cleanup can put the real row back exactly. */
let settingsBefore: {
  globalEnabled: boolean;
  globalChangedById: string | null;
  globalChangedAt: Date | null;
  globalChangeReason: string | null;
} | null = null;

async function build() {
  const stamp = Date.now();

  await seedFeatureCatalogue(prisma);

  settingsBefore = await prisma.feature.findUniqueOrThrow({
    where: { key: "settings" },
    select: {
      globalEnabled: true,
      globalChangedById: true,
      globalChangedAt: true,
      globalChangeReason: true,
    },
  });

  // Two throwaway features. CORE so an absent layer-3 row allows, PREMIUM so
  // the tier rule has something to bite on — and neither is in any real plan,
  // which is what makes the entitled-tenant counts below exactly countable.
  const core = await prisma.feature.upsert({
    where: { key: CORE_KEY },
    create: {
      key: CORE_KEY,
      name: "Verify Core",
      description: "Throwaway. Deleted by this script's cleanup.",
      tier: "CORE",
      globalEnabled: true,
    },
    update: { globalEnabled: true, globalChangeReason: null },
    select: { id: true },
  });

  const premium = await prisma.feature.upsert({
    where: { key: PREMIUM_KEY },
    create: {
      key: PREMIUM_KEY,
      name: "Verify Premium",
      description: "Throwaway. Deleted by this script's cleanup.",
      tier: "PREMIUM",
      globalEnabled: true,
    },
    update: { globalEnabled: true, globalChangeReason: null },
    select: { id: true },
  });

  // A throwaway plan, so no plan edit below can reach a real organisation.
  const plan = await prisma.plan.upsert({
    where: { key: PLAN_KEY },
    create: { key: PLAN_KEY, name: "Verify Plan", sortOrder: 900 },
    update: { isActive: true },
    select: { id: true },
  });

  const retiredPlan = await prisma.plan.upsert({
    where: { key: RETIRED_PLAN_KEY },
    create: {
      key: RETIRED_PLAN_KEY,
      name: "Verify Retired Plan",
      sortOrder: 901,
      isActive: false,
    },
    update: { isActive: false },
    select: { id: true },
  });

  await prisma.planFeature.upsert({
    where: { planId_featureId: { planId: plan.id, featureId: core.id } },
    create: { planId: plan.id, featureId: core.id, enabled: true },
    update: { enabled: true },
  });

  const standardPlan = await prisma.plan.findUniqueOrThrow({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });

  async function tenant(label: string, planId: string) {
    const row = await prisma.tenant.create({
      data: {
        businessName: TEST_TENANT_NAME,
        email: `${TEST_TENANT_NAME}-${label}-${stamp}@example.test`,
        slug: `${TEST_TENANT_NAME}-${label}-${stamp}`,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
        planId,
      },
      select: { id: true },
    });
    await seedDefaultRoles(prisma, row.id);
    return row.id;
  }

  // Two on the throwaway plan, one on the real standard plan. The third is the
  // control: no plan edit below may move it.
  const alpha = await tenant("alpha", plan.id);
  const beta = await tenant("beta", plan.id);
  const gamma = await tenant("gamma", standardPlan.id);

  const alphaRoles = await prisma.role.findMany({
    where: { tenantId: alpha },
    select: { id: true, name: true },
  });
  const alphaRole = (name: string) =>
    alphaRoles.find((role) => role.name === name)!.id;

  async function user(
    name: string,
    tenantId: string,
    roleId: string,
    platformRole: "SUPER_ADMIN" | null = null,
  ) {
    return prisma.user.create({
      data: {
        tenantId,
        name,
        email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${tenantId}@example.test`,
        passwordHash: "x",
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        platformRole,
        userRoles: { create: [{ roleId }] },
      },
      select: { id: true },
    });
  }

  const alphaOwner = await user("Alpha Owner", alpha, alphaRole("Owner"));
  const alphaStaff = await user("Alpha Staff", alpha, alphaRole("Staff"));

  // The acting Platform Owner. `requirePlatformOwner()` is what produces this
  // shape in the app and is verified by verify:owner; here it is built directly,
  // because what is under test is what an authorized Owner's writes DO, not
  // whether the door is locked.
  const ownerUser = await user(
    "Platform Owner",
    alpha,
    alphaRole("Owner"),
    "SUPER_ADMIN",
  );

  const owner: PlatformActorContext = {
    userId: ownerUser.id,
    platformRole: "SUPER_ADMIN",
    sessionId: "verify-stage9",
  };

  return {
    owner,
    coreId: core.id,
    premiumId: premium.id,
    planId: plan.id,
    retiredPlanId: retiredPlan.id,
    standardPlanId: standardPlan.id,
    alpha,
    beta,
    gamma,
    alphaStaffRoleId: alphaRole("Staff"),
    alphaOwnerActor: { userId: alphaOwner.id, tenantId: alpha } as ActorContext,
    alphaStaffActor: { userId: alphaStaff.id, tenantId: alpha } as ActorContext,
  };
}

/** One feature's row out of the platform admin view. */
async function featureRow(owner: PlatformActorContext, key: string) {
  const { features } = await getPlatformFeatureAdmin(owner);
  return features.find((feature) => feature.key === key)!;
}

async function auditCount(action: string, targetId: string): Promise<number> {
  return prisma.auditLog.count({ where: { action, targetId } });
}

async function main(): Promise<void> {
  const t = await build();

  // -------------------------------------------------------------------------
  console.log("\nReading the platform view");
  // -------------------------------------------------------------------------
  const admin = await getPlatformFeatureAdmin(t.owner);

  check(
    "every catalogue feature appears",
    admin.features.length >= 9,
    admin.features.length,
  );
  check(
    "the throwaway CORE feature is held by exactly the two tenants on its plan",
    admin.features.find((f) => f.key === CORE_KEY)?.entitledTenants === 2,
    admin.features.find((f) => f.key === CORE_KEY),
  );
  check(
    "it names the plan that includes it",
    admin.features.find((f) => f.key === CORE_KEY)?.plansIncluding.includes(
      "Verify Plan",
    ) === true,
  );
  check(
    "the throwaway PREMIUM feature is in no plan and held by nobody",
    admin.features.find((f) => f.key === PREMIUM_KEY)?.entitledTenants === 0,
  );
  check(
    "the reserved platform tenant is not counted as a customer",
    (await prisma.tenant.count({ where: { slug: PLATFORM_TENANT_SLUG } })) === 0 ||
      admin.totalCustomerTenants ===
        (await prisma.tenant.count({ where: { isPlatform: false } })),
  );
  check(
    "settings is reported as gating nothing, so a kill switch on it is honest",
    admin.features.find((f) => f.key === "settings")?.isEnforced === false,
  );
  check(
    "marketing is reported the same way, for a different stated reason",
    admin.features.find((f) => f.key === "marketing")?.isEnforced === false &&
      admin.features.find((f) => f.key === "marketing")?.enforcementNote !==
        admin.features.find((f) => f.key === "settings")?.enforcementNote,
  );
  check(
    "a module that IS checked is reported as enforced",
    admin.features.find((f) => f.key === "registrations")?.isEnforced === true,
  );

  // -------------------------------------------------------------------------
  console.log("\nLayer 1 — the platform-wide kill switch");
  // -------------------------------------------------------------------------
  await expectRefusal("a switch-off with no reason is refused", "reason", () =>
    setFeatureGlobalEnabled(t.owner, {
      featureKey: CORE_KEY,
      enabled: false,
      confirmation: CORE_KEY,
    }),
  );
  await expectRefusal(
    "a switch-off with no typed confirmation is refused",
    CORE_KEY,
    () =>
      setFeatureGlobalEnabled(t.owner, {
        featureKey: CORE_KEY,
        enabled: false,
        reason: REASON,
      }),
  );
  await expectRefusal(
    "a confirmation naming a different feature is refused",
    "does not match",
    () =>
      setFeatureGlobalEnabled(t.owner, {
        featureKey: CORE_KEY,
        enabled: false,
        reason: REASON,
        confirmation: "reports",
      }),
  );
  check(
    "and none of those refusals changed the switch",
    (await featureRow(t.owner, CORE_KEY)).globalEnabled,
  );

  const killed = await setFeatureGlobalEnabled(t.owner, {
    featureKey: CORE_KEY,
    enabled: false,
    reason: REASON,
    confirmation: CORE_KEY,
  });

  check("a complete switch-off is accepted", killed.enabled === false);
  check(
    "it reports how many organisations it took the module from",
    killed.affectedTenants === 2,
    killed,
  );

  const killedRow = await prisma.feature.findUniqueOrThrow({
    where: { key: CORE_KEY },
    select: {
      globalEnabled: true,
      globalChangedById: true,
      globalChangedAt: true,
      globalChangeReason: true,
    },
  });
  check("the column is off", killedRow.globalEnabled === false);
  check(
    "and it is stamped with who, when and why",
    killedRow.globalChangedById === t.owner.userId &&
      killedRow.globalChangedAt !== null &&
      killedRow.globalChangeReason === REASON,
    killedRow,
  );
  check(
    "an audit row records the disable",
    (await auditCount(AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED, t.coreId)) === 1,
  );

  const killAudit = await prisma.auditLog.findFirstOrThrow({
    where: { action: AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED, targetId: t.coreId },
    select: {
      afterValue: true,
      actorTenantId: true,
      actorPlatformRole: true,
      reason: true,
    },
  });
  check(
    "the audit row keeps the affected count, which is unrecoverable afterwards",
    (killAudit.afterValue as { entitledTenantsAtChange?: number })
      ?.entitledTenantsAtChange === 2,
    killAudit.afterValue,
  );
  check(
    "it is recorded as a platform act, belonging to no organisation",
    killAudit.actorTenantId === null && killAudit.actorPlatformRole === "SUPER_ADMIN",
  );

  const afterKill = await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY);
  check(
    "the account owner loses the module too — layer-3 immunity is not immunity from this",
    !afterKill.allowed && afterKill.reason === "global",
    afterKill,
  );
  check(
    "the entitlement count survives the kill, so it can inform switching back on",
    (await featureRow(t.owner, CORE_KEY)).entitledTenants === 2,
  );

  await expectRefusal(
    "switching it off again is refused as a no-op",
    "already the current setting",
    () =>
      setFeatureGlobalEnabled(t.owner, {
        featureKey: CORE_KEY,
        enabled: false,
        reason: REASON,
        confirmation: CORE_KEY,
      }),
  );
  await expectRefusal("switching it back on still needs a reason", "reason", () =>
    setFeatureGlobalEnabled(t.owner, { featureKey: CORE_KEY, enabled: true }),
  );

  const restored = await setFeatureGlobalEnabled(t.owner, {
    featureKey: CORE_KEY,
    enabled: true,
    reason: "Verification run — restoring the switch",
  });
  check("switching back on needs no typed confirmation", restored.enabled === true);
  check(
    "and access returns",
    (await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY)).allowed,
  );
  check(
    "an audit row records the enable, separately from the disable",
    (await auditCount(AUDIT_ACTIONS.FEATURE_GLOBAL_ENABLED, t.coreId)) === 1,
  );

  await expectRefusal("an unknown feature key is refused", "does not exist", () =>
    setFeatureGlobalEnabled(t.owner, {
      featureKey: "no-such-feature",
      enabled: false,
      reason: REASON,
      confirmation: "no-such-feature",
    }),
  );

  // -------------------------------------------------------------------------
  console.log("\nLayer 1 cannot cancel Stage 8's lockout guard");
  // -------------------------------------------------------------------------
  await setFeatureGlobalEnabled(t.owner, {
    featureKey: "settings",
    enabled: false,
    reason: REASON,
    confirmation: "settings",
  });
  check(
    "with settings switched off platform-wide, the settings module still opens",
    (await resolveModuleForActor(t.alphaOwnerActor, "settings")).allowed,
  );
  const overviewDuringKill = await getFeatureOverview(t.alphaOwnerActor);
  check(
    "and the organisation's own Features screen still renders, so nothing is unrecoverable",
    overviewDuringKill.features.length > 0,
  );
  check(
    "the switch reports itself as changing nothing, rather than pretending",
    (await featureRow(t.owner, "settings")).isEnforced === false,
  );
  await setFeatureGlobalEnabled(t.owner, {
    featureKey: "settings",
    enabled: true,
    reason: "Verification run — restoring the switch",
  });
  check(
    "settings is back on",
    (await featureRow(t.owner, "settings")).globalEnabled,
  );

  // -------------------------------------------------------------------------
  console.log("\nLayer 2a — what a plan includes");
  // -------------------------------------------------------------------------
  await expectRefusal("removing a feature from a plan needs a reason", "reason", () =>
    setPlanFeature(t.owner, {
      planKey: PLAN_KEY,
      featureKey: CORE_KEY,
      included: false,
    }),
  );

  const removed = await setPlanFeature(t.owner, {
    planKey: PLAN_KEY,
    featureKey: CORE_KEY,
    included: false,
    reason: REASON,
  });
  check("a reasoned removal is accepted", removed.included === false);
  check(
    "it reports how many organisations followed the plan into the change",
    removed.affectedTenants === 2,
    removed,
  );
  check(
    "the row is deleted rather than left disabled, so the plan says one thing",
    (await prisma.planFeature.count({
      where: { planId: t.planId, featureId: t.coreId },
    })) === 0,
  );
  check(
    "both organisations on the plan lose the module",
    !(await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY)).allowed &&
      (await getTenantEntitlements(t.owner, t.beta)).features.find(
        (f) => f.key === CORE_KEY,
      )?.effective === false,
  );
  check(
    "the organisation on a different plan is untouched",
    (await getTenantEntitlements(t.owner, t.gamma)).features.find(
      (f) => f.key === "registrations",
    )?.effective === true,
  );
  check(
    "an audit row records the removal against the plan",
    (await auditCount(AUDIT_ACTIONS.PLAN_FEATURE_REMOVED, t.planId)) === 1,
  );

  const added = await setPlanFeature(t.owner, {
    planKey: PLAN_KEY,
    featureKey: CORE_KEY,
    included: true,
  });
  check("adding it back needs no reason", added.included === true);
  check(
    "and both organisations have it again",
    (await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY)).allowed,
  );
  check(
    "an audit row records the addition",
    (await auditCount(AUDIT_ACTIONS.PLAN_FEATURE_ADDED, t.planId)) === 1,
  );

  await expectRefusal(
    "a plan change that changes nothing is refused",
    "already the current setting",
    () =>
      setPlanFeature(t.owner, {
        planKey: PLAN_KEY,
        featureKey: CORE_KEY,
        included: true,
      }),
  );
  await expectRefusal("an unknown plan is refused", "plan does not exist", () =>
    setPlanFeature(t.owner, {
      planKey: "no-such-plan",
      featureKey: CORE_KEY,
      included: true,
    }),
  );

  const planView = await getPlanAdmin(t.owner);
  const verifyPlan = planView.find((plan) => plan.key === PLAN_KEY)!;
  check("the plan screen counts its organisations", verifyPlan.tenantCount === 2);
  check(
    "and shows the throwaway feature as included",
    verifyPlan.features.find((f) => f.key === CORE_KEY)?.included === true,
  );
  check(
    "the retired plan is listed but marked retired",
    planView.find((plan) => plan.key === RETIRED_PLAN_KEY)?.isActive === false,
  );

  // -------------------------------------------------------------------------
  console.log("\nLayer 2b — one organisation");
  // -------------------------------------------------------------------------
  await expectRefusal(
    "granting a feature the plan omits needs a reason",
    "requires a reason",
    () =>
      setTenantEntitlements(t.owner, {
        tenantId: t.alpha,
        features: [{ featureKey: PREMIUM_KEY, enabled: true }],
      }),
  );

  const granted = await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: PREMIUM_KEY, enabled: true }],
    reason: REASON,
  });
  check("a reasoned grant is accepted", granted.overridesSet === 1);
  check(
    "the organisation now holds it",
    (await getTenantEntitlements(t.owner, t.alpha)).features.find(
      (f) => f.key === PREMIUM_KEY,
    )?.effective === true,
  );
  check(
    "its neighbour on the same plan does not",
    (await getTenantEntitlements(t.owner, t.beta)).features.find(
      (f) => f.key === PREMIUM_KEY,
    )?.effective === false,
  );
  check(
    "the override carries the reason the schema demands",
    (
      await prisma.tenantFeatureOverride.findFirstOrThrow({
        where: { tenantId: t.alpha, featureId: t.premiumId },
        select: { reason: true, changedById: true },
      })
    ).reason === REASON,
  );
  check(
    "an audit row records it under the same action the approval screen writes",
    (await auditCount(AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET, t.alpha)) === 1,
  );

  const noop = await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: PREMIUM_KEY, enabled: true }],
  });
  check(
    "re-saving the same screen writes nothing and demands no fresh reason",
    noop.overridesSet === 0 && noop.overridesCleared === 0,
    noop,
  );
  check(
    "and adds no second audit row",
    (await auditCount(AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET, t.alpha)) === 1,
  );

  const cleared = await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: PREMIUM_KEY, enabled: false }],
  });
  check(
    "a choice that agrees with the plan CLEARS the override rather than pinning it",
    cleared.overridesCleared === 1 && cleared.overridesSet === 0,
    cleared,
  );
  check(
    "so the organisation goes back to following its plan",
    (await prisma.tenantFeatureOverride.count({
      where: { tenantId: t.alpha, featureId: t.premiumId },
    })) === 0,
  );

  // A revoking override, to prove a plan addition does not reach past it.
  await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: CORE_KEY, enabled: false }],
    reason: REASON,
  });
  check(
    "a revoking override beats the plan that includes the feature",
    (await getTenantEntitlements(t.owner, t.alpha)).features.find(
      (f) => f.key === CORE_KEY,
    )?.effective === false,
  );
  const readdition = await setPlanFeature(t.owner, {
    planKey: PLAN_KEY,
    featureKey: CORE_KEY,
    included: false,
    reason: REASON,
  });
  check(
    "and a plan edit excludes it from the affected count, because the plan does not decide it",
    readdition.affectedTenants === 1,
    readdition,
  );
  await setPlanFeature(t.owner, {
    planKey: PLAN_KEY,
    featureKey: CORE_KEY,
    included: true,
  });
  check(
    "restoring the plan still does not reach the overridden organisation",
    (await getTenantEntitlements(t.owner, t.alpha)).features.find(
      (f) => f.key === CORE_KEY,
    )?.effective === false,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe plan on one organisation");
  // -------------------------------------------------------------------------
  const moved = await setTenantEntitlements(t.owner, {
    tenantId: t.beta,
    planKey: DEFAULT_PLAN_KEY,
  });
  check("an organisation can be moved to another plan", moved.planChanged);
  check(
    "and it follows the new plan immediately",
    (await getTenantEntitlements(t.owner, t.beta)).features.find(
      (f) => f.key === CORE_KEY,
    )?.effective === false,
  );
  await expectRefusal("a retired plan cannot be moved onto", "retired", () =>
    setTenantEntitlements(t.owner, {
      tenantId: t.beta,
      planKey: RETIRED_PLAN_KEY,
    }),
  );
  await setTenantEntitlements(t.owner, { tenantId: t.beta, planKey: PLAN_KEY });

  await expectRefusal("an unknown feature key is refused", "not valid", () =>
    setTenantEntitlements(t.owner, {
      tenantId: t.alpha,
      features: [{ featureKey: "no-such-feature", enabled: true }],
      reason: REASON,
    }),
  );
  await expectThrows(
    "an unknown tenant id is a 404, not a 400 — it must not be probeable",
    (error) => error instanceof ScopeError,
    () => setTenantEntitlements(t.owner, { tenantId: "no-such-tenant" }),
  );
  await expectThrows(
    "and reading one is refused the same way",
    (error) => error instanceof ScopeError,
    () => getTenantEntitlements(t.owner, "no-such-tenant"),
  );

  // -------------------------------------------------------------------------
  console.log("\nA revoke never rewrites the organisation's own settings");
  // -------------------------------------------------------------------------
  //
  // The approved Stage 9 decision. The layers are ANDed, so a layer-3 row has no
  // effect while the entitlement is gone — deleting it would tidy the table and
  // destroy a Tenant Admin's decision, so that restoring the feature handed it
  // to every role at once.
  await prisma.roleFeatureAccess.create({
    data: { roleId: t.alphaStaffRoleId, featureId: t.coreId, enabled: false },
  });
  check(
    "the staff role is switched off for the module, the owner is not",
    !(await resolveModuleForActor(t.alphaStaffActor, CORE_KEY)).allowed,
  );

  await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: CORE_KEY, enabled: false }],
    reason: REASON,
  });
  check(
    "revoking the feature leaves the per-role row exactly where it was",
    (await prisma.roleFeatureAccess.count({
      where: { roleId: t.alphaStaffRoleId, featureId: t.coreId },
    })) === 1,
  );
  check(
    "everyone is denied while it is revoked, for the entitlement reason",
    (await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY)).reason ===
      "entitlement",
  );

  await setTenantEntitlements(t.owner, {
    tenantId: t.alpha,
    features: [{ featureKey: CORE_KEY, enabled: true }],
  });
  check(
    "restoring it restores the admin's choice rather than opening the module to everyone",
    (await resolveModuleForActor(t.alphaOwnerActor, CORE_KEY)).allowed &&
      !(await resolveModuleForActor(t.alphaStaffActor, CORE_KEY)).allowed,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe Owner surface answers to nothing but the Owner role");
  // -------------------------------------------------------------------------
  await setFeatureGlobalEnabled(t.owner, {
    featureKey: CORE_KEY,
    enabled: false,
    reason: REASON,
    confirmation: CORE_KEY,
  });
  check(
    "with a feature killed, the platform screens still load — they are not feature-gated",
    (await getPlatformFeatureAdmin(t.owner)).features.length > 0 &&
      (await getPlanAdmin(t.owner)).length > 0,
  );
  await setFeatureGlobalEnabled(t.owner, {
    featureKey: CORE_KEY,
    enabled: true,
    reason: "Verification run — restoring the switch",
  });
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    // The real `settings` row goes back exactly as it was, whether or not the
    // run reached the end. It gates nothing, so a stray switch would be
    // harmless — but a stray reason in a column a human reads would not be.
    if (settingsBefore) {
      await prisma.feature.update({
        where: { key: "settings" },
        data: settingsBefore,
      });
    }

    const stale = await prisma.tenant.findMany({
      where: { businessName: TEST_TENANT_NAME },
      select: { id: true },
    });
    const tenantIds = stale.map((tenant) => tenant.id);
    const userIds = (
      await prisma.user.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { id: true },
      })
    ).map((user) => user.id);

    // AuditLog holds RESTRICT foreign keys onto both actors — deliberately, so
    // the trail outlives what it describes. Its rows therefore go first, or
    // nothing behind them can be deleted at all.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorUserId: { in: userIds } }, { actorTenantId: { in: tenantIds } }],
      },
    });

    for (const id of tenantIds) {
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    // Plans only after the tenants pointing at them, which is what the Restrict
    // foreign key on Tenant.planId is there to insist on.
    await prisma.feature.deleteMany({ where: { key: { in: [CORE_KEY, PREMIUM_KEY] } } });
    await prisma.plan.deleteMany({
      where: { key: { in: [PLAN_KEY, RETIRED_PLAN_KEY] } },
    });

    const residue =
      (await prisma.tenant.count({ where: { businessName: TEST_TENANT_NAME } })) +
      (await prisma.feature.count({ where: { key: { in: [CORE_KEY, PREMIUM_KEY] } } })) +
      (await prisma.plan.count({
        where: { key: { in: [PLAN_KEY, RETIRED_PLAN_KEY] } },
      }));
    if (residue > 0) {
      failures += 1;
      console.error(`\nCleanup left ${residue} row(s) behind.`);
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
