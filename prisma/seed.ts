import { PrismaClient } from "@prisma/client";
import { addMissingDefaultRoles, seedDefaultRoles } from "../src/lib/defaultRoles";
import { seedFeatureCatalogue } from "../src/lib/defaultFeatures";

/**
 * Seeds the platform-wide feature catalogue and each tenant's default roles.
 *
 * v2 has self-signup (FR-1.1), so this script no longer provisions an admin
 * user by hand. Roles are created per tenant by the signup route; this CLI
 * exists to backfill tenants that predate a change to the default role set.
 *
 *   TENANT_ID=<id> npx prisma db seed   # one tenant
 *   npx prisma db seed                  # every existing tenant
 *
 * SEED_MODE picks how existing roles are treated:
 *
 *   SEED_MODE=upsert       (default, unchanged behaviour)
 *       Rewrites each default role's permissions to match DEFAULT_ROLES. This is
 *       what you want after adding a permission to the catalogue — but it
 *       DISCARDS any customisation a tenant made through the roles editor.
 *
 *   SEED_MODE=create-only  (safe)
 *       Inserts default roles the tenant is missing and touches nothing else.
 *       Use this on any database with real tenants on it.
 *
 * The role definitions live in src/lib/defaultRoles.ts and the feature
 * catalogue in src/lib/defaultFeatures.ts, so the signup route can import them
 * without executing this script.
 *
 * NOTE: this is not the Stage 1 migration tool. The one-off backfill of the
 * columns Stage 1 added lives in scripts/backfill-stage1.mts, which is guarded
 * to localhost and reports on what it changed.
 */

const prisma = new PrismaClient();

type SeedMode = "upsert" | "create-only";

function resolveMode(): SeedMode {
  const requested = process.env.SEED_MODE?.trim();

  if (requested === "create-only") {
    return "create-only";
  }
  if (requested === undefined || requested === "" || requested === "upsert") {
    return "upsert";
  }

  throw new Error(
    `Unknown SEED_MODE "${requested}". Use "upsert" or "create-only".`,
  );
}

async function seedTenant(tenantId: string, mode: SeedMode): Promise<void> {
  if (mode === "create-only") {
    const { created } = await addMissingDefaultRoles(prisma, tenantId);
    if (created.length > 0) {
      console.info(`  ${tenantId}: added ${created.join(", ")}`);
    }
    return;
  }
  await seedDefaultRoles(prisma, tenantId);
}

async function main(): Promise<void> {
  const mode = resolveMode();
  const tenantId = process.env.TENANT_ID?.trim();

  // Platform-wide and tenant-independent, so it runs either way. Create-only by
  // construction: it never rewrites a feature's global switch, because an Owner
  // may have deliberately turned one off.
  const catalogue = await seedFeatureCatalogue(prisma);
  if (catalogue.createdFeatures.length > 0) {
    console.info(`Seeded features: ${catalogue.createdFeatures.join(", ")}.`);
  }
  if (catalogue.createdPlan || catalogue.linkedFeatures.length > 0) {
    console.info("Seeded the default plan.");
  }

  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`No tenant with id ${tenantId}.`);
    }
    await seedTenant(tenantId, mode);
    console.info(`Seeded default roles for tenant ${tenantId} (${mode}).`);
    return;
  }

  // No TENANT_ID given — every existing tenant. On a fresh database this is a
  // no-op, which is the expected case: roles are created per tenant at signup,
  // not ahead of time.
  //
  // The reserved platform tenant is skipped: it holds Platform Owner logins, and
  // clinic roles have no meaning there.
  const tenants = await prisma.tenant.findMany({
    where: { isPlatform: false },
    select: { id: true },
  });

  if (tenants.length === 0) {
    console.info(
      "No tenants yet — nothing to seed. Roles are created per tenant at signup.",
    );
    return;
  }

  if (mode === "upsert") {
    console.warn(
      "SEED_MODE=upsert rewrites every default role's permissions, discarding " +
        "any customisation. Use SEED_MODE=create-only on a database with real " +
        "tenants.",
    );
  }

  for (const tenant of tenants) {
    await seedTenant(tenant.id, mode);
  }
  console.info(`Seeded default roles for ${tenants.length} tenant(s) (${mode}).`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
