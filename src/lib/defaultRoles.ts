import type { PrismaClient } from "@prisma/client";

/**
 * The default role set every tenant starts with — PRD §4.
 *
 * This lives in src/lib rather than prisma/seed.ts because both the signup
 * route and the seed CLI need it. prisma/seed.ts executes `main()` at module
 * scope, so importing from it would run the whole seed script as a side effect
 * of a signup request. seed.ts imports this module instead.
 */

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
      "clinic:create",
      "clinic:edit",
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

/** The role assigned to the user created at signup — FR-1.1. */
export const OWNER_ROLE_NAME = "Owner";

/**
 * Accepts either a PrismaClient or a transaction client, so the signup route
 * can call this inside its transaction.
 */
export type PrismaClientOrTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Idempotent: re-running updates each role's permissions in place rather than
 * creating duplicates, so a permission change here can be replayed safely.
 */
export async function seedDefaultRoles(
  client: PrismaClientOrTransaction,
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
