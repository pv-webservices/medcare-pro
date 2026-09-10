/**
 * Safely migrates untouched seeded roles to doctor-self appointment reads.
 * Dry-run by default. Remote application requires both --apply and the explicit
 * --allow-remote acknowledgement; customised roles and saved layouts are never
 * overwritten.
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import {
  PRE_DOCTOR_SELF_ROLE_PERMISSIONS,
  ROLE_KEYS,
  isUntouchedPreDoctorSelfRole,
  type RoleKey,
} from "@/lib/defaultRoles";
import {
  DASHBOARD_LAYOUT_VERSION,
  doctorDefaultDashboardLayout,
} from "@/lib/dashboardWidgets";
import { prisma } from "@/lib/prisma";
import { toPermissionList } from "@/lib/rbac";

const APPLY = process.argv.includes("--apply");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
const databaseUrl = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);

if (APPLY && !isLocal && !ALLOW_REMOTE) {
  console.error(
    "Refusing remote write. Review the dry run, then pass --apply --allow-remote explicitly.",
  );
  process.exit(1);
}

function replacement(key: RoleKey, current: readonly string[]): string[] {
  if (key === ROLE_KEYS.DOCTOR) {
    return [
      ...current.filter((permission) => permission !== "appointment:read"),
      "appointment:self:read",
    ];
  }
  if (key === ROLE_KEYS.CLINIC_ADMIN) {
    return current.includes("appointment:self:read")
      ? [...current]
      : [...current, "appointment:self:read"];
  }
  return [...current];
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Doctor-self appointment backfill — APPLYING\n"
      : "Doctor-self appointment backfill — dry run (pass --apply to write)\n",
  );

  const roles = await prisma.role.findMany({
    where: {
      key: { in: [ROLE_KEYS.CLINIC_ADMIN, ROLE_KEYS.DOCTOR] },
      tenant: { isPlatform: false },
    },
    select: {
      id: true,
      key: true,
      name: true,
      permissions: true,
      isSystem: true,
      tenantId: true,
      tenant: { select: { businessName: true } },
      dashboardLayouts: { where: { userId: null }, select: { id: true } },
    },
    orderBy: { id: "asc" },
  });

  for (const role of roles) {
    const key = role.key as RoleKey;
    const current = [...toPermissionList(role.permissions)];
    const label = `${role.tenant.businessName} / ${role.name} (${key})`;
    const alreadyCurrent =
      key === ROLE_KEYS.DOCTOR
        ? current.includes("appointment:self:read") && !current.includes("appointment:read")
        : current.includes("appointment:self:read");

    if (alreadyCurrent) {
      console.log(`  SKIP  ${label} — already current`);
      continue;
    }
    if (!role.isSystem || !isUntouchedPreDoctorSelfRole(key, current)) {
      console.log(
        `  SKIP  ${label} — customised (${current.length}, expected ${PRE_DOCTOR_SELF_ROLE_PERMISSIONS[key]?.length ?? 0}); left byte-for-byte unchanged`,
      );
      continue;
    }

    const next = replacement(key, current);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.role.update({ where: { id: role.id }, data: { permissions: next } });
        if (key === ROLE_KEYS.DOCTOR && role.dashboardLayouts.length === 0) {
          await tx.dashboardLayout.create({
            data: {
              tenantId: role.tenantId,
              roleId: role.id,
              version: DASHBOARD_LAYOUT_VERSION,
              layout: doctorDefaultDashboardLayout() as unknown as Prisma.InputJsonValue,
            },
          });
        }
      });
    }
    console.log(
      `  ${APPLY ? "DONE" : "WOULD"}  ${label} — ${
        key === ROLE_KEYS.DOCTOR
          ? "replace appointment:read with appointment:self:read"
          : "add appointment:self:read"
      }${key === ROLE_KEYS.DOCTOR && role.dashboardLayouts.length === 0 ? "; add My Day role layout" : ""}`,
    );
  }

  if (!APPLY) console.log("\nNothing was written. Re-run with --apply after reviewing every row.");
}

main()
  .catch((error: unknown) => {
    console.error("Doctor-self appointment backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
