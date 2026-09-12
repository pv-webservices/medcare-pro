/**
 * Read-only pre-rollout inventory.
 *
 * Safe before and after the clinic-capacity migration. Before migration it
 * previews the additive default (2 per assigned plan, zero grants); afterwards
 * it reads actual plan policy and active grants. No write statement exists.
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type RawRow = {
  Tenant: string;
  Plan: string;
  Included: number | bigint | string;
  activeGrants: number | bigint | string;
  effectiveLimit: number | bigint | string;
  Clinics: number | bigint | string;
  Status: string;
};

const numberOf = (value: number | bigint | string) => Number(value);

async function main() {
  const schemaState = await prisma.$queryRaw<{ migrated: number | bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS migrated
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'included_clinics'
  `);
  const migrated = numberOf(schemaState[0]?.migrated ?? 0) === 1;

  const rows = migrated
    ? await prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          t.business_name AS Tenant,
          CASE WHEN p.id IS NULL AND sp.id IS NOT NULL THEN 'NO PLAN (Standard compatibility)' ELSE COALESCE(p.name, 'NO PLAN') END AS Plan,
          COALESCE(p.included_clinics, sp.included_clinics, 0) AS Included,
          COALESCE(g.active_grants, 0) AS activeGrants,
          COALESCE(p.included_clinics, sp.included_clinics, 0) + COALESCE(g.active_grants, 0) AS effectiveLimit,
          COUNT(DISTINCT c.id) AS Clinics,
          CASE
            WHEN p.id IS NULL THEN 'NO_PLAN'
            WHEN COUNT(DISTINCT c.id) > COALESCE(p.included_clinics, sp.included_clinics, 0) + COALESCE(g.active_grants, 0) THEN 'OVER_LIMIT'
            WHEN COUNT(DISTINCT c.id) = COALESCE(p.included_clinics, sp.included_clinics, 0) + COALESCE(g.active_grants, 0) THEN 'AT_LIMIT'
            ELSE 'WITHIN_LIMIT'
          END AS Status
        FROM tenants t
        LEFT JOIN plans p ON p.id = t.plan_id
        LEFT JOIN plans sp ON sp.key = 'standard'
        LEFT JOIN clinics c ON c.tenant_id = t.id
        LEFT JOIN (
          SELECT tenant_id, SUM(quantity) AS active_grants
          FROM tenant_clinic_capacity_grants
          WHERE status = 'ACTIVE'
            AND starts_at <= CURRENT_TIMESTAMP(3)
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
          GROUP BY tenant_id
        ) g ON g.tenant_id = t.id
        WHERE t.is_platform = false
        GROUP BY t.id, t.business_name, p.id, p.name, p.included_clinics, sp.id, sp.included_clinics, g.active_grants
        ORDER BY t.business_name ASC
      `)
    : await prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          t.business_name AS Tenant,
          CASE WHEN p.id IS NULL AND sp.id IS NOT NULL THEN 'NO PLAN (Standard compatibility)' ELSE COALESCE(p.name, 'NO PLAN') END AS Plan,
          CASE WHEN p.id IS NOT NULL OR sp.id IS NOT NULL THEN 2 ELSE 0 END AS Included,
          0 AS activeGrants,
          CASE WHEN p.id IS NOT NULL OR sp.id IS NOT NULL THEN 2 ELSE 0 END AS effectiveLimit,
          COUNT(DISTINCT c.id) AS Clinics,
          CASE
            WHEN p.id IS NULL THEN 'NO_PLAN'
            WHEN COUNT(DISTINCT c.id) > 2 THEN 'OVER_LIMIT'
            WHEN COUNT(DISTINCT c.id) = 2 THEN 'AT_LIMIT'
            ELSE 'WITHIN_LIMIT'
          END AS Status
        FROM tenants t
        LEFT JOIN plans p ON p.id = t.plan_id
        LEFT JOIN plans sp ON sp.key = 'standard'
        LEFT JOIN clinics c ON c.tenant_id = t.id
        WHERE t.is_platform = false
        GROUP BY t.id, t.business_name, p.id, p.name, sp.id
        ORDER BY t.business_name ASC
      `);

  const printable = rows.map((row) => ({
    Tenant: row.Tenant,
    Plan: row.Plan,
    Included: numberOf(row.Included),
    "Active grants": numberOf(row.activeGrants),
    "Effective limit": numberOf(row.effectiveLimit),
    Clinics: numberOf(row.Clinics),
    Status: row.Status,
  }));
  console.log(migrated ? "Clinic capacity schema: MIGRATED" : "Clinic capacity schema: PRE-MIGRATION PREVIEW (assigned plans use future default 2)");
  console.table(printable);
  const counts = printable.reduce<Record<string, number>>((result, row) => {
    result[row.Status] = (result[row.Status] ?? 0) + 1;
    return result;
  }, {});
  console.table(counts);
}

main()
  .catch((error: unknown) => {
    console.error("Clinic capacity inventory failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
