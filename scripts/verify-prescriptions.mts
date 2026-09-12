/** Read-only deployment checks. Safe against an explicitly selected database. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEATURES, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { ALL_PERMISSIONS, PRESCRIPTION_PERMISSIONS } from "@/lib/permissions";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";
let failures = 0;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures++;
}
async function main() {
  check(
    "Permission catalogue",
    PRESCRIPTION_PERMISSIONS.every((key) => ALL_PERMISSIONS.includes(key)),
  );
  check(
    "Feature and module catalogue",
    MODULE_FEATURES.prescriptions === "prescriptions" &&
      DEFAULT_FEATURES.some(
        (entry) => entry.key === "prescriptions" && entry.tier === "CORE",
      ),
  );
  check(
    "Doctor seed cannot cancel by default",
    DEFAULT_ROLES.find((role) => role.key === "DOCTOR")!.permissions.includes(
      "prescription:issue",
    ) &&
      !DEFAULT_ROLES.find(
        (role) => role.key === "DOCTOR",
      )!.permissions.includes("prescription:cancel"),
  );
  const tables = await prisma.$queryRaw<
    { TABLE_NAME: string }[]
  >`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('clinical_consultations','prescriptions','prescription_items')`;
  check("Clinical tables deployed", tables.length === 3);
  const columns = await prisma.$queryRaw<
    { COLUMN_NAME: string; IS_NULLABLE: string }[]
  >`SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doctors' AND COLUMN_NAME IN ('qualification','medical_registration_number','registration_council')`;
  check(
    "Nullable Doctor credential columns deployed",
    columns.length === 3 &&
      columns.every((column) => column.IS_NULLABLE === "YES"),
  );
  const indexes = await prisma.$queryRaw<
    { INDEX_NAME: string }[]
  >`SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prescriptions' AND NON_UNIQUE = 0 AND INDEX_NAME IN ('prescriptions_prescription_number_key','prescriptions_active_draft_key_key','prescriptions_supersedes_prescription_id_key','prescriptions_consultation_id_version_key')`;
  check("Lifecycle uniqueness indexes", indexes.length === 4);
  const constraints = await prisma.$queryRaw<
    { DELETE_RULE: string }[]
  >`SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('clinical_consultations','prescriptions','prescription_items')`;
  check(
    "Clinical deletion restricted",
    constraints.length === 16 &&
      constraints.every(
        (entry) =>
          entry.DELETE_RULE === "RESTRICT" || entry.DELETE_RULE === "NO ACTION",
      ),
  );
  const feature = await prisma.feature.findUnique({
    where: { key: "prescriptions" },
    select: { id: true, tier: true, globalEnabled: true },
  });
  check("Prescription feature installed", feature?.tier === "CORE");
  const plan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });
  const link =
    feature && plan
      ? await prisma.planFeature.findUnique({
          where: {
            planId_featureId: { planId: plan.id, featureId: feature.id },
          },
          select: { enabled: true },
        })
      : null;
  check(
    "Standard plan link present (explicit disabled switch is preserved)",
    link !== null,
  );
  if (failures) throw new Error(`${failures} checks failed.`);
}
main()
  .catch(() => {
    console.error(
      `Prescription verification failed (${failures} failed checks). No data was changed.`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
