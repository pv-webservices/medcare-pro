/**
 * Adds dashboard data rights to untouched seeded roles in existing local
 * tenants. Dry-run by default; pass --apply to write. Customised roles are
 * reported and left byte-for-byte unchanged for an owner to review in the UI.
 */
import { prisma } from "@/lib/prisma";
import {
  DASHBOARD_ROLE_TOP_UPS,
  PRE_DASHBOARD_ROLE_PERMISSIONS,
  ROLE_KEYS,
  isUntouchedPreDashboardRole,
  type RoleKey,
} from "@/lib/defaultRoles";
import { toPermissionList } from "@/lib/rbac";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const keys = [
  ROLE_KEYS.CLINIC_ADMIN,
  ROLE_KEYS.DOCTOR,
  ROLE_KEYS.RECEPTIONIST,
  ROLE_KEYS.STAFF,
] as const;

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Dashboard permission backfill — APPLYING\n"
      : "Dashboard permission backfill — dry run (pass --apply to write)\n",
  );

  const roles = await prisma.role.findMany({
    where: { key: { in: [...keys] }, tenant: { isPlatform: false } },
    select: {
      id: true,
      key: true,
      name: true,
      permissions: true,
      isSystem: true,
      tenant: { select: { businessName: true } },
    },
    orderBy: { id: "asc" },
  });

  let toppedUp = 0;
  let currentCount = 0;
  let customised = 0;

  for (const role of roles) {
    const key = role.key as RoleKey;
    const current = [...toPermissionList(role.permissions)];
    const additions = DASHBOARD_ROLE_TOP_UPS[key] ?? [];
    const missing = additions.filter((permission) => !current.includes(permission));
    const label = `${role.tenant.businessName} / ${role.name} (${key})`;

    if (missing.length === 0) {
      currentCount += 1;
      console.log(`  SKIP  ${label} — already current`);
      continue;
    }

    if (!role.isSystem || !isUntouchedPreDashboardRole(key, current)) {
      customised += 1;
      console.log(
        `  SKIP  ${label} — customised (${current.length} permissions, expected ${PRE_DASHBOARD_ROLE_PERMISSIONS[key].length}); left unchanged`,
      );
      continue;
    }

    if (APPLY) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: [...current, ...missing] },
      });
    }
    toppedUp += 1;
    console.log(`  ${APPLY ? "DONE" : "WOULD"}  ${label} — +${missing.join(", ")}`);
  }

  console.log(
    [
      "",
      `Seeded roles examined: ${roles.length}`,
      `  topped up:           ${toppedUp}`,
      `  already current:     ${currentCount}`,
      `  customised, skipped: ${customised}`,
      !APPLY ? "Nothing was written. Re-run with --apply." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Dashboard permission backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
