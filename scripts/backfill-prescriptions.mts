/** EP entitlement/role installation. Dry-run by default. Never rewrites custom roles. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEATURES, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { planPrescriptionRoleMigration } from "@/lib/prescriptionRoleMigration";
import { toPermissionList } from "@/lib/rbac";

const apply = process.argv.includes("--apply");
const local = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(process.env.DATABASE_URL ?? "mysql://invalid").hostname,
);
if (apply && !local && !process.argv.includes("--allow-remote")) {
  console.error(
    "Remote writes require reviewed approval and --apply --allow-remote.",
  );
  process.exit(1);
}
async function main() {
  console.log(`Prescription backfill: ${apply ? "APPLY" : "DRY RUN"}`);
  const feature = DEFAULT_FEATURES.find(
    (entry) => entry.key === "prescriptions",
  )!;
  const existing = await prisma.feature.findUnique({
    where: { key: feature.key },
  });
  const plan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });
  if (!plan)
    throw new Error(
      "Standard plan missing. Review the existing entitlement configuration first.",
    );
  const link = existing
    ? await prisma.planFeature.findUnique({
        where: {
          planId_featureId: { planId: plan.id, featureId: existing.id },
        },
      })
    : null;
  console.log(
    `${existing ? "KEEP" : "WOULD CREATE"} prescriptions CORE feature; ${link ? "KEEP" : "WOULD LINK"} standard plan. Existing switches/overrides remain authoritative.`,
  );
  if (apply)
    await prisma.$transaction(async (tx) => {
      const row = await tx.feature.upsert({
        where: { key: feature.key },
        update: {},
        create: {
          key: feature.key,
          name: feature.name,
          description: feature.description,
          tier: feature.tier,
          globalEnabled: feature.globalEnabled,
        },
      });
      await tx.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId: row.id } },
        update: {},
        create: { planId: plan.id, featureId: row.id, enabled: true },
      });
    });
  const roles = await prisma.role.findMany({
    where: {
      key: { in: ["DOCTOR", "CLINIC_ADMIN"] },
      tenant: { isPlatform: false },
    },
    select: { id: true, key: true, isSystem: true, permissions: true },
    orderBy: { id: "asc" },
  });
  for (const role of roles) {
    const proposal = planPrescriptionRoleMigration(role);
    console.log(
      `${role.id} ${role.key}: ${proposal.status} +${proposal.additions.join(",")}`,
    );
    if (apply && proposal.status === "ELIGIBLE")
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM roles WHERE id = ${role.id} FOR UPDATE`;
        const fresh = await tx.role.findUniqueOrThrow({
          where: { id: role.id },
        });
        const permissions = toPermissionList(fresh.permissions);
        const checked = planPrescriptionRoleMigration(fresh);
        if (checked.status !== "ELIGIBLE")
          throw new Error(
            `Role ${role.id} changed since review; refusing to overwrite.`,
          );
        await tx.role.update({
          where: { id: role.id },
          data: { permissions: [...permissions, ...checked.additions] },
        });
      });
  }
  if (!apply)
    console.log(
      "Nothing written. Review exact candidates before apply; older/custom roles require explicit manual rights decisions.",
    );
}
main()
  .catch(() => {
    console.error(
      "Prescription backfill failed. Check schema/configuration; no clinical content is logged.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
