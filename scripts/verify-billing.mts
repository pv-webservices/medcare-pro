/** Read-only PB-1 deployment checks. Explicitly select the database before running. */
import "./require-node-24.mjs";
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";

let failures = 0;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures++;
}
async function main() {
  const tables = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
    ('clinic_billing_settings','service_items','invoices','invoice_lines','invoice_payments','invoice_number_sequences')`;
  check("All six billing tables deployed", tables.length === 6);
  const indexes = await prisma.$queryRaw<{ INDEX_NAME: string; columns_list: string }[]>`
    SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_list
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME`;
  for (const columns of ["active_key", "clinic_id,invoice_number", "replaces_invoice_id"])
    check(`Invoice unique index (${columns})`, indexes.some((index) => index.columns_list === columns));
  const feature = await prisma.feature.findUnique({ where: { key: "billing" }, select: { id: true, tier: true } });
  check("Billing CORE feature installed", feature?.tier === "CORE");
  const plan = await prisma.plan.findUnique({ where: { key: DEFAULT_PLAN_KEY }, select: { id: true } });
  const link = feature && plan ? await prisma.planFeature.findUnique({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } }, select: { enabled: true },
  }) : null;
  check("Standard plan link present (explicit disabled switches preserved)", link !== null);
  if (failures) throw new Error("Billing verification failed");
}
main().catch(() => {
  console.error(`Billing verification failed (${failures} failed checks). No data was changed.`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
