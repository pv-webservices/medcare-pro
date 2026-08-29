/**
 * Installs the Tasks feature entitlement and safely tops up untouched seeded
 * roles in a LOCAL database. Dry-run by default; pass --apply to write.
 */
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import {
  PRE_TASK_ROLE_PERMISSIONS,
  ROLE_KEYS,
  TASK_ROLE_TOP_UPS,
  isUntouchedPreTaskRole,
  type RoleKey,
} from "@/lib/defaultRoles";
import { prisma } from "@/lib/prisma";
import { toPermissionList } from "@/lib/rbac";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const keys = [ROLE_KEYS.CLINIC_ADMIN, ROLE_KEYS.DOCTOR, ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.STAFF] as const;

async function main(): Promise<void> {
  console.log(APPLY ? "Tasks backfill — APPLYING\n" : "Tasks backfill — dry run (pass --apply to write)\n");

  if (APPLY) {
    const result = await seedFeatureCatalogue(prisma);
    console.log(`  Feature catalogue: ${result.createdFeatures.length} created, ${result.linkedFeatures.length} linked`);
  } else {
    console.log("  WOULD create/link the tasks CORE feature where missing");
  }

  const roles = await prisma.role.findMany({
    where: { key: { in: [...keys] }, tenant: { isPlatform: false } },
    select: { id: true, key: true, name: true, permissions: true, isSystem: true, tenant: { select: { businessName: true } } },
    orderBy: { id: "asc" },
  });

  for (const role of roles) {
    const key = role.key as RoleKey;
    const current = [...toPermissionList(role.permissions)];
    const missing = (TASK_ROLE_TOP_UPS[key] ?? []).filter((permission) => !current.includes(permission));
    const label = `${role.tenant.businessName} / ${role.name} (${key})`;
    if (!missing.length) {
      console.log(`  SKIP  ${label} — already current`);
      continue;
    }
    if (!role.isSystem || !isUntouchedPreTaskRole(key, current)) {
      console.log(`  SKIP  ${label} — customised (${current.length}, expected ${PRE_TASK_ROLE_PERMISSIONS[key].length}); left unchanged`);
      continue;
    }
    if (APPLY) {
      await prisma.role.update({ where: { id: role.id }, data: { permissions: [...current, ...missing] } });
    }
    console.log(`  ${APPLY ? "DONE" : "WOULD"}  ${label} — +${missing.join(", ")}`);
  }

  if (!APPLY) console.log("\nNothing was written. Re-run with --apply.");
}

main()
  .catch((error: unknown) => {
    console.error("Tasks backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

