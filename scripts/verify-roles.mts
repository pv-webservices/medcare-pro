/**
 * Stage-7 verification — roles, permissions and branding, exercised against a
 * LOCAL database.
 *
 *     npm run verify:roles
 *
 * The load-bearing checks here are the three guards a permissions editor is
 * unsafe without: you cannot grant what you do not hold, the wildcard is never
 * mintable, and the account can never be left without an owner. Each is tested
 * from the direction an attacker would take it, not just the happy path.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  PermissionError,
  ScopeError,
  can,
  holdsAnywhere,
  permissionsHeldAnywhere,
} from "@/lib/rbac";
import { NAV_LINKS, visibleNavLinks } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles, OWNER_ROLE_NAME } from "@/lib/defaultRoles";
import { ALL_PERMISSIONS, isKnownPermission, WILDCARD } from "@/lib/permissions";
import { createClinic, getClinicForActor, updateClinic } from "@/lib/clinics";
import {
  assignRole,
  createRole,
  getRolesOverview,
  unassignRole,
  updateRole,
} from "@/lib/roles";
import { getRevenueReport } from "@/lib/reports";

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

async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  is: (error: unknown) => boolean,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const TEST_TENANT_NAME = "verify-roles";

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${label}-${Date.now()}@example.test`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Owner ${label}`,
      email: `owner-${label}-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId(OWNER_ROLE_NAME) }] },
    },
    select: { id: true },
  });

  return {
    tenantId: tenant.id,
    roleId,
    ownerActor: { userId: owner.id, tenantId: tenant.id },
  };
}

async function build() {
  const main = await makeTenant("a");
  const other = await makeTenant("b");

  const clinicA = await createClinic(main.ownerActor, { name: "Alpha Clinic" });
  const clinicB = await createClinic(main.ownerActor, { name: "Beta Clinic" });
  const foreignClinic = await createClinic(other.ownerActor, { name: "Gamma Clinic" });

  const plainUser = async (name: string) =>
    prisma.user.create({
      data: {
        tenantId: main.tenantId,
        name,
        email: `${name.toLowerCase().replace(/\W+/g, "-")}-${main.tenantId}@example.test`,
        passwordHash: "x",
      },
      select: { id: true },
    });

  const manager = await plainUser("Role Manager");
  const scopedManager = await plainUser("Scoped Manager");
  const viewer = await plainUser("Role Viewer");
  const spare = await plainUser("Spare Owner");

  // Account-wide Admin — complete access to every feature, per the decision
  // that Owner and Admin both get everything.
  const admin = await prisma.user.create({
    data: {
      tenantId: main.tenantId,
      name: "Account Admin",
      email: `admin-${main.tenantId}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: main.roleId("Admin") }] },
    },
    select: { id: true },
  });

  const staff = await prisma.user.create({
    data: {
      tenantId: main.tenantId,
      name: "Front Desk",
      email: `staff-${main.tenantId}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: main.roleId("Staff"), clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  return {
    ...main,
    other,
    clinicA: clinicA.id,
    clinicB: clinicB.id,
    foreignClinic: foreignClinic.id,
    manager: manager.id,
    scopedManager: scopedManager.id,
    viewer: viewer.id,
    spare: spare.id,
    managerActor: { userId: manager.id, tenantId: main.tenantId },
    scopedManagerActor: { userId: scopedManager.id, tenantId: main.tenantId },
    viewerActor: { userId: viewer.id, tenantId: main.tenantId },
    adminActor: { userId: admin.id, tenantId: main.tenantId },
    staffActor: { userId: staff.id, tenantId: main.tenantId },
  };
}

/** The labels a user would actually see in the sidebar. */
async function navLabelsFor(actor: {
  userId: string;
  tenantId: string;
}): Promise<string[]> {
  const held = await permissionsHeldAnywhere(actor);
  return visibleNavLinks((permission) => holdsAnywhere(held, permission)).map(
    (link) => link.label,
  );
}

async function main(): Promise<void> {
  const t = await build();

  console.log("\nCatalogue integrity");
  check(
    "the wildcard is not a tickable permission",
    !isKnownPermission(WILDCARD),
  );
  check("no duplicate keys", new Set(ALL_PERMISSIONS).size === ALL_PERMISSIONS.length);
  const seeded = await prisma.role.findMany({
    where: { tenantId: t.tenantId },
    select: { name: true, permissions: true },
  });
  const seededPermissions = seeded
    .flatMap((role) => (Array.isArray(role.permissions) ? role.permissions : []))
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value !== WILDCARD);
  check(
    "the catalogue covers every seeded permission",
    seededPermissions.every((permission) => isKnownPermission(permission)),
    seededPermissions.filter((permission) => !isKnownPermission(permission)),
  );

  console.log("\nFR-8.1 creating custom roles");
  const billing = await createRole(t.ownerActor, {
    name: "Billing Desk",
    permissions: ["registration:read", "report:read"],
  });
  check("role created with its permissions", billing.permissions.length === 2, billing);
  check("a new role is not a wildcard role", billing.isWildcard === false);

  await expectThrows(
    "a duplicate role name is a 409",
    () => createRole(t.ownerActor, { name: "Billing Desk", permissions: [] }),
    (error) => error instanceof ConflictError,
  );
  await expectThrows(
    "an unknown permission is rejected",
    () =>
      createRole(t.ownerActor, {
        name: "Bogus",
        permissions: ["registration:destroy"],
      }),
    (error) => error instanceof BadRequestError,
  );

  console.log("\nGuard 2 — the wildcard is never mintable");
  await expectThrows(
    "even the Owner cannot tick `*` into a new role",
    () => createRole(t.ownerActor, { name: "Shadow Owner", permissions: [WILDCARD] }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "nor edit `*` onto an existing one",
    () =>
      updateRole(t.ownerActor, {
        action: "updateRole",
        roleId: billing.id,
        permissions: [WILDCARD],
      }),
    (error) => error instanceof BadRequestError,
  );

  console.log("\nFR-8.2 assigning roles");
  const managerRole = await createRole(t.ownerActor, {
    name: "Role Manager",
    permissions: ["role:read", "role:manage", "report:read"],
  });

  const assignment = await assignRole(t.ownerActor, {
    action: "assign",
    userId: t.manager,
    roleId: managerRole.id,
  });
  check("account-wide assignment has no clinic", assignment.clinicId === null);

  const scoped = await assignRole(t.ownerActor, {
    action: "assign",
    userId: t.scopedManager,
    roleId: managerRole.id,
    clinicId: t.clinicA,
  });
  check("clinic-scoped assignment names the clinic", scoped.clinicName === "Alpha Clinic");

  await expectThrows(
    "the same role in the same scope twice is a 409",
    () =>
      assignRole(t.ownerActor, {
        action: "assign",
        userId: t.manager,
        roleId: managerRole.id,
      }),
    (error) => error instanceof ConflictError,
  );
  check(
    "the account-wide duplicate really was blocked (MySQL NULLs do not dedupe)",
    (await prisma.userRole.count({
      where: { userId: t.manager, roleId: managerRole.id, clinicId: null },
    })) === 1,
  );

  console.log("\nPRD §9 scoping — nothing crosses an account boundary");
  await expectThrows(
    "another account's user cannot be assigned",
    () =>
      assignRole(t.ownerActor, {
        action: "assign",
        userId: t.other.ownerActor.userId,
        roleId: managerRole.id,
      }),
    (error) => error instanceof ScopeError,
  );
  await expectThrows(
    "another account's role cannot be assigned",
    () =>
      assignRole(t.ownerActor, {
        action: "assign",
        userId: t.manager,
        roleId: t.other.roleId("Admin"),
      }),
    (error) => error instanceof ScopeError,
  );
  await expectThrows(
    "another account's clinic cannot be used as a scope",
    () =>
      assignRole(t.ownerActor, {
        action: "assign",
        userId: t.viewer,
        roleId: managerRole.id,
        clinicId: t.foreignClinic,
      }),
    (error) => error instanceof ScopeError,
  );
  await expectThrows(
    "another account's role cannot be edited",
    () =>
      updateRole(t.ownerActor, {
        action: "updateRole",
        roleId: t.other.roleId("Staff"),
        permissions: [],
      }),
    (error) => error instanceof ScopeError,
  );

  console.log("\nGuard 1 — you cannot grant what you do not hold");
  const managerView = await getRolesOverview(t.managerActor);
  check(
    "a non-owner manager may grant only what they hold",
    managerView.grantablePermissions.every((permission) =>
      ["role:read", "role:manage", "report:read"].includes(permission),
    ),
    managerView.grantablePermissions,
  );
  check("the owner sees the whole catalogue",
    (await getRolesOverview(t.ownerActor)).grantablePermissions.length ===
      ALL_PERMISSIONS.length,
  );

  const allowed = await createRole(t.managerActor, {
    name: "Report Reader",
    permissions: ["report:read"],
  });
  check("a manager can create a role within their own reach", allowed.permissions.length === 1);

  await expectThrows(
    "but not one holding a permission they lack",
    () =>
      createRole(t.managerActor, {
        name: "Clinic Maker",
        permissions: ["clinic:create"],
      }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "and cannot edit that permission onto an existing role",
    () =>
      updateRole(t.managerActor, {
        action: "updateRole",
        roleId: allowed.id,
        permissions: ["report:read", "clinic:create"],
      }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "nor hand out a role that reaches beyond them",
    () =>
      assignRole(t.managerActor, {
        action: "assign",
        userId: t.viewer,
        roleId: t.roleId("Admin"),
      }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "and above all cannot hand out the owner role",
    () =>
      assignRole(t.managerActor, {
        action: "assign",
        userId: t.viewer,
        roleId: t.roleId(OWNER_ROLE_NAME),
      }),
    (error) => error instanceof BadRequestError,
  );

  console.log("\nRole management requires an ACCOUNT-WIDE grant");
  await expectThrows(
    "a clinic-scoped role:manage cannot reach the roles screen",
    () => getRolesOverview(t.scopedManagerActor),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "nor create a role",
    () =>
      createRole(t.scopedManagerActor, { name: "Scoped Attempt", permissions: [] }),
    (error) => error instanceof PermissionError,
  );

  console.log("\nRead-only access");
  const viewerRole = await createRole(t.ownerActor, {
    name: "Role Viewer",
    permissions: ["role:read"],
  });
  await assignRole(t.ownerActor, {
    action: "assign",
    userId: t.viewer,
    roleId: viewerRole.id,
  });
  const viewerView = await getRolesOverview(t.viewerActor);
  check("a role:read holder can see the screen", viewerView.roles.length > 0);
  check("but canManage is false", viewerView.canManage === false);
  check(
    // Guard 1 reports what they HOLD, which is the one permission on their
    // role. canManage: false is what actually stops them granting it.
    "and the grantable set is only what they themselves hold",
    viewerView.grantablePermissions.length === 1 &&
      viewerView.grantablePermissions[0] === "role:read",
    viewerView.grantablePermissions,
  );
  await expectThrows(
    "and every write is refused",
    () => createRole(t.viewerActor, { name: "Nope", permissions: [] }),
    (error) => error instanceof PermissionError,
  );

  console.log("\nStaff cannot manage roles");
  await expectThrows(
    "Staff cannot open the roles screen",
    () => getRolesOverview(t.staffActor),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "nor create one",
    () => createRole(t.staffActor, { name: "Nope", permissions: [] }),
    (error) => error instanceof PermissionError,
  );

  console.log("\nOwner and Admin both get complete access");
  const adminRole = seeded.find((role) => role.name === "Admin")!;
  const adminPermissions = Array.isArray(adminRole.permissions)
    ? adminRole.permissions
    : [];
  check(
    "the seeded Admin holds every catalogued permission",
    ALL_PERMISSIONS.every((permission) => adminPermissions.includes(permission)),
    ALL_PERMISSIONS.filter((permission) => !adminPermissions.includes(permission)),
  );
  check(
    "including role management",
    adminPermissions.includes("role:read") && adminPermissions.includes("role:manage"),
  );
  check(
    "but NOT the wildcard — Owner stays the account's root",
    !adminPermissions.includes(WILDCARD),
  );

  const adminView = await getRolesOverview(t.adminActor);
  check("an Admin can open the roles screen", adminView.canManage === true);
  check(
    "and may grant the whole catalogue",
    adminView.grantablePermissions.length === ALL_PERMISSIONS.length,
    adminView.grantablePermissions.length,
  );
  const adminMade = await createRole(t.adminActor, {
    name: "Made By Admin",
    permissions: ["clinic:create", "role:manage"],
  });
  check("and create a role reaching as far as they do", adminMade.permissions.length === 2);

  await expectThrows(
    "but an Admin still cannot mint an owner",
    () =>
      assignRole(t.adminActor, {
        action: "assign",
        userId: t.viewer,
        roleId: t.roleId(OWNER_ROLE_NAME),
      }),
    (error) => error instanceof BadRequestError,
  );

  console.log("\nNavigation tabs follow the role");
  const ownerTabs = await navLabelsFor(t.ownerActor);
  check(
    "the Owner sees every tab",
    ownerTabs.length === NAV_LINKS.length,
    ownerTabs,
  );
  check(
    "so does an Admin",
    (await navLabelsFor(t.adminActor)).length === NAV_LINKS.length,
    await navLabelsFor(t.adminActor),
  );

  const staffTabs = await navLabelsFor(t.staffActor);
  check(
    "Staff see only what their role reaches",
    staffTabs.join(",") === "Dashboard,Registrations,Doctors,Clinics",
    staffTabs,
  );
  check(
    "Staff are not offered Reports, Notifications, Roles or Branding",
    ["Reports", "Notifications", "Roles", "Branding"].every(
      (label) => !staffTabs.includes(label),
    ),
    staffTabs,
  );
  check(
    "a clinic-scoped grant still shows the tab (the check is scope-blind)",
    (await navLabelsFor(t.scopedManagerActor)).includes("Roles"),
    await navLabelsFor(t.scopedManagerActor),
  );
  check(
    "a user with no roles at all still gets a landing tab",
    (await navLabelsFor({ userId: t.spare, tenantId: t.tenantId })).join(",") ===
      "Dashboard",
  );

  console.log("\nGranting a permission actually takes effect");
  await expectThrows(
    "the viewer cannot read revenue before the grant",
    () => getRevenueReport(t.viewerActor, { period: "monthly" }),
    (error) => error instanceof PermissionError,
  );
  await assignRole(t.ownerActor, {
    action: "assign",
    userId: t.viewer,
    roleId: allowed.id,
    clinicId: t.clinicA,
  });
  const report = await getRevenueReport(t.viewerActor, { period: "monthly" });
  check("and can immediately after it", report.hasClinics === true);
  check(
    "scoped to the one clinic the role was granted in",
    report.byClinic.every((row) => row.name === "Alpha Clinic"),
    report.byClinic.map((row) => row.name),
  );

  console.log("\nGuard 3 — the account always keeps an owner");
  const ownerAssignment = await prisma.userRole.findFirstOrThrow({
    where: {
      userId: t.ownerActor.userId,
      clinicId: null,
      role: { tenantId: t.tenantId, name: OWNER_ROLE_NAME },
    },
    select: { id: true },
  });

  await expectThrows(
    "the last account-wide owner cannot be unassigned",
    () =>
      unassignRole(t.ownerActor, {
        action: "unassign",
        assignmentId: ownerAssignment.id,
      }),
    (error) => error instanceof ConflictError,
  );
  await expectThrows(
    "and the owner role cannot have its access edited away",
    () =>
      updateRole(t.ownerActor, {
        action: "updateRole",
        roleId: t.roleId(OWNER_ROLE_NAME),
        permissions: ["report:read"],
      }),
    (error) => error instanceof ConflictError,
  );

  // With a second owner in place, the first may step down.
  await assignRole(t.ownerActor, {
    action: "assign",
    userId: t.spare,
    roleId: t.roleId(OWNER_ROLE_NAME),
  });
  const steppedDown = await unassignRole(t.ownerActor, {
    action: "unassign",
    assignmentId: ownerAssignment.id,
  });
  check("once a second owner exists, the first can step down", steppedDown.removed);
  check(
    "the original owner really lost their access",
    (await can(t.ownerActor, "clinic:create")) === false,
  );

  console.log("\nA clinic-scoped owner does not count as account cover");
  const spareActor = { userId: t.spare, tenantId: t.tenantId };
  const spareAssignment = await prisma.userRole.findFirstOrThrow({
    where: { userId: t.spare, clinicId: null },
    select: { id: true },
  });
  await assignRole(spareActor, {
    action: "assign",
    userId: t.manager,
    roleId: t.roleId(OWNER_ROLE_NAME),
    clinicId: t.clinicB,
  });
  await expectThrows(
    "the last ACCOUNT-WIDE owner is still protected",
    () =>
      unassignRole(spareActor, {
        action: "unassign",
        assignmentId: spareAssignment.id,
      }),
    (error) => error instanceof ConflictError,
  );

  console.log("\nRenaming and removing assignments");
  const renamed = await updateRole(spareActor, {
    action: "updateRole",
    roleId: billing.id,
    name: "Billing & Accounts",
  });
  check("a role can be renamed", renamed.name === "Billing & Accounts");
  check(
    "renaming leaves permissions alone",
    renamed.permissions.length === 2,
    renamed.permissions,
  );

  const removed = await unassignRole(spareActor, {
    action: "unassign",
    assignmentId: scoped.id,
  });
  check("an ordinary assignment can be removed", removed.removed);
  await expectThrows(
    "removing it twice is a 404",
    () => unassignRole(spareActor, { action: "unassign", assignmentId: scoped.id }),
    (error) => error instanceof ScopeError,
  );

  console.log("\nFR-8.3 / FR-8.4 branding (per clinic, PRD §7)");
  const branded = await updateClinic(spareActor, t.clinicA, {
    logoUrl: "https://example.com/alpha.png",
    themeColor: "#1D4ED8",
  });
  check("logo saved", branded.logoUrl === "https://example.com/alpha.png", branded.logoUrl);
  check("colour saved", branded.themeColor === "#1D4ED8", branded.themeColor);
  check(
    "branding is per clinic, so the sibling is untouched",
    (await getClinicForActor(spareActor, t.clinicB)).logoUrl === null,
  );

  const cleared = await updateClinic(spareActor, t.clinicA, {
    logoUrl: "",
    themeColor: "",
  });
  check("an empty value clears the field", cleared.logoUrl === null && cleared.themeColor === null);

  await expectThrows(
    "a malformed colour is rejected before it reaches the column",
    async () => {
      const { updateClinicSchema } = await import("@/lib/clinics");
      return updateClinicSchema.parse({ themeColor: "blue" });
    },
    (error) => error instanceof Error && error.name === "ZodError",
  );
  await expectThrows(
    "and Staff cannot brand a clinic at all",
    () => updateClinic(t.staffActor, t.clinicA, { themeColor: "#000000" }),
    (error) => error instanceof PermissionError,
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

    for (const { id } of stale) {
      await prisma.registration.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.patient.deleteMany({ where: { tenantId: id } });
      await prisma.doctor.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
