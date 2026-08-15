import { PrismaClient } from "@prisma/client";

/**
 * Seeds the three default roles for a tenant — PRD §4.
 *
 * v2 has self-signup (FR-1.1), so this script no longer provisions an admin
 * user by hand. Instead it defines the default role set that every new tenant
 * starts with; the signup flow calls `seedDefaultRoles` for the tenant it just
 * created, and the owner User is assigned the Owner role there.
 *
 * Run directly to backfill a tenant that predates a role change:
 *   TENANT_ID=<id> npx prisma db seed
 */

const prisma = new PrismaClient();

/**
 * Permission strings are `<resource>:<action>`. lib/rbac.ts matches these
 * exactly, plus the `*` wildcard which grants everything.
 */
export const DEFAULT_ROLES = [
  {
    name: "Owner",
    // Account-wide, everything. PRD §4.
    permissions: ["*"],
  },
  {
    name: "Admin",
    permissions: [
      "clinic:read",
      "doctor:read",
      "doctor:create",
      "doctor:edit",
      "doctor:delete",
      "patient:read",
      "patient:create",
      "patient:edit",
      "registration:read",
      "registration:create",
      "registration:edit",
      // FR-3.6 — Admin can see the audit trail; Staff deliberately cannot.
      "registration:history:read",
      "report:read",
      "notification:read",
      "message:send",
    ],
  },
  {
    name: "Staff",
    permissions: [
      "clinic:read",
      "doctor:read",
      "patient:read",
      "patient:create",
      "patient:edit",
      "registration:read",
      "registration:create",
      // Staff may edit (the edit is still logged) but cannot read the log back.
      "registration:edit",
    ],
  },
] as const;

/**
 * Idempotent: re-running updates each role's permissions in place rather than
 * creating duplicates, so a permission change here can be replayed safely.
 */
export async function seedDefaultRoles(
  client: PrismaClient,
  tenantId: string,
): Promise<void> {
  for (const role of DEFAULT_ROLES) {
    await client.role.upsert({
      where: { tenantId_name: { tenantId, name: role.name } },
      update: { permissions: [...role.permissions] },
      create: {
        tenantId,
        name: role.name,
        permissions: [...role.permissions],
      },
    });
  }
}

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
