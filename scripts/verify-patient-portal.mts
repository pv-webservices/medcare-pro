/** Read-only schema/catalogue checks. No patient activation or data writes. */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEATURES, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { TENANT_SCOPED_FEATURES, MODULE_FEATURES } from "@/lib/moduleFeatures";
let checks = 0,
  failures = 0;
function check(label: string, pass: boolean) {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
}
async function main() {
  check(
    "Patient portal CORE/default-plan catalogue",
    !!DEFAULT_FEATURES.find(
      (f) =>
        f.key === "patient_portal" &&
        f.tier === "CORE" &&
        f.globalEnabled &&
        f.inDefaultPlan,
    ),
  );
  check(
    "Tenant feature classified independently of staff modules",
    TENANT_SCOPED_FEATURES.patientPortal === "patient_portal" &&
      !Object.values(MODULE_FEATURES).some(
        (f) => (f as string) === "patient_portal",
      ),
  );
  check(
    "Default roles grant account management only to Admin and Receptionist",
    DEFAULT_ROLES.every(
      (r) =>
        r.permissions.includes("patient_portal:manage") ===
        ["CLINIC_ADMIN", "RECEPTIONIST"].includes(r.key),
    ),
  );
  const tables = await prisma.$queryRaw<
    { TABLE_NAME: string }[]
  >`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'patient_portal_%'`;
  check("Six patient identity tables deployed", tables.length === 6);
  const indexes = await prisma.$queryRaw<
    { TABLE_NAME: string; INDEX_NAME: string; NON_UNIQUE: number }[]
  >`SELECT DISTINCT TABLE_NAME, INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'patient_portal_%'`;
  for (const [table, fragment] of [
    ["patient_portal_accounts", "mobile_e164"],
    ["patient_portal_links", "active_patient_id"],
    ["patient_portal_links", "active_account_id"],
    ["patient_portal_activations", "active_patient_id"],
    ["patient_portal_sessions", "token_hash"],
    ["patient_portal_activations", "token_hash"],
  ])
    check(
      `Unique ${table}/${fragment}`,
      indexes.some(
        (i) =>
          i.TABLE_NAME === table &&
          i.INDEX_NAME.includes(fragment) &&
          Number(i.NON_UNIQUE) === 0,
      ),
    );
  const foreignKeys = await prisma.$queryRaw<
    { CONSTRAINT_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }[]
  >`SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'patient_portal_%'`;
  check(
    "No identity foreign key cascades deletion",
    foreignKeys.length === 12 &&
      foreignKeys.every(
        (k) => k.DELETE_RULE === "RESTRICT" || k.DELETE_RULE === "SET NULL",
      ),
  );
  const constraints = await prisma.$queryRaw<
    { CONSTRAINT_NAME: string }[]
  >`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND CONSTRAINT_NAME LIKE 'portal_%'`;
  check(
    "Live keys/challenge CHECK constraints installed",
    constraints.length === 4,
  );
  const feature = await prisma.feature.findUnique({
    where: { key: "patient_portal" },
  });
  check("Patient portal feature installed", !!feature);
  const plan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
  });
  check(
    "Standard plan link installed",
    !!feature &&
      !!plan &&
      !!(await prisma.planFeature.findUnique({
        where: {
          planId_featureId: { planId: plan!.id, featureId: feature!.id },
        },
      })),
  );
  console.log(
    `Patient Portal read-only verification: ${checks - failures}/${checks} passed`,
  );
  if (failures) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error("Patient Portal verifier failed; database details withheld.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
