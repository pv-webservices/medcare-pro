/**
 * Stage-8 verification — feature entitlements, exercised against a LOCAL
 * database.
 *
 *     npm run verify:stage8
 *
 * The unit tests cover the precedence rule and the module map, both pure. What
 * only a database can answer is whether the four layers actually compose the
 * way the diagram says when there are real plans, real overrides and a person
 * holding three roles at once.
 *
 * Almost everything here is written from the direction someone would push on
 * it: a Tenant Admin trying to reach past a kill switch, trying to grant a
 * feature the plan omits, trying to take the settings screen away from the
 * account owner, and the one case that matters most — whether existing roles
 * keep working the day enforcement is switched on.
 *
 * This script WRITES LAYERS 1 AND 2 DIRECTLY. There is no in-app way to set a
 * kill switch or an override until Stage 9, and enforcement that honours them
 * cannot be proven without them.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { BadRequestError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { findPermission } from "@/lib/permissions";
import { ScopeError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import {
  MODULE_FEATURES,
  UNGATED_MODULES,
  getFeatureOverview,
  moduleLock,
  requireModule,
  resolveModuleForActor,
  resolveModulesForActor,
  setRoleFeatureAccess,
} from "@/lib/features";
import { visibleNavLinks } from "@/lib/navigation";

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

async function expectFeatureRefusal(
  label: string,
  reason: "global" | "entitlement" | "role",
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, error instanceof FeatureError && error.reason === reason, error);
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

const TEST_TENANT_NAME = "verify-stage8";

/** A throwaway feature, so the real catalogue is never edited by a test. */
const PREMIUM_KEY = "verify-stage8-premium";

async function build() {
  const stamp = Date.now();

  await seedFeatureCatalogue(prisma);

  const plan = await prisma.plan.findUniqueOrThrow({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });

  // A PREMIUM feature nobody's plan includes, to exercise the tier rule and the
  // override without touching a real catalogue row.
  const premium = await prisma.feature.upsert({
    where: { key: PREMIUM_KEY },
    create: {
      key: PREMIUM_KEY,
      name: "Verify Premium",
      description: "Throwaway. Deleted by this script's cleanup.",
      tier: "PREMIUM",
      globalEnabled: true,
    },
    update: {},
    select: { id: true },
  });

  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${stamp}@example.test`,
      slug: `${TEST_TENANT_NAME}-${stamp}`,
      emailVerifiedAt: new Date(),
      planId: plan.id,
    },
    select: { id: true },
  });

  // A second organisation, so every isolation check has a real neighbour whose
  // entitlements must not move when this one's do.
  const rival = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-rival-${stamp}@example.test`,
      slug: `${TEST_TENANT_NAME}-rival-${stamp}`,
      emailVerifiedAt: new Date(),
      planId: plan.id,
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Alpha Clinic" },
    select: { id: true },
  });

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

  const rivalOwnerRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: rival.id, name: "Owner" },
    select: { id: true },
  });

  // Holds feature:view and feature:manage but not the wildcard, so the two
  // lockout guards have something to refuse.
  const featureAdminRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Feature Admin",
      permissions: [
        "feature:view",
        "feature:manage",
        "registration:read",
        "report:read",
        "team:view",
      ],
    },
    select: { id: true },
  });

  async function user(
    name: string,
    assignments: { roleId: string; clinicId?: string }[],
    tenantId = tenant.id,
  ): Promise<ActorContext> {
    const created = await prisma.user.create({
      data: {
        tenantId,
        name,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${tenantId}@example.test`,
        passwordHash: "x",
        userRoles: { create: assignments },
      },
      select: { id: true },
    });
    return { userId: created.id, tenantId };
  }

  return {
    tenantId: tenant.id,
    rivalTenantId: rival.id,
    clinicId: clinic.id,
    premiumId: premium.id,
    planId: plan.id,
    staffRoleId: roleId("Staff"),
    receptionistRoleId: roleId("Receptionist"),
    ownerRoleId: roleId("Owner"),
    adminRoleId: roleId("Admin"),
    featureAdminRoleId: featureAdminRole.id,
    rivalOwnerRoleId: rivalOwnerRole.id,
    ownerActor: await user("Owner", [{ roleId: roleId("Owner") }]),
    adminActor: await user("Admin", [{ roleId: roleId("Admin") }]),
    staffActor: await user("Front Desk", [
      { roleId: roleId("Staff"), clinicId: clinic.id },
    ]),
    featureAdminActor: await user("Feature Admin", [
      { roleId: featureAdminRole.id },
    ]),
    // Two roles at once: one that will have registrations switched off, one
    // that will not. The fold must let the second one through.
    dualActor: await user("Dual Role", [
      { roleId: roleId("Staff"), clinicId: clinic.id },
      { roleId: roleId("Receptionist") },
    ]),
    rivalOwnerActor: await user("Rival Owner", [{ roleId: rivalOwnerRole.id }], rival.id),
  };
}

/** Layer 3, written straight to the table — the state a screen would produce. */
async function setRoleAccess(
  roleId: string,
  featureKey: string,
  enabled: boolean | null,
): Promise<void> {
  const feature = await prisma.feature.findUniqueOrThrow({
    where: { key: featureKey },
    select: { id: true },
  });

  if (enabled === null) {
    await prisma.roleFeatureAccess.deleteMany({
      where: { roleId, featureId: feature.id },
    });
    return;
  }

  await prisma.roleFeatureAccess.upsert({
    where: { roleId_featureId: { roleId, featureId: feature.id } },
    create: { roleId, featureId: feature.id, enabled },
    update: { enabled },
  });
}

async function main(): Promise<void> {
  const t = await build();

  console.log("\nThe catalogue records what is now enforced");
  check(
    "feature:view is no longer marked pending",
    findPermission("feature:view")?.pending === undefined,
  );
  check(
    "feature:manage is no longer marked pending",
    findPermission("feature:manage")?.pending === undefined,
  );

  console.log("\nEnforcement day: nothing an existing organisation had is lost");
  // The single most consequential property in this stage. Every seeded role,
  // every gated module, no RoleFeatureAccess rows anywhere — exactly the state
  // the Stage 1 backfill leaves behind.
  const beforeAnyRows = await prisma.roleFeatureAccess.count({
    where: { role: { tenantId: t.tenantId } },
  });
  check("the fixture starts with no layer-3 rows", beforeAnyRows === 0, beforeAnyRows);

  for (const [label, actor] of [
    ["the owner", t.ownerActor],
    ["the admin", t.adminActor],
    ["front-desk staff", t.staffActor],
  ] as const) {
    const modules = await resolveModulesForActor(actor);
    const denied = Object.values(MODULE_FEATURES).filter(
      (key) => modules.get(key)?.allowed !== true,
    );
    check(`${label} keeps every gated module`, denied.length === 0, denied);
  }

  console.log("\nLayer 3 — the Tenant Admin's switch");
  await setRoleAccess(t.staffRoleId, "registrations", false);
  await expectFeatureRefusal(
    "switching registrations off closes it for that role",
    "role",
    () => requireModule(t.staffActor, MODULE_FEATURES.registrations),
  );
  check(
    "and leaves that role's other modules alone",
    (await resolveModuleForActor(t.staffActor, "doctors")).allowed,
  );
  check(
    "and does not touch anybody else's",
    (await resolveModuleForActor(t.adminActor, "registrations")).allowed,
  );

  console.log("\nSeveral roles fold as ANY, matching how permissions already work");
  check(
    "a second role that still has the module lets the person through",
    (await resolveModuleForActor(t.dualActor, "registrations")).allowed,
  );
  await setRoleAccess(t.receptionistRoleId, "registrations", false);
  const bothOff = await resolveModuleForActor(t.dualActor, "registrations");
  check(
    "switching it off for every role they hold finally closes it",
    !bothOff.allowed && bothOff.reason === "role",
    bothOff,
  );
  await setRoleAccess(t.receptionistRoleId, "registrations", null);
  await setRoleAccess(t.staffRoleId, "registrations", null);
  check(
    "clearing the rows returns them to inheriting",
    (await resolveModuleForActor(t.staffActor, "registrations")).allowed,
  );

  console.log("\nThe tier rule — the change STAGE1_NOTES made binding on Stage 8");
  // The throwaway PREMIUM feature is not in any plan yet, so it must refuse at
  // the entitlement layer first.
  const premiumBefore = await resolveModuleForActor(t.ownerActor, PREMIUM_KEY);
  check(
    "an unsold premium feature refuses at the entitlement layer",
    !premiumBefore.allowed && premiumBefore.reason === "entitlement",
    premiumBefore,
  );

  // Sell it to this one organisation, and nobody else.
  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: t.tenantId,
      featureId: t.premiumId,
      enabled: true,
      reason: "verify-stage8: proving an override grants what the plan omits",
    },
  });

  const premiumForStaff = await resolveModuleForActor(t.staffActor, PREMIUM_KEY);
  check(
    "buying it does NOT hand it to every role at once",
    !premiumForStaff.allowed && premiumForStaff.reason === "role",
    premiumForStaff,
  );
  check(
    "but the account owner has it immediately, being immune to layer 3",
    (await resolveModuleForActor(t.ownerActor, PREMIUM_KEY)).allowed,
  );

  await setRoleAccess(t.staffRoleId, PREMIUM_KEY, true);
  check(
    "and an explicit grant opens it for a named role",
    (await resolveModuleForActor(t.staffActor, PREMIUM_KEY)).allowed,
  );
  check(
    "while a role nobody named still does not have it",
    !(await resolveModuleForActor(t.adminActor, PREMIUM_KEY)).allowed,
  );

  console.log("\nThe override beats the plan, and only for the tenant it names");
  check(
    "the neighbouring organisation is untouched by the override",
    !(await resolveModuleForActor(t.rivalOwnerActor, PREMIUM_KEY)).allowed,
  );

  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: t.tenantId,
      featureId: (await prisma.feature.findUniqueOrThrow({
        where: { key: "reports" },
        select: { id: true },
      })).id,
      enabled: false,
      reason: "verify-stage8: proving an override revokes what the plan includes",
    },
  });

  await expectFeatureRefusal(
    "revoking a planned feature closes it for the whole organisation",
    "entitlement",
    () => requireModule(t.ownerActor, MODULE_FEATURES.reports),
  );
  check(
    "the account owner cannot reach past their own organisation's entitlement",
    !(await resolveModuleForActor(t.ownerActor, "reports")).allowed,
  );
  check(
    "and the neighbouring organisation still has reports",
    (await resolveModuleForActor(t.rivalOwnerActor, "reports")).allowed,
  );

  console.log("\nLayer 1 — the platform kill switch outranks everything below it");
  await prisma.feature.update({
    where: { key: PREMIUM_KEY },
    data: { globalEnabled: false },
  });

  const killed = await resolveModuleForActor(t.staffActor, PREMIUM_KEY);
  check(
    "a kill switch beats an explicit role grant AND a tenant override",
    !killed.allowed && killed.reason === "global",
    killed,
  );
  check(
    "and beats the account owner's layer-3 immunity too",
    !(await resolveModuleForActor(t.ownerActor, PREMIUM_KEY)).allowed,
  );

  await prisma.feature.update({
    where: { key: PREMIUM_KEY },
    data: { globalEnabled: true },
  });

  console.log("\nLockout guard 1 — the settings module is never gated");
  for (const key of Object.keys(UNGATED_MODULES)) {
    check(
      `${key} resolves as available whatever the layers say`,
      (await resolveModuleForActor(t.staffActor, key)).allowed,
    );
  }
  await expectThrows(
    "and the write refuses to create a switch for it",
    (error) => error instanceof BadRequestError,
    () =>
      setRoleFeatureAccess(t.ownerActor, {
        roleId: t.staffRoleId,
        featureKey: "settings",
        enabled: false,
      }),
  );

  console.log("\nLockout guard 2 — the account owner's role cannot be switched off");
  await expectThrows(
    "a feature admin cannot take a module from the owner's role",
    (error) => error instanceof BadRequestError,
    () =>
      setRoleFeatureAccess(t.featureAdminActor, {
        roleId: t.ownerRoleId,
        featureKey: "registrations",
        enabled: false,
      }),
  );
  check(
    "no row was written for it",
    (await prisma.roleFeatureAccess.count({ where: { roleId: t.ownerRoleId } })) === 0,
  );
  // Belt and braces: even a row inserted behind the app's back is ignored.
  await setRoleAccess(t.ownerRoleId, "registrations", false);
  check(
    "and a row written directly to the table is still ignored by the resolver",
    (await resolveModuleForActor(t.ownerActor, "registrations")).allowed,
  );
  await setRoleAccess(t.ownerRoleId, "registrations", null);

  console.log("\nThe write refuses everything it should");
  await expectThrows(
    "another organisation's role is a 404, not a 403",
    (error) => error instanceof ScopeError,
    () =>
      setRoleFeatureAccess(t.ownerActor, {
        roleId: t.rivalOwnerRoleId,
        featureKey: "registrations",
        enabled: false,
      }),
  );
  await expectThrows(
    "a feature the organisation does not hold cannot be given to a role",
    (error) => error instanceof BadRequestError,
    () =>
      setRoleFeatureAccess(t.ownerActor, {
        roleId: t.staffRoleId,
        featureKey: "reports",
        enabled: true,
      }),
  );
  await expectThrows(
    "a feature that does not exist is refused",
    (error) => error instanceof BadRequestError,
    () =>
      setRoleFeatureAccess(t.ownerActor, {
        roleId: t.staffRoleId,
        featureKey: "no-such-feature",
        enabled: true,
      }),
  );
  await expectThrows(
    "and someone without feature:manage cannot write at all",
    (error) => error instanceof Error && error.name === "PermissionError",
    () =>
      setRoleFeatureAccess(t.staffActor, {
        roleId: t.staffRoleId,
        featureKey: "registrations",
        enabled: false,
      }),
  );

  console.log("\nThe write, when it is allowed");
  await setRoleFeatureAccess(t.featureAdminActor, {
    roleId: t.staffRoleId,
    featureKey: "doctors",
    enabled: false,
  });
  check(
    "the switch takes effect",
    !(await resolveModuleForActor(t.staffActor, "doctors")).allowed,
  );

  const audit = await prisma.auditLog.findMany({
    where: { actorTenantId: t.tenantId, targetId: t.staffRoleId },
    orderBy: { createdAt: "desc" },
    select: { action: true, afterValue: true },
  });
  check(
    "and is recorded in the append-only trail",
    audit.some((row) => row.action === "ROLE_FEATURE_DISABLED"),
    audit.map((row) => row.action),
  );
  check(
    "with the feature key, and no secret",
    JSON.stringify(audit[0]?.afterValue ?? {}).includes("doctors"),
    audit[0]?.afterValue,
  );

  await setRoleFeatureAccess(t.featureAdminActor, {
    roleId: t.staffRoleId,
    featureKey: "doctors",
    enabled: null,
  });
  check(
    "clearing it restores inheritance",
    (await resolveModuleForActor(t.staffActor, "doctors")).allowed,
  );
  check(
    "and deletes the row rather than storing a third state",
    (await prisma.roleFeatureAccess.count({
      where: { roleId: t.staffRoleId, feature: { key: "doctors" } },
    })) === 0,
  );

  const reset = await prisma.auditLog.findFirst({
    where: { actorTenantId: t.tenantId, action: "ROLE_FEATURE_RESET" },
    select: { id: true },
  });
  check("the reset is recorded too", reset !== null);

  console.log("\nA no-op write stays a no-op");
  const auditBefore = await prisma.auditLog.count({
    where: { actorTenantId: t.tenantId },
  });
  await setRoleFeatureAccess(t.featureAdminActor, {
    roleId: t.staffRoleId,
    featureKey: "doctors",
    enabled: null,
  });
  check(
    "re-clearing an already-cleared switch writes no audit row",
    (await prisma.auditLog.count({ where: { actorTenantId: t.tenantId } })) ===
      auditBefore,
  );

  console.log("\nThe Features screen");
  const overview = await getFeatureOverview(t.ownerActor);
  check("names the plan", overview.planName === "Standard", overview.planName);
  check("the owner may manage", overview.canManage === true);
  check(
    "lists every catalogue feature",
    overview.features.length ===
      (await prisma.feature.count()),
    overview.features.length,
  );
  check(
    "shows the revoked feature as not included",
    overview.features.find((row) => row.key === "reports")?.isEntitled === false,
  );
  check(
    "and names the override as the reason",
    overview.features.find((row) => row.key === "reports")?.entitlementSource ===
      "override-revoked",
  );
  check(
    "shows the premium feature as included, via the override",
    overview.features.find((row) => row.key === PREMIUM_KEY)?.entitlementSource ===
      "override-granted",
  );
  check(
    "marks the owner's row uneditable on every feature",
    overview.features.every((row) =>
      row.roles
        .filter((role) => role.isAccountOwner)
        .every((role) => !role.isEditable),
    ),
  );
  check(
    "marks the owner's row effective on every feature the organisation holds",
    overview.features
      .filter((row) => row.isEntitled)
      .every((row) =>
        row.roles.filter((role) => role.isAccountOwner).every((role) => role.isEffective),
      ),
  );
  check(
    "offers no switches on a feature the organisation does not hold",
    overview.features
      .filter((row) => !row.isEntitled)
      .every((row) => row.roles.every((role) => !role.isEditable)),
  );
  check(
    "offers no switches on an ungated feature",
    overview.features
      .filter((row) => row.isUngated)
      .every((row) => row.roles.every((role) => !role.isEditable)),
  );
  check(
    "says a CORE feature is inherited-on and a premium one inherited-off",
    overview.features.find((row) => row.key === "team")?.inheritsWhenSilent === true &&
      overview.features.find((row) => row.key === PREMIUM_KEY)?.inheritsWhenSilent ===
        false,
  );
  check(
    "shows no other organisation's roles",
    overview.features.every((row) => row.roles.length === 6),
    overview.features[0]?.roles.length,
  );

  const readOnly = await getFeatureOverview(t.staffActor).catch(
    (error: unknown) => error,
  );
  check(
    "and someone without feature:view is refused the screen entirely",
    readOnly instanceof Error && readOnly.name === "PermissionError",
    readOnly,
  );

  console.log("\nThe navigation hides what the page would refuse");
  await setRoleAccess(t.staffRoleId, "doctors", false);
  const staffModules = await resolveModulesForActor(t.staffActor);
  const links = visibleNavLinks(
    () => true,
    (feature) => staffModules.get(feature)?.allowed === true,
  );
  const hrefs = links.map((link) => link.href);
  check("the doctors tab is gone", !hrefs.includes("/doctors"), hrefs);
  check("the reports tab is gone with the organisation's entitlement", !hrefs.includes("/reports"));
  check("the registrations tab remains", hrefs.includes("/registration"));
  // Stage 10 collapsed the two settings tabs into one. What this check is for
  // is unchanged: the settings entry must survive a feature switch, or an
  // organisation could hide the only screen that would switch it back.
  check("the settings tab remains", hrefs.includes("/settings"), hrefs);
  check("the dashboard always remains", hrefs.includes("/dashboard"));

  console.log("\nThe page gate and the API gate agree");
  for (const key of ["doctors", "reports", "registrations"] as const) {
    const lock = await moduleLock(t.staffActor, key);
    const verdict = await resolveModuleForActor(t.staffActor, key);
    check(
      `${key}: moduleLock and the resolver give the same answer`,
      (lock === null) === verdict.allowed &&
        (lock === null || lock === verdict.reason),
      { lock, verdict },
    );
  }
  check(
    "the doctors refusal points at the role, which the reader can get fixed",
    (await moduleLock(t.staffActor, MODULE_FEATURES.doctors)) === "role",
  );
  check(
    "the reports refusal points at the entitlement, which they cannot",
    (await moduleLock(t.staffActor, MODULE_FEATURES.reports)) === "entitlement",
  );

  await setRoleAccess(t.staffRoleId, "doctors", null);

  console.log("\nA missing catalogue row fails closed");
  const orphan = await resolveModuleForActor(t.ownerActor, "not-in-the-catalogue");
  check(
    "an unknown key denies rather than quietly allowing",
    !orphan.allowed && orphan.reason === "entitlement",
    orphan,
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
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
      await prisma.registration.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.patient.deleteMany({ where: { tenantId: id } });
      await prisma.doctor.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    // The throwaway feature, and any row anywhere that points at it.
    await prisma.feature.deleteMany({ where: { key: PREMIUM_KEY } });

    const residue =
      (await prisma.tenant.count({ where: { businessName: TEST_TENANT_NAME } })) +
      (await prisma.feature.count({ where: { key: PREMIUM_KEY } }));
    if (residue > 0) {
      failures += 1;
      console.error(`\nCleanup left ${residue} row(s) behind.`);
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
