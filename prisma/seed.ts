import { PrismaClient } from "@prisma/client";
import { seedDefaultRoles } from "../src/lib/defaultRoles";

/**
 * Seeds the three default roles for a tenant — PRD §4.
 *
 * v2 has self-signup (FR-1.1), so this script no longer provisions an admin
 * user by hand. Roles are created per tenant by the signup route; this CLI
 * exists to backfill tenants that predate a change to the default role set.
 *
 *   TENANT_ID=<id> npx prisma db seed   # one tenant
 *   npx prisma db seed                  # every existing tenant
 *
 * The role definitions themselves live in src/lib/defaultRoles.ts, so that the
 * signup route can import them without executing this script.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.env.TENANT_ID?.trim();

  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`No tenant with id ${tenantId}.`);
    }
    await seedDefaultRoles(prisma, tenantId);
    console.info(`Seeded default roles for tenant ${tenantId}.`);
    return;
  }

  // No TENANT_ID given — backfill every existing tenant. On a fresh database
  // this is a no-op, which is the expected case: roles are created per tenant
  // at signup, not ahead of time.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  if (tenants.length === 0) {
    console.info(
      "No tenants yet — nothing to seed. Roles are created per tenant at signup.",
    );
    return;
  }

  for (const tenant of tenants) {
    await seedDefaultRoles(prisma, tenant.id);
  }
  console.info(`Seeded default roles for ${tenants.length} tenant(s).`);
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
