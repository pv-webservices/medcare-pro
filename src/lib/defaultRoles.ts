import type { PrismaClient } from "@prisma/client";
import {
  ALL_PERMISSIONS,
  DASHBOARD_DATA_PERMISSIONS,
  DASHBOARD_LAYOUT_PERMISSIONS,
  PRE_APPOINTMENTS_PERMISSIONS,
  STAGE_AP1_PERMISSIONS,
  TASK_PERMISSIONS,
  WILDCARD,
} from "@/lib/permissions";

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
      "dashboard:view",
      "dashboard:customize",
      "dashboard:patients:view",
      "dashboard:tasks:view",
      "task:view",
      "task:complete",
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
      // --- AP-1 ---
      // Read only, matching the rest of this role. A doctor looks at their own
      // day; they do not run the booking desk. Notably NOT appointment:cancel —
      // a doctor deciding a slot is free is a front-desk decision.
      "appointment:read",
      "dashboard:view",
      "dashboard:customize",
      "dashboard:appointments:view",
      "dashboard:schedule:view",
      "dashboard:patients:view",
      "dashboard:tasks:view",
      "dashboard:messages:view",
      "task:view",
      "task:create",
      "task:complete",
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
      // --- AP-1 ---
      // The whole booking desk: the front desk is who books, moves, cancels,
      // checks in and converts. Deliberately WITHOUT appointment:type:manage —
      // taking bookings is not the same as setting the price list, and that one
      // is Admin's. See the note on ADMIN-only keys in lib/permissions.ts.
      "appointment:read",
      "appointment:create",
      "appointment:update",
      "appointment:reschedule",
      "appointment:cancel",
      "appointment:checkin",
      "appointment:convert",
      "dashboard:view",
      "dashboard:customize",
      "dashboard:appointments:view",
      "dashboard:patients:view",
      "dashboard:messages:view",
      "dashboard:tasks:view",
      "dashboard:schedule:view",
      "task:view",
      "task:create",
      "task:complete",
    ],
  },
];

/**
 * Frozen permission sets immediately before dashboard data rights were added.
 * A backfill may top up only roles that still match these sets exactly, so a
 * tenant's deliberate role customisation is never overwritten.
 */
export const PRE_DASHBOARD_ROLE_PERMISSIONS: Readonly<
  Record<RoleKey, readonly string[]>
> = {
  [ROLE_KEYS.OWNER]: [WILDCARD],
  [ROLE_KEYS.CLINIC_ADMIN]: ALL_PERMISSIONS.filter(
    (permission) =>
      !TASK_PERMISSIONS.includes(
        permission as (typeof TASK_PERMISSIONS)[number],
      ) &&
      !DASHBOARD_LAYOUT_PERMISSIONS.includes(
        permission as (typeof DASHBOARD_LAYOUT_PERMISSIONS)[number],
      ) &&
      !DASHBOARD_DATA_PERMISSIONS.includes(
        permission as (typeof DASHBOARD_DATA_PERMISSIONS)[number],
      ),
  ),
  [ROLE_KEYS.STAFF]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "patient:create",
    "patient:edit",
    "registration:read",
    "registration:create",
    "registration:edit",
  ],
  [ROLE_KEYS.DOCTOR]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "registration:read",
    "notification:read",
    "appointment:read",
  ],
  [ROLE_KEYS.RECEPTIONIST]: [
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
    "appointment:read",
    "appointment:create",
    "appointment:update",
    "appointment:reschedule",
    "appointment:cancel",
    "appointment:checkin",
    "appointment:convert",
  ],
};

/** Dashboard keys that existed before the Tasks module was introduced. */
const PRE_TASK_DASHBOARD_PERMISSIONS = DASHBOARD_DATA_PERMISSIONS.filter(
  (permission) => permission !== "dashboard:tasks:view",
);

export const DASHBOARD_ROLE_TOP_UPS: Readonly<
  Partial<Record<RoleKey, readonly string[]>>
> = Object.fromEntries(
  DEFAULT_ROLES.filter((role) => role.key !== ROLE_KEYS.OWNER).map((role) => {
    const before = new Set(PRE_DASHBOARD_ROLE_PERMISSIONS[role.key]);
    return [
      role.key,
      role.permissions.filter(
        (permission) =>
          !before.has(permission) &&
          PRE_TASK_DASHBOARD_PERMISSIONS.includes(
            permission as (typeof PRE_TASK_DASHBOARD_PERMISSIONS)[number],
          ),
      ),
    ] as const;
  }),
);

export function isUntouchedPreDashboardRole(
  key: RoleKey,
  permissions: readonly string[],
): boolean {
  const before = PRE_DASHBOARD_ROLE_PERMISSIONS[key];
  const held = new Set(permissions);
  return (
    held.size === before.length &&
    before.every((permission) => held.has(permission))
  );
}

// ---------------------------------------------------------------------------
// Tasks — frozen pre-task snapshots and safe, additive top-ups.
// ---------------------------------------------------------------------------

export const PRE_TASK_ROLE_PERMISSIONS: Readonly<
  Record<RoleKey, readonly string[]>
> = {
  [ROLE_KEYS.OWNER]: [WILDCARD],
  [ROLE_KEYS.CLINIC_ADMIN]: ALL_PERMISSIONS.filter(
    (permission) =>
      permission !== "dashboard:tasks:view" &&
      !DASHBOARD_LAYOUT_PERMISSIONS.includes(
        permission as (typeof DASHBOARD_LAYOUT_PERMISSIONS)[number],
      ) &&
      !TASK_PERMISSIONS.includes(
        permission as (typeof TASK_PERMISSIONS)[number],
      ),
  ),
  [ROLE_KEYS.STAFF]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "patient:create",
    "patient:edit",
    "registration:read",
    "registration:create",
    "registration:edit",
    "dashboard:view",
    "dashboard:registrations:view",
  ],
  [ROLE_KEYS.DOCTOR]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "registration:read",
    "notification:read",
    "appointment:read",
    "dashboard:view",
    "dashboard:appointments:view",
    "dashboard:registrations:view",
    "dashboard:notifications:view",
  ],
  [ROLE_KEYS.RECEPTIONIST]: [
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
    "appointment:read",
    "appointment:create",
    "appointment:update",
    "appointment:reschedule",
    "appointment:cancel",
    "appointment:checkin",
    "appointment:convert",
    "dashboard:view",
    "dashboard:appointments:view",
    "dashboard:registrations:view",
    "dashboard:notifications:view",
  ],
};

export const TASK_ROLE_TOP_UPS: Readonly<
  Partial<Record<RoleKey, readonly string[]>>
> = Object.fromEntries(
  DEFAULT_ROLES.filter((role) => role.key !== ROLE_KEYS.OWNER).map((role) => {
    const before = new Set(PRE_TASK_ROLE_PERMISSIONS[role.key]);
    return [
      role.key,
      role.permissions.filter(
        (permission) =>
          !before.has(permission) &&
          (permission === "dashboard:tasks:view" ||
            TASK_PERMISSIONS.includes(
              permission as (typeof TASK_PERMISSIONS)[number],
            )),
      ),
    ] as const;
  }),
);

export function isUntouchedPreTaskRole(
  key: RoleKey,
  permissions: readonly string[],
): boolean {
  const before = PRE_TASK_ROLE_PERMISSIONS[key];
  const held = new Set(permissions);
  return (
    held.size === before.length &&
    before.every((permission) => held.has(permission))
  );
}

// ---------------------------------------------------------------------------
// AP-1 — frozen pre-appointment snapshots, for the backfill's "untouched?" test
// ---------------------------------------------------------------------------

/**
 * Each seeded role's permission array EXACTLY as it stood before AP-1.
 *
 * FROZEN LITERALS. Never edit these again — not to add a permission, not to
 * reorder one. Their only job is to answer one question during
 * scripts/backfill-ap1-appointments.mts: "is this seeded role still untouched?"
 *
 * This mirrors HISTORICAL_ALL_PERMISSIONS in lib/permissions.ts, which does the
 * same job for the Admin role alone. AP-1 needs the same guarantee for
 * Receptionist and Doctor, which have no such snapshot yet — comparing them
 * against the LIVE arrays above would be useless, since those already contain
 * the appointment keys and so would match nothing.
 *
 * Admin's entry is derived rather than spelled out: it holds the whole
 * catalogue by definition, and PRE_APPOINTMENTS_PERMISSIONS is precisely
 * "the whole catalogue minus what AP-1 added".
 *
 * A role whose stored set does not equal its entry here is left byte-for-byte
 * alone, because a tenant edited it deliberately.
 */
export const PRE_APPOINTMENTS_ROLE_PERMISSIONS: Readonly<
  Record<RoleKey, readonly string[]>
> = {
  // Holds the wildcard, so AP-1's keys are already theirs. Never topped up.
  [ROLE_KEYS.OWNER]: [WILDCARD],
  [ROLE_KEYS.CLINIC_ADMIN]: PRE_APPOINTMENTS_PERMISSIONS,
  [ROLE_KEYS.DOCTOR]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "registration:read",
    "notification:read",
  ],
  [ROLE_KEYS.RECEPTIONIST]: [
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
  // Unchanged by AP-1 and never topped up. Present so this record is complete
  // and a future stage cannot mistake its absence for an oversight.
  [ROLE_KEYS.STAFF]: [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "patient:create",
    "patient:edit",
    "registration:read",
    "registration:create",
    "registration:edit",
  ],
};

/**
 * What the AP-1 backfill appends to each seeded role it finds untouched.
 *
 * Derived from DEFAULT_ROLES minus the frozen snapshot above, so it can never
 * drift from what a NEW tenant is seeded with. Adding a permission to a role
 * array above updates this automatically, and a unit test checks the two agree.
 *
 * STAFF and OWNER are absent, deliberately: Staff gains nothing from AP-1, and
 * Owner already holds everything through the wildcard.
 */
export const APPOINTMENT_ROLE_TOP_UPS: Readonly<
  Partial<Record<RoleKey, readonly string[]>>
> = Object.fromEntries(
  DEFAULT_ROLES.filter(
    (role) => role.key !== ROLE_KEYS.OWNER && role.key !== ROLE_KEYS.STAFF,
  ).map((role) => {
    const before = new Set(PRE_APPOINTMENTS_ROLE_PERMISSIONS[role.key]);
    return [
      role.key,
      role.permissions.filter(
        (permission) =>
          !before.has(permission) &&
          STAGE_AP1_PERMISSIONS.includes(permission),
      ),
    ] as const;
  }),
);

/**
 * True when `permissions` is exactly what this seeded role held before AP-1.
 *
 * Order-insensitive and duplicate-tolerant, matching
 * `isUntouchedHistoricalAdminSet` — the roles editor dedupes and does not
 * preserve catalogue order, so a byte comparison would report false negatives
 * on roles nobody had actually touched.
 */
export function isUntouchedPreAppointmentsRole(
  key: RoleKey,
  permissions: readonly string[],
): boolean {
  const before = PRE_APPOINTMENTS_ROLE_PERMISSIONS[key];
  const held = new Set(permissions);
  return (
    held.size === before.length &&
    before.every((permission) => held.has(permission))
  );
}

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
