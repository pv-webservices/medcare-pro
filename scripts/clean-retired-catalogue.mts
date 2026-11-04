/**
 * RM-3: remove what RM-1 and RM-2 retired from the stored catalogue.
 *
 *   - the `clinical_ai` feature row, with its plan links, tenant overrides and
 *     role feature access (all would cascade; they are deleted explicitly so the
 *     dry run can show them);
 *   - `clinical-ai:*`, `dashboard:customize` and `dashboard:layout:manage` from
 *     every stored role's permission array. Nothing else in a role changes and
 *     the order of the remaining keys is kept.
 *
 * Dry run by default. Writes need --apply, and --allow-remote for a non-local
 * DATABASE_URL. Idempotent. Modelled on scripts/backfill-billing.mts.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { toPermissionList } from "@/lib/rbac";
import { describeScriptError } from "@/lib/scriptErrors";

const RETIRED_FEATURE_KEY = "clinical_ai";
const RETIRED_EXACT = new Set(["dashboard:customize", "dashboard:layout:manage"]);
const RETIRED_PREFIX = "clinical-ai:";

function isRetiredPermission(permission: string): boolean {
  return RETIRED_EXACT.has(permission) || permission.startsWith(RETIRED_PREFIX);
}

const apply = process.argv.includes("--apply");
const local = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(process.env.DATABASE_URL ?? "mysql://invalid").hostname,
);
if (apply && !local && !process.argv.includes("--allow-remote")) {
  console.error("Remote writes require reviewed approval and --apply --allow-remote.");
  process.exit(1);
}

async function cleanFeature() {
  const feature = await prisma.feature.findUnique({
    where: { key: RETIRED_FEATURE_KEY },
    select: {
      id: true,
      _count: { select: { plans: true, tenantOverrides: true, roleAccess: true } },
    },
  });
  if (!feature) {
    console.log(`Feature ${RETIRED_FEATURE_KEY}: not present.`);
    return;
  }
  const c = feature._count;
  console.log(
    `Feature ${RETIRED_FEATURE_KEY}: ${apply ? "DELETING" : "WOULD DELETE"} with ${c.plans} plan link(s), ${c.tenantOverrides} tenant override(s), ${c.roleAccess} role access row(s).`,
  );
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    await tx.planFeature.deleteMany({ where: { featureId: feature.id } });
    await tx.tenantFeatureOverride.deleteMany({ where: { featureId: feature.id } });
    await tx.roleFeatureAccess.deleteMany({ where: { featureId: feature.id } });
    await tx.feature.delete({ where: { id: feature.id } });
  });
}

async function cleanRoles() {
  const roles = await prisma.role.findMany({
    select: { id: true, tenantId: true, key: true, name: true, permissions: true },
    orderBy: [{ tenantId: "asc" }, { id: "asc" }],
  });
  let changed = 0;
  let malformed = 0;
  for (const role of roles) {
    if (!Array.isArray(role.permissions)) {
      malformed += 1;
      console.log(`SKIP ${role.id} (${role.key ?? "custom"}): permissions are not a list; left untouched.`);
      continue;
    }
    const removed = toPermissionList(role.permissions).filter(isRetiredPermission);
    if (removed.length === 0) continue;
    changed += 1;
    console.log(
      `${apply ? "UPDATE" : "WOULD UPDATE"} ${role.id} tenant ${role.tenantId} ${role.key ?? "custom"} "${role.name}": -${removed.join(",")}`,
    );
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM roles WHERE id = ${role.id} FOR UPDATE`;
      const fresh = await tx.role.findUniqueOrThrow({ where: { id: role.id }, select: { permissions: true } });
      if (!Array.isArray(fresh.permissions)) throw new Error(`Role ${role.id} changed shape since review; refusing to overwrite.`);
      const kept = (fresh.permissions as unknown[]).filter(
        (permission) => typeof permission !== "string" || !isRetiredPermission(permission),
      );
      await tx.role.update({ where: { id: role.id }, data: { permissions: kept as string[] } });
    });
  }
  console.log(`Roles: ${roles.length} scanned, ${changed} ${apply ? "updated" : "to update"}, ${malformed} skipped as malformed.`);
}

async function main() {
  console.log(`Retired catalogue clean-up: ${apply ? "APPLY" : "DRY RUN"}`);
  await cleanFeature();
  await cleanRoles();
  if (!apply) console.log("Nothing written. Review every line above, then re-run with --apply (and --allow-remote for production).");
}

main()
  .catch((error: unknown) => {
    console.error(`Retired catalogue clean-up failed. ${describeScriptError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
