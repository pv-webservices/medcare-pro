/** Secure Tasks verification against a LOCAL database. */
import { prisma } from "@/lib/prisma";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { DEFAULT_ROLES, ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { DASHBOARD_DATA_PERMISSIONS, TASK_PERMISSIONS } from "@/lib/permissions";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { canAssignTaskToUser } from "@/lib/taskAuthority";
import { archiveTask, completeTask, createTask, listTasks } from "@/lib/tasks";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`, condition || detail === undefined ? "" : detail);
  if (!condition) failures += 1;
}

async function rejects(label: string, fn: () => Promise<unknown>, kind: new (...args: never[]) => Error) {
  try {
    await fn();
    check(label, false, "did not reject");
  } catch (error) {
    check(label, error instanceof kind, error);
  }
}

async function main() {
  console.log("Tasks verification\n");
  await seedFeatureCatalogue(prisma);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  check("Prisma Task model and tasks table exist", Number.isInteger(await prisma.task.count()));
  check("all task permissions are catalogued", TASK_PERMISSIONS.length === 7);
  check("dashboard task permission is separate", DASHBOARD_DATA_PERMISSIONS.includes("dashboard:tasks:view"));
  const adminDefaults = DEFAULT_ROLES.find((role) => role.key === ROLE_KEYS.CLINIC_ADMIN)!.permissions;
  check("Clinic Admin defaults include full task management", TASK_PERMISSIONS.every((permission) => adminDefaults.includes(permission)));

  check(
    "permission authority blocks lower-to-higher assignment",
    canAssignTaskToUser({
      actorPermissions: new Set(["task:view", "task:complete"]),
      targetPermissions: new Set(["task:view", "task:create", "task:assign", "task:manage"]),
      isAccountOwner: false,
      sameTenant: true,
      actorHasTaskAssign: true,
      actorClinicScopeCoversTargetClinic: true,
      actorHasTenantWideAuthority: false,
      targetHasTenantWideAuthority: false,
      targetIsActive: true,
    }) === "target-not-below-actor",
  );

  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { businessName: `verify-tasks-${stamp}`, email: `tasks-${stamp}@example.test`, slug: `verify-tasks-${stamp}`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id },
  });
  const otherTenant = await prisma.tenant.create({
    data: { businessName: `verify-tasks-other-${stamp}`, email: `tasks-other-${stamp}@example.test`, slug: `verify-tasks-other-${stamp}`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id },
  });

  try {
    await seedDefaultRoles(prisma, tenant.id);
    await seedDefaultRoles(prisma, otherTenant.id);
    const [clinicA, clinicB] = await Promise.all([
      prisma.clinic.create({ data: { tenantId: tenant.id, name: "Task Clinic A" } }),
      prisma.clinic.create({ data: { tenantId: tenant.id, name: "Task Clinic B" } }),
    ]);
    const [adminRole, doctorRole] = await Promise.all([
      prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, key: ROLE_KEYS.CLINIC_ADMIN } }),
      prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, key: ROLE_KEYS.DOCTOR } }),
    ]);
    const otherRole = await prisma.role.findFirstOrThrow({ where: { tenantId: otherTenant.id, key: ROLE_KEYS.DOCTOR } });
    const [admin, doctor, otherUser] = await Promise.all([
      prisma.user.create({ data: { tenantId: tenant.id, email: `task-admin-${stamp}@example.test`, passwordHash: "x", accountStatus: "ACTIVE", membershipStatus: "ACTIVE", emailVerifiedAt: new Date() } }),
      prisma.user.create({ data: { tenantId: tenant.id, email: `task-doctor-${stamp}@example.test`, passwordHash: "x", accountStatus: "ACTIVE", membershipStatus: "ACTIVE", emailVerifiedAt: new Date() } }),
      prisma.user.create({ data: { tenantId: otherTenant.id, email: `task-other-${stamp}@example.test`, passwordHash: "x", accountStatus: "ACTIVE", membershipStatus: "ACTIVE", emailVerifiedAt: new Date() } }),
    ]);
    await Promise.all([
      prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id, clinicId: clinicA.id } }),
      prisma.userRole.create({ data: { userId: doctor.id, roleId: doctorRole.id, clinicId: clinicA.id } }),
      prisma.userRole.create({ data: { userId: otherUser.id, roleId: otherRole.id, clinicId: null } }),
    ]);
    const adminActor = { userId: admin.id, tenantId: tenant.id };
    const doctorActor = { userId: doctor.id, tenantId: tenant.id };

    const task = await createTask(adminActor, { title: "Verify tenant-safe task", clinicId: clinicA.id, assignedToId: doctor.id, priority: "HIGH" });
    check("Clinic Admin assigns a lower-authority user in their clinic", task.assignedTo?.id === doctor.id);
    check("assignee sees their task", (await listTasks(doctorActor, { view: "mine" })).rows.some((row) => row.id === task.id));
    check("manager sees all tasks in clinic scope", (await listTasks(adminActor, { view: "all", clinicId: clinicA.id })).rows.some((row) => row.id === task.id));

    await rejects("selected clinic cannot widen access", () => listTasks(adminActor, { view: "all", clinicId: clinicB.id }), ScopeError);
    await rejects("cross-tenant assignee is rejected", () => createTask(adminActor, { title: "Cross tenant", clinicId: clinicA.id, assignedToId: otherUser.id }), ScopeError);
    await rejects("create outside assigned clinic is rejected", () => createTask(adminActor, { title: "Wrong clinic", clinicId: clinicB.id }), PermissionError);

    const completed = await completeTask(doctorActor, task.id);
    check("assignee with task:complete completes own task", completed.status === "COMPLETED" && completed.completedBy?.id === doctor.id);
    await archiveTask(adminActor, task.id);
    check("archived tasks are hidden by default", !(await listTasks(adminActor, { view: "all", clinicId: clinicA.id })).rows.some((row) => row.id === task.id));
  } finally {
    await prisma.task.deleteMany({ where: { tenantId: { in: [tenant.id, otherTenant.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } });
  }

  if (failures) throw new Error(`${failures} task verification check(s) failed.`);
  console.log("\nAll task checks passed.");
}

main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());

