import { z } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  ALL_PERMISSIONS,
  isKnownPermission,
  WILDCARD,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  assertClinicInTenant,
  can,
  requirePermission,
  ScopeError,
  toPermissionList,
  type ActorContext,
} from "@/lib/rbac";

/**
 * Roles and role assignment — PRD §6.8 (FR-8.1, FR-8.2).
 *
 * Role management is **account-wide by nature**: a Role row belongs to a
 * Tenant, not to a clinic, so every check here asks for `role:manage`
 * account-wide (no clinic id). A clinic-scoped grant of it would let someone
 * rewrite roles that reach clinics they cannot see.
 *
 * PRD §4 gives role management to the Owner only — the Admin row lists
 * patients, doctors and registrations, not roles — so the seeded Admin holds
 * neither `role:read` nor `role:manage`. They are ordinary permissions, though,
 * not a hardcoded owner check: §4 also says the seed set is "not a hardcoded
 * enum the UI locks to", so an Owner can put them on a custom role.
 *
 * Three rules exist here that the PRD does not spell out but that a permissions
 * editor is unsafe without. Each one is a lockout or an escalation waiting to
 * happen, so none should be relaxed without a replacement:
 *
 *   1. **No granting what you do not hold.** Without this, `role:manage` is
 *      really "become the owner": tick every box, assign the role to yourself.
 *   2. **The wildcard is never mintable.** `*` is granted by seeding the Owner
 *      role, never by the editor — see lib/permissions.ts.
 *   3. **The account always keeps an owner.** No edit or unassignment may
 *      remove the last account-wide holder of `*`, which would lock everyone
 *      out of role management permanently, with no way back in through the UI.
 */

const MANAGE = "role:manage";
const READ = "role:read";

const permissionListSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(ALL_PERMISSIONS.length)
  // Deduped rather than rejected: two ticks of the same box is not a user error.
  .transform((values) => [...new Set(values)]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Role name is required.").max(255),
  permissions: permissionListSchema,
});

export const updateRoleSchema = z.object({
  roleId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1, "Role name is required.").max(255).optional(),
  permissions: permissionListSchema.optional(),
});

export const assignRoleSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  roleId: z.string().trim().min(1).max(64),
  /** Omitted or empty = account-wide (FR-8.2's "optionally scoped"). */
  clinicId: z.string().trim().max(64).optional(),
});

export const unassignRoleSchema = z.object({
  assignmentId: z.string().trim().min(1).max(64),
});

/**
 * One endpoint, three mutations of existing configuration. The scaffold defines
 * GET/POST/PATCH and no DELETE, so unassigning arrives here rather than at a
 * verb the route does not have.
 */
export const roleMutationSchema = z.discriminatedUnion("action", [
  updateRoleSchema.extend({ action: z.literal("updateRole") }),
  assignRoleSchema.extend({ action: z.literal("assign") }),
  unassignRoleSchema.extend({ action: z.literal("unassign") }),
]);

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type RoleMutationInput = z.infer<typeof roleMutationSchema>;

export interface RoleSummary {
  id: string;
  name: string;
  permissions: string[];
  /** Holds `*`. Rendered as "Everything" and not editable in the UI. */
  isWildcard: boolean;
  assignmentCount: number;
}

export interface AssignmentSummary {
  id: string;
  roleId: string;
  roleName: string;
  /** null = account-wide. */
  clinicId: string | null;
  clinicName: string | null;
}

export interface AccountUser {
  id: string;
  name: string | null;
  email: string;
  /** True for the signed-in user, so the UI can warn before self-demotion. */
  isSelf: boolean;
  assignments: AssignmentSummary[];
}

export interface RolesOverview {
  roles: RoleSummary[];
  users: AccountUser[];
  clinics: { id: string; name: string }[];
  /**
   * What this actor may put on a role. A wildcard holder gets the whole
   * catalogue; anyone else gets only what they hold themselves (rule 1).
   */
  grantablePermissions: string[];
  /** False for a `role:read`-only viewer — the UI hides every control. */
  canManage: boolean;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Every permission the actor holds through an ACCOUNT-WIDE assignment.
 *
 * Clinic-scoped grants are excluded on purpose: roles are account-wide objects,
 * so a permission held only inside Clinic A must not become grantable to a role
 * that reaches the whole account.
 */
async function accountWidePermissions(actor: ActorContext): Promise<Set<string>> {
  const assignments = await prisma.userRole.findMany({
    where: {
      userId: actor.userId,
      clinicId: null,
      role: { tenantId: actor.tenantId },
    },
    select: { role: { select: { permissions: true } } },
  });

  const held = new Set<string>();
  for (const assignment of assignments) {
    for (const permission of toPermissionList(assignment.role.permissions)) {
      held.add(permission);
    }
  }
  return held;
}

/**
 * Rule 2 — everything written to a role must be in the catalogue.
 *
 * Catches `*` as well, since the wildcard is deliberately absent from it: this
 * is what stops the editor from minting an owner role.
 */
function assertKnown(requested: readonly string[]): void {
  const unknown = requested.filter((permission) => !isKnownPermission(permission));

  if (unknown.length > 0) {
    throw new BadRequestError(
      `Unknown permission: ${unknown[0]}. Pick from the listed permissions.`,
    );
  }
}

/**
 * Rule 1 — you cannot hand out reach you do not have.
 *
 * Applied when authoring a role AND when assigning one: granting someone a
 * role whose permissions you lack is the same escalation by another route.
 */
function assertHeld(held: Set<string>, requested: readonly string[]): void {
  if (held.has(WILDCARD)) {
    return;
  }

  const beyond = requested.filter((permission) => !held.has(permission));
  if (beyond.length > 0) {
    throw new BadRequestError(
      "You can only grant permissions you hold yourself. Ask the account owner " +
        "to grant the rest.",
    );
  }
}

/**
 * Rule 3 — the account must keep at least one account-wide wildcard holder.
 *
 * `ignoreAssignmentId` models the row about to be deleted; `roleLosingWildcard`
 * models a role about to have `*` taken off it. Both are checked BEFORE the
 * write, so the account can never pass through a state with no owner.
 */
async function assertOwnerRemains(
  tenantId: string,
  options: { ignoreAssignmentId?: string; roleLosingWildcard?: string } = {},
): Promise<void> {
  const wildcardRoles = await prisma.role.findMany({
    where: { tenantId },
    select: { id: true, permissions: true },
  });

  const stillWildcard = wildcardRoles
    .filter((role) => toPermissionList(role.permissions).includes(WILDCARD))
    .filter((role) => role.id !== options.roleLosingWildcard)
    .map((role) => role.id);

  if (stillWildcard.length === 0) {
    throw new ConflictError(
      "That would leave the account with no owner role. Give another role full " +
        "permissions first.",
    );
  }

  const remaining = await prisma.userRole.count({
    where: {
      roleId: { in: stillWildcard },
      clinicId: null,
      ...(options.ignoreAssignmentId ? { id: { not: options.ignoreAssignmentId } } : {}),
      user: { tenantId },
    },
  });

  if (remaining === 0) {
    throw new ConflictError(
      "That would leave nobody with account-wide owner access. Assign the owner " +
        "role to someone else first.",
    );
  }
}

/**
 * Rules 1 and 2 as one call, for a caller that hands out an EXISTING role.
 *
 * Stage 6 needs this: an invitation names the role its holder will get on
 * acceptance, so issuing one is handing out reach and must obey the same limit
 * as assigning it directly — you cannot invite someone into a role you could
 * not assign them yourself, and nobody but an account owner can invite an owner.
 *
 * Exported so there is exactly ONE implementation of "may this actor grant this
 * role". A second copy in the invitations module would be the weaker door the
 * moment either changed.
 *
 * Deliberately does NOT re-validate the role's permissions against the
 * catalogue, matching `assignRole`: handing out an existing role is not
 * authoring one, and a legacy string on a seeded role must not block a
 * legitimate grant.
 */
export async function assertRoleGrantableBy(
  actor: ActorContext,
  rolePermissions: readonly string[],
): Promise<void> {
  const held = await accountWidePermissions(actor);

  if (rolePermissions.includes(WILDCARD) && !held.has(WILDCARD)) {
    throw new BadRequestError("Only an account owner can assign the owner role.");
  }

  assertHeld(held, rolePermissions);
}

export interface GrantableRole {
  id: string;
  name: string;
  /** Holds `*`. Only another wildcard holder may hand it out. */
  isWildcard: boolean;
}

/**
 * The roles this actor could actually hand to somebody — the read-side
 * counterpart of `assertRoleGrantableBy`, for a form that has to render a
 * choice before anyone submits it.
 *
 * Offering a role the write side would refuse is how a user learns to distrust
 * the interface, so the two are computed from the same held set.
 */
export async function listGrantableRoles(
  actor: ActorContext,
): Promise<GrantableRole[]> {
  const [roles, held] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, permissions: true },
    }),
    accountWidePermissions(actor),
  ]);

  const hasWildcard = held.has(WILDCARD);

  return roles
    .map((role) => {
      const permissions = toPermissionList(role.permissions);
      return {
        id: role.id,
        name: role.name,
        isWildcard: permissions.includes(WILDCARD),
        canGrant:
          hasWildcard ||
          (!permissions.includes(WILDCARD) &&
            permissions.every((permission) => held.has(permission))),
      };
    })
    .filter((role) => role.canGrant)
    .map(({ id, name, isWildcard }) => ({ id, name, isWildcard }));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Confirms the role belongs to the actor's account before it is touched. */
async function loadRole(actor: ActorContext, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, tenantId: actor.tenantId },
    select: { id: true, name: true, permissions: true },
  });

  if (!role) {
    // 404, not 403 — another account's role id must not be confirmable.
    throw new ScopeError();
  }

  return role;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** FR-8.1 / FR-8.2 — everything the roles screen renders, in one round trip. */
export async function getRolesOverview(actor: ActorContext): Promise<RolesOverview> {
  await requirePermission(actor, READ);

  const [roles, users, clinics, held, canManage] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        permissions: true,
        _count: { select: { userRoles: true } },
      },
    }),
    prisma.user.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: {
          select: {
            id: true,
            roleId: true,
            clinicId: true,
            role: { select: { name: true } },
            clinic: { select: { name: true } },
          },
        },
      },
    }),
    prisma.clinic.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    accountWidePermissions(actor),
    can(actor, MANAGE),
  ]);

  return {
    roles: roles.map((role) => {
      const permissions = [...toPermissionList(role.permissions)];
      return {
        id: role.id,
        name: role.name,
        permissions,
        isWildcard: permissions.includes(WILDCARD),
        assignmentCount: role._count.userRoles,
      };
    }),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      isSelf: user.id === actor.userId,
      assignments: user.userRoles.map((assignment) => ({
        id: assignment.id,
        roleId: assignment.roleId,
        roleName: assignment.role.name,
        clinicId: assignment.clinicId,
        clinicName: assignment.clinic?.name ?? null,
      })),
    })),
    clinics,
    grantablePermissions: held.has(WILDCARD)
      ? [...ALL_PERMISSIONS]
      : ALL_PERMISSIONS.filter((permission) => held.has(permission)),
    canManage,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** FR-8.1 — creates a custom role under the actor's account. */
export async function createRole(
  actor: ActorContext,
  input: CreateRoleInput,
): Promise<RoleSummary> {
  await requirePermission(actor, MANAGE);
  assertKnown(input.permissions);
  assertHeld(await accountWidePermissions(actor), input.permissions);

  try {
    const role = await prisma.role.create({
      data: {
        // From the session, never from the request body.
        tenantId: actor.tenantId,
        name: input.name,
        permissions: input.permissions,
      },
      select: { id: true, name: true, permissions: true },
    });

    return {
      id: role.id,
      name: role.name,
      permissions: [...toPermissionList(role.permissions)],
      isWildcard: false,
      assignmentCount: 0,
    };
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A role with that name already exists.");
    }
    throw error;
  }
}

/** FR-8.1 — renames a role and/or rewrites its permission set. */
export async function updateRole(
  actor: ActorContext,
  input: Extract<RoleMutationInput, { action: "updateRole" }>,
): Promise<RoleSummary> {
  await requirePermission(actor, MANAGE);

  const role = await loadRole(actor, input.roleId);
  const current = [...toPermissionList(role.permissions)];
  const heldByActor = await accountWidePermissions(actor);

  if (input.permissions !== undefined) {
    assertKnown(input.permissions);
    assertHeld(heldByActor, input.permissions);

    // The catalogue cannot express `*`, so saving the owner role through the
    // editor would strip it. Allowed only while another role still carries
    // account-wide owner access — rule 3.
    if (current.includes(WILDCARD)) {
      await assertOwnerRemains(actor.tenantId, { roleLosingWildcard: role.id });
    }
  }

  try {
    const updated = await prisma.role.update({
      where: { id: role.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
      },
      select: {
        id: true,
        name: true,
        permissions: true,
        _count: { select: { userRoles: true } },
      },
    });

    const permissions = [...toPermissionList(updated.permissions)];
    return {
      id: updated.id,
      name: updated.name,
      permissions,
      isWildcard: permissions.includes(WILDCARD),
      assignmentCount: updated._count.userRoles,
    };
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A role with that name already exists.");
    }
    throw error;
  }
}

/** FR-8.2 — assigns a role to a user, account-wide or scoped to one clinic. */
export async function assignRole(
  actor: ActorContext,
  input: Extract<RoleMutationInput, { action: "assign" }>,
): Promise<AssignmentSummary> {
  await requirePermission(actor, MANAGE);

  const role = await loadRole(actor, input.roleId);

  // Scoped by tenant: a user id from another account must not resolve.
  const user = await prisma.user.findFirst({
    where: { id: input.userId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!user) {
    throw new ScopeError();
  }

  const clinicId = input.clinicId === "" ? undefined : input.clinicId;
  if (clinicId) {
    await assertClinicInTenant(actor.tenantId, clinicId);
  }

  // Rule 1. The role's permissions are NOT re-validated against the catalogue
  // here — assigning an existing role is not authoring it, and a legacy string
  // on a seeded role should not block a legitimate assignment.
  await assertRoleGrantableBy(actor, [...toPermissionList(role.permissions)]);

  // MySQL treats NULLs as distinct, so the @@unique on
  // (user_id, role_id, clinic_id) does NOT stop a duplicate account-wide row.
  // Checked explicitly rather than relying on the constraint.
  const duplicate = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, clinicId: clinicId ?? null },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictError("That user already holds this role in that scope.");
  }

  const created = await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id, clinicId: clinicId ?? null },
    select: {
      id: true,
      roleId: true,
      clinicId: true,
      role: { select: { name: true } },
      clinic: { select: { name: true } },
    },
  });

  return {
    id: created.id,
    roleId: created.roleId,
    roleName: created.role.name,
    clinicId: created.clinicId,
    clinicName: created.clinic?.name ?? null,
  };
}

/** FR-8.2 — removes one assignment, subject to rule 3. */
export async function unassignRole(
  actor: ActorContext,
  input: Extract<RoleMutationInput, { action: "unassign" }>,
): Promise<{ removed: true }> {
  await requirePermission(actor, MANAGE);

  const assignment = await prisma.userRole.findFirst({
    where: {
      id: input.assignmentId,
      // Both sides scoped: an assignment is only this account's if its user and
      // its role both are.
      user: { tenantId: actor.tenantId },
      role: { tenantId: actor.tenantId },
    },
    select: {
      id: true,
      clinicId: true,
      role: { select: { permissions: true } },
    },
  });

  if (!assignment) {
    throw new ScopeError();
  }

  const isAccountWideOwner =
    assignment.clinicId === null &&
    toPermissionList(assignment.role.permissions).includes(WILDCARD);

  if (isAccountWideOwner) {
    await assertOwnerRemains(actor.tenantId, { ignoreAssignmentId: assignment.id });
  }

  await prisma.userRole.delete({ where: { id: assignment.id } });

  return { removed: true };
}
