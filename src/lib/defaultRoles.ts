import type { PrismaClient } from "@prisma/client";
import { ALL_PERMISSIONS } from "@/lib/permissions";

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
    // Owner and Admin both get complete access. The difference is how:
    //
    //   Owner holds the WILDCARD, so any permission added to the catalogue in
    //   future is theirs automatically. It is also the account's lockout
    //   anchor — lib/roles.ts refuses any edit that would leave nobody holding
    //   it account-wide — and it is the only thing that can assign the Owner
    //   role, so an Admin can never mint a new account owner.
    //
    //   Admin holds every permission in the catalogue, spelled out. That is
    //   complete access to every feature that exists, including role
    //   management, while keeping Owner distinct as the account's root.
    //
    // The consequence to remember: a NEW permission added to
    // lib/permissions.ts reaches Owner for free but must be re-seeded to reach
    // Admin. `seedDefaultRoles` is idempotent, so re-running it does that.
    permissions: [...ALL_PERMISSIONS],
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
