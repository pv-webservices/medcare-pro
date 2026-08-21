import type { PrismaClient } from "@prisma/client";
import { ALL_PERMISSIONS, WILDCARD } from "@/lib/permissions";

/**
 * The default role set every tenant starts with — PRD §4.
 *
 * This lives in src/lib rather than prisma/seed.ts because both the signup
 * route and the seed CLI need it. prisma/seed.ts executes `main()` at module
 * scope, so importing from it would run the whole seed script as a side effect
 * of a signup request. seed.ts imports this module instead.
 */

/**
 * Stable machine identifiers for the seeded roles.
 *
 * NEVER USE THESE FOR AUTHORISATION. They exist so that migrations, seeds and
 * tests can find a role without matching a display name the tenant is free to
 * rename. Whether someone may do something is decided by their PERMISSIONS
 * (lib/rbac.ts) — the Clinic Admin check in Stage 6/7 is `team:manage`, not
 * `key === "CLINIC_ADMIN"`.
 */
export const ROLE_KEYS = {
  OWNER: "OWNER",
  CLINIC_ADMIN: "CLINIC_ADMIN",
  DOCTOR: "DOCTOR",
  RECEPTIONIST: "RECEPTIONIST",
  STAFF: "STAFF",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface DefaultRoleDefinition {
  name: string;
  key: RoleKey;
  description: string;
  permissions: readonly string[];
}

/**
 * Permission strings are `<resource>:<action>`. lib/rbac.ts matches these
 * exactly, plus the `*` wildcard which grants everything.
 *
 * The first three entries and their permission arrays are UNCHANGED from before
 * Stage 1. Renaming or re-scoping them would rewrite what every existing tenant
 * already grants, so Doctor and Receptionist are appended instead.
 */
export const DEFAULT_ROLES: readonly DefaultRoleDefinition[] = [
  {
    name: "Owner",
    key: ROLE_KEYS.OWNER,
    description:
      "The organisation's root. Holds every permission, including any added later.",
    // Account-wide, everything. PRD §4.
    permissions: ["*"],
  },
  {
    name: "Admin",
    key: ROLE_KEYS.CLINIC_ADMIN,
    description:
      "Full access to every feature that exists today, including team and role management.",
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
    // Admin. `seedDefaultRoles` is idempotent, so re-running it does that — but
    // read the warning on that function before running it over a live tenant.
    permissions: [...ALL_PERMISSIONS],
  },
  {
    name: "Staff",
    key: ROLE_KEYS.STAFF,
    description: "General clinic staff. Can register patients and record visits.",
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
  // --- Stage 1 additions ---------------------------------------------------
  {
    name: "Doctor",
    key: ROLE_KEYS.DOCTOR,
    description:
      "Clinical read access. Sees patients and visits, but does not create or edit them.",
    // Deliberately narrower than Staff: a doctor looks up who is coming in and
    // what for. They do not run the front desk, and `report:read` is withheld
    // because revenue is the owner's business, not the clinician's.
    permissions: [
      "clinic:read",
      "doctor:read",
      "patient:read",
      "registration:read",
      "notification:read",
    ],
  },
  {
    name: "Receptionist",
    key: ROLE_KEYS.RECEPTIONIST,
    description:
      "The front desk. Registers patients, records visits, and sends WhatsApp confirmations.",
    // Staff's duties plus the two the front desk actually needs on top:
    // notifications and messaging. Staff's own array is deliberately NOT
    // narrowed to make room for this — existing tenants already grant it.
    permissions: [
      "clinic:read",
      "doctor:read",
      "patient:read",
      "patient:create",
      "patient:edit",
      "registration:read",
      "registration:create",
      "registration:edit",
      "notification:read",
      "message:send",
    ],
  },
];

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
 *
 * WARNING — IT OVERWRITES `permissions`. On a brand-new tenant that is exactly
 * right: nothing exists to clobber, which is why the signup route calls this
 * one. Running it across EXISTING tenants would silently revert any role a
 * tenant has customised through the roles editor. Use `addMissingDefaultRoles`
 * for that.
 *
 * Behaviour on permissions is unchanged from before Stage 1. The role metadata
 * added here (key, description, isSystem) is written on both branches so a
 * replayed seed cannot leave a seeded role holding fresh permissions and no key.
 */
export async function seedDefaultRoles(
  client: PrismaClientOrTransaction,
  tenantId: string,
): Promise<void> {
  for (const role of DEFAULT_ROLES) {
    await client.role.upsert({
      where: { tenantId_name: { tenantId, name: role.name } },
      update: {
        permissions: [...role.permissions],
        key: role.key,
        description: role.description,
        isSystem: true,
      },
      create: {
        tenantId,
        name: role.name,
        key: role.key,
        description: role.description,
        isSystem: true,
        permissions: [...role.permissions],
      },
    });
  }
}

/**
 * CREATE-ONLY counterpart to `seedDefaultRoles`, for existing tenants.
 *
 * Inserts any default role the tenant does not already have — in practice the
 * Stage 1 additions, Doctor and Receptionist — and touches nothing else:
 *
 *   - never rewrites an existing role's permissions;
 *   - never renames an existing role;
 *   - never modifies a custom role.
 *
 * Idempotent and safe to run inside the backfill. A role counts as existing if
 * its NAME is taken (the natural key of the @@unique) or if its KEY is already
 * claimed, which stops a tenant that renamed "Doctor" to something else from
 * ending up with two roles keyed DOCTOR. The constrain migration's unique index
 * would reject that anyway, but mid-backfill is a confusing place to find out.
 */
export async function addMissingDefaultRoles(
  client: PrismaClientOrTransaction,
  tenantId: string,
): Promise<{ created: string[] }> {
  const existing = await client.role.findMany({
    where: { tenantId },
    select: { name: true, key: true },
  });

  const takenNames = new Set(existing.map((role) => role.name));
  const takenKeys = new Set(
    existing.map((role) => role.key).filter((key): key is string => key !== null),
  );

  const created: string[] = [];

  for (const role of DEFAULT_ROLES) {
    if (takenNames.has(role.name) || takenKeys.has(role.key)) {
      continue;
    }

    await client.role.create({
      data: {
        tenantId,
        name: role.name,
        key: role.key,
        description: role.description,
        isSystem: true,
        permissions: [...role.permissions],
      },
    });

    takenNames.add(role.name);
    takenKeys.add(role.key);
    created.push(role.name);
  }

  return { created };
}

export interface RoleKeyCandidate {
  id: string;
  name: string;
  permissions: readonly string[];
}

/**
 * Works out which stable key each of a tenant's existing roles should carry.
 *
 * Used ONCE, by the Stage 1 backfill. It is migration metadata, not
 * authorisation — see the warning on ROLE_KEYS.
 *
 * The OWNER key is anchored on the WILDCARD rather than on the name "Owner",
 * because a tenant can rename that role through the editor while it goes on
 * holding `*`. The wildcard is already what lib/roles.ts treats as the account's
 * root, so keying on it stays consistent with the existing lockout guard.
 *
 * Every key is assigned at most once per tenant: the constrain migration adds a
 * unique on (tenant_id, key), so a second claimant is left keyless rather than
 * breaking the migration. A role matching nothing gets `null`, which is the
 * correct answer for a custom role.
 */
export function resolveRoleKeys(
  roles: readonly RoleKeyCandidate[],
): Map<string, RoleKey | null> {
  const assigned = new Map<string, RoleKey | null>();
  const claimed = new Set<RoleKey>();

  for (const role of roles) {
    assigned.set(role.id, null);
  }

  const claim = (roleId: string, key: RoleKey): void => {
    if (claimed.has(key) || assigned.get(roleId) !== null) {
      return;
    }
    assigned.set(roleId, key);
    claimed.add(key);
  };

  // 1. OWNER — the wildcard holder. If several hold it (a tenant may have built
  //    a second full-access role), prefer the one still called "Owner", then
  //    fall back to the lowest id, so the choice is deterministic and a re-run
  //    of the backfill picks the same row.
  const wildcardHolders = roles
    .filter((role) => role.permissions.includes(WILDCARD))
    .sort((a, b) => {
      if (a.name === OWNER_ROLE_NAME && b.name !== OWNER_ROLE_NAME) return -1;
      if (b.name === OWNER_ROLE_NAME && a.name !== OWNER_ROLE_NAME) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (wildcardHolders.length > 0) {
    claim(wildcardHolders[0].id, ROLE_KEYS.OWNER);
  }

  // 2-5. The remaining seeded roles, matched by their seeded display name. A
  //      renamed role simply stays keyless — safer than guessing.
  const byName = new Map<string, RoleKey>(
    DEFAULT_ROLES.filter((role) => role.key !== ROLE_KEYS.OWNER).map(
      (role) => [role.name, role.key] as const,
    ),
  );

  for (const role of roles) {
    const key = byName.get(role.name);
    if (key) {
      claim(role.id, key);
    }
  }

  return assigned;
}
