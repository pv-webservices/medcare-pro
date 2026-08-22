/**
 * Stage-10 verification — the Settings section, exercised against a LOCAL
 * database.
 *
 *     npm run verify:stage10
 *
 * The unit tests cover the section list and the navigation, both pure. What
 * only a database can answer is what a REAL role resolves to: whether the two
 * permissions that sat inert in the catalogue since Stage 1 now open something,
 * and — the check this stage exists to make — whether every role that could
 * reach branding yesterday still reaches it today.
 *
 * That last one is the whole risk of the stage. Nothing here adds a table or a
 * column; the danger is entirely that enforcing a previously-inert permission
 * quietly takes a screen away from somebody.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { visibleNavLinks } from "@/lib/navigation";
import { ALL_PERMISSIONS, findPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  can,
  holdsAnywhere,
  permissionsHeldAnywhere,
  type ActorContext,
} from "@/lib/rbac";
import {
  SETTINGS_SECTIONS,
  canManageSection,
  visibleSettingsSections,
} from "@/lib/settingsSections";

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

const TEST_TENANT_NAME = "verify-stage10";

/**
 * The permissions the branding screen answered to BEFORE Stage 10.
 *
 * Frozen deliberately, the same way HISTORICAL_ALL_PERMISSIONS is: the page had
 * no gate of its own, so anyone who could see a clinic reached it and
 * `clinic:edit` decided whether the form was live. Every one of these must
 * still open it.
 */
const HISTORICAL_BRANDING_READERS = ["clinic:read", "clinic:edit"] as const;

async function build() {
  const stamp = Date.now();

  await seedFeatureCatalogue(prisma);

  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${stamp}@example.test`,
      slug: `${TEST_TENANT_NAME}-${stamp}`,
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Alpha Clinic" },
    select: { id: true },
  });
  const other = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Beta Clinic" },
    select: { id: true },
  });

  const seeded = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const seededRole = (name: string) =>
    seeded.find((role) => role.name === name)!.id;

  /** A role holding exactly the permissions named, and nothing else. */
  async function customRole(name: string, permissions: readonly string[]) {
    const role = await prisma.role.create({
      data: { tenantId: tenant.id, name: `${name}-${stamp}`, permissions: [...permissions] },
      select: { id: true },
    });
    return role.id;
  }

  async function user(
    label: string,
    assignments: { roleId: string; clinicId?: string }[],
  ): Promise<ActorContext> {
    const created = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: label,
        email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@example.test`,
        passwordHash: "x",
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        userRoles: { create: assignments },
      },
      select: { id: true },
    });
    return { userId: created.id, tenantId: tenant.id };
  }

  // The role that would have been silently locked out: it predates the settings
  // keys entirely and holds only the clinic ones.
  const legacyBranderId = await customRole("Legacy Brander", [
    "clinic:read",
    "clinic:edit",
    "registration:read",
  ]);
  const clinicViewerId = await customRole("Clinic Viewer", ["clinic:read"]);
  const settingsViewerId = await customRole("Settings Viewer", ["settings:view"]);
  const settingsManagerId = await customRole("Settings Manager", [
    "settings:view",
    "settings:manage",
    "clinic:read",
  ]);
  const frontDeskId = await customRole("Front Desk Only", [
    "registration:read",
    "registration:create",
  ]);
  const roleReaderId = await customRole("Role Reader", ["role:read"]);
  // Holds the power to change roles but not to read them — the pre-existing
  // quirk the unit test pins. It must not be offered a card it cannot open.
  const roleManagerOnlyId = await customRole("Role Manager Only", ["role:manage"]);

  return {
    tenantId: tenant.id,
    clinicId: clinic.id,
    otherClinicId: other.id,
    ownerActor: await user("Owner", [{ roleId: seededRole("Owner") }]),
    adminActor: await user("Admin", [{ roleId: seededRole("Admin") }]),
    staffActor: await user("Staff", [
      { roleId: seededRole("Staff"), clinicId: clinic.id },
    ]),
    legacyBranderActor: await user("Legacy Brander", [{ roleId: legacyBranderId }]),
    clinicViewerActor: await user("Clinic Viewer", [{ roleId: clinicViewerId }]),
    settingsViewerActor: await user("Settings Viewer", [{ roleId: settingsViewerId }]),
    settingsManagerActor: await user("Settings Manager", [
      { roleId: settingsManagerId },
    ]),
    frontDeskActor: await user("Front Desk", [{ roleId: frontDeskId }]),
    roleReaderActor: await user("Role Reader", [{ roleId: roleReaderId }]),
    roleManagerOnlyActor: await user("Role Manager Only", [
      { roleId: roleManagerOnlyId },
    ]),
    // Scoped to Beta only: may brand Beta, must not brand Alpha.
    betaOnlyActor: await user("Beta Brander", [
      { roleId: legacyBranderId, clinicId: other.id },
    ]),
  };
}

/** What this person sees in the sidebar and on the Settings landing page. */
async function surfaceFor(actor: ActorContext) {
  const held = await permissionsHeldAnywhere(actor);
  const holds = (permission: string) => holdsAnywhere(held, permission);

  return {
    holds,
    tabs: visibleNavLinks(holds).map((link) => link.href),
    sections: visibleSettingsSections(holds).map((section) => section.href),
    manageable: visibleSettingsSections(holds)
      .filter((section) => canManageSection(section, holds))
      .map((section) => section.href),
  };
}

async function main(): Promise<void> {
  const t = await build();

  // -------------------------------------------------------------------------
  console.log("\nThe catalogue records what is now enforced");
  // -------------------------------------------------------------------------
  for (const key of ["settings:view", "settings:manage"]) {
    check(
      `${key} has lost its pending mark`,
      findPermission(key)?.pending === undefined &&
        findPermission(key)?.pendingNote === undefined,
    );
    check(`${key} is still in the catalogue`, ALL_PERMISSIONS.includes(key));
  }
  check(
    "and neither description still promises settings that do not exist",
    !findPermission("settings:manage")!.description.includes("operational"),
  );

  // -------------------------------------------------------------------------
  console.log("\nNobody loses branding — the whole risk of this stage");
  // -------------------------------------------------------------------------
  const branding = SETTINGS_SECTIONS.find(
    (section) => section.href === "/settings/branding",
  )!;

  for (const permission of HISTORICAL_BRANDING_READERS) {
    check(
      `a role holding only ${permission} still opens branding`,
      branding.viewPermissions.includes(permission),
    );
  }

  const legacy = await surfaceFor(t.legacyBranderActor);
  check(
    "the pre-Stage-10 branding role still reaches the screen",
    legacy.sections.includes("/settings/branding"),
    legacy.sections,
  );
  check(
    "and can still save from it, exactly as before",
    legacy.manageable.includes("/settings/branding"),
  );
  check(
    "and still finds it in the sidebar",
    legacy.tabs.includes("/settings"),
    legacy.tabs,
  );

  const clinicViewer = await surfaceFor(t.clinicViewerActor);
  check(
    "a clinic:read-only role sees branding read-only, as it did before",
    clinicViewer.sections.includes("/settings/branding") &&
      !clinicViewer.manageable.includes("/settings/branding"),
    clinicViewer,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe two Stage 1 keys now open something");
  // -------------------------------------------------------------------------
  const viewer = await surfaceFor(t.settingsViewerActor);
  check(
    "settings:view alone reaches the Settings tab",
    viewer.tabs.includes("/settings"),
    viewer.tabs,
  );
  check(
    "and opens branding, so the grant is not hollow",
    viewer.sections.includes("/settings/branding"),
    viewer.sections,
  );
  check(
    "but changes nothing",
    viewer.manageable.length === 0,
    viewer.manageable,
  );
  check(
    "and reaches neither roles nor features, which it never claimed to",
    !viewer.sections.includes("/settings/roles") &&
      !viewer.sections.includes("/settings/features"),
  );

  const manager = await surfaceFor(t.settingsManagerActor);
  check(
    "settings:manage makes branding editable",
    manager.manageable.includes("/settings/branding"),
    manager.manageable,
  );
  check(
    "without granting roles or features",
    !manager.sections.includes("/settings/roles") &&
      !manager.sections.includes("/settings/features"),
    manager.sections,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe sidebar offers no door that refuses");
  // -------------------------------------------------------------------------
  const frontDesk = await surfaceFor(t.frontDeskActor);
  check(
    "a front-desk role sees no Settings tab",
    !frontDesk.tabs.includes("/settings"),
    frontDesk.tabs,
  );
  check("and no sections", frontDesk.sections.length === 0);

  const roleReader = await surfaceFor(t.roleReaderActor);
  check(
    "role:read reaches Settings, and only the roles screen inside it",
    roleReader.tabs.includes("/settings") &&
      roleReader.sections.join() === "/settings/roles",
    roleReader,
  );
  check("read-only, since it cannot manage", roleReader.manageable.length === 0);

  const managerOnly = await surfaceFor(t.roleManagerOnlyActor);
  check(
    "role:manage without role:read is offered nothing, matching what the roles screen would say",
    managerOnly.sections.length === 0 && !managerOnly.tabs.includes("/settings"),
    managerOnly,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe seeded roles");
  // -------------------------------------------------------------------------
  const owner = await surfaceFor(t.ownerActor);
  const readOnlySections = SETTINGS_SECTIONS.filter(
    (section) => section.managePermissions.length === 0,
  ).length;
  check(
    "the account owner reaches every section",
    owner.sections.length === SETTINGS_SECTIONS.length,
    owner.sections,
  );
  check(
    "and may change every one except those nothing can change",
    // Stage 11 added the activity log, which is append-only: not even the
    // wildcard makes it editable, and an audit trail an owner can rewrite is
    // not an audit trail.
    owner.manageable.length === SETTINGS_SECTIONS.length - readOnlySections,
    owner.manageable,
  );

  const admin = await surfaceFor(t.adminActor);
  check(
    "the seeded Admin reaches every section too",
    admin.sections.length === SETTINGS_SECTIONS.length,
    admin.sections,
  );

  const staff = await surfaceFor(t.staffActor);
  check(
    "a clinic-scoped Staff role finds the tab only if it holds a section's permission",
    staff.tabs.includes("/settings") === staff.sections.length > 0,
    staff,
  );

  // -------------------------------------------------------------------------
  console.log("\nBranding stays clinic-scoped");
  // -------------------------------------------------------------------------
  //
  // The landing page resolves permissions ANYWHERE — it decides whether the
  // screen exists for this person. What they may SAVE is resolved against the
  // clinic actually selected, which is a different and narrower question.
  const beta = await surfaceFor(t.betaOnlyActor);
  check(
    "a role scoped to one clinic still finds the branding screen",
    beta.sections.includes("/settings/branding"),
    beta.sections,
  );
  check(
    "and may brand the clinic it is scoped to",
    (await can(t.betaOnlyActor, "clinic:edit", t.otherClinicId)) === true,
  );
  check(
    "but not the clinic it is not",
    (await can(t.betaOnlyActor, "clinic:edit", t.clinicId)) === false,
  );

  // -------------------------------------------------------------------------
  console.log("\nEvery section's permissions are real");
  // -------------------------------------------------------------------------
  for (const section of SETTINGS_SECTIONS) {
    for (const permission of [
      ...section.viewPermissions,
      ...section.managePermissions,
    ]) {
      check(
        `${section.href} names a catalogued permission: ${permission}`,
        ALL_PERMISSIONS.includes(permission),
      );
    }
  }
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
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    const residue = await prisma.tenant.count({
      where: { businessName: TEST_TENANT_NAME },
    });
    if (residue > 0) {
      failures += 1;
      console.error(`\nCleanup left ${residue} row(s) behind.`);
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
