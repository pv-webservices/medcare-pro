import { prisma } from "@/lib/prisma";

/**
 * Server-side permission checks — PRD §9 (RBAC enforcement).
 *
 * Every mutating API route calls `requirePermission` (or `can`) BEFORE touching
 * Prisma. Hiding a button in the UI is not access control.
 *
 * Two things are checked together and must never be split apart:
 *   1. Does the user hold a role granting this permission?
 *   2. Does that role's scope cover the clinic being acted on?
 *
 * A role assignment with `clinicId = null` is tenant-wide. An assignment with a
 * `clinicId` set grants the permission only within that clinic.
 */

/** Wildcard granting every permission. Held by the seeded Owner role. */
const WILDCARD = "*";

export interface ActorContext {
  userId: string;
  tenantId: string;
}

/** Thrown when a caller lacks the required permission. Routes map this to 403. */
export class PermissionError extends Error {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Thrown when a clinic does not belong to the caller's tenant. */
export class ScopeError extends Error {
  constructor() {
    // Deliberately vague: distinguishing "not yours" from "does not exist"
    // would let a caller probe for clinic ids belonging to other tenants.
    super("Clinic not found");
    this.name = "ScopeError";
  }
}

function toPermissionList(value: unknown): readonly string[] {
  // `permissions` is a Json column, so Prisma types it as JsonValue. Anything
  // that is not an array of strings is treated as granting nothing rather than
  // being coerced — a malformed row must never widen access.
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Confirms `clinicId` belongs to `tenantId`.
 *
 * Call this before any query that takes a client-supplied clinic id. Per the
 * multi-clinic-data-model skill, a client-supplied clinicId is never trusted on
 * its own — the tenant always comes from the session.
 */
export async function assertClinicInTenant(
  tenantId: string,
  clinicId: string,
): Promise<void> {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, tenantId },
    select: { id: true },
  });

  if (!clinic) {
    throw new ScopeError();
  }
}

/**
 * Resolves whether `actor` holds `permission`, optionally within `clinicId`.
 *
 * When `clinicId` is omitted the check is tenant-wide: only a role assignment
 * with a null `clinicId` can satisfy it. When `clinicId` is given, either a
 * tenant-wide assignment or one scoped to that specific clinic satisfies it.
 */
export async function can(
  actor: ActorContext,
  permission: string,
  clinicId?: string,
): Promise<boolean> {
  const assignments = await prisma.userRole.findMany({
    where: {
      userId: actor.userId,
      // A tenant-wide assignment (null clinic) always applies. A clinic-scoped
      // one applies only to the clinic in question.
      ...(clinicId ? { OR: [{ clinicId: null }, { clinicId }] } : { clinicId: null }),
      // Guards against a role assignment left over from a different tenant.
      role: { tenantId: actor.tenantId },
    },
    select: { role: { select: { permissions: true } } },
  });

  return assignments.some((assignment) => {
    const granted = toPermissionList(assignment.role.permissions);
    return granted.includes(WILDCARD) || granted.includes(permission);
  });
}

/**
 * `can`, but throws instead of returning false — the form routes should use.
 *
 * Also verifies the clinic belongs to the tenant when `clinicId` is supplied,
 * so a single call covers both the permission and the scoping check.
 */
export async function requirePermission(
  actor: ActorContext,
  permission: string,
  clinicId?: string,
): Promise<void> {
  if (clinicId) {
    await assertClinicInTenant(actor.tenantId, clinicId);
  }

  const allowed = await can(actor, permission, clinicId);
  if (!allowed) {
    throw new PermissionError(permission);
  }
}

/**
 * The role name to record in `registration_edit_log.role_at_time`.
 *
 * Captured at edit time and denormalised into the log, so revoking a role later
 * never rewrites the history of what someone held when they made the edit.
 */
export async function resolveRoleNameAtTime(
  actor: ActorContext,
  clinicId?: string,
): Promise<string> {
  const assignment = await prisma.userRole.findFirst({
    where: {
      userId: actor.userId,
      ...(clinicId ? { OR: [{ clinicId: null }, { clinicId }] } : { clinicId: null }),
      role: { tenantId: actor.tenantId },
    },
    select: { role: { select: { name: true } } },
  });

  return assignment?.role.name ?? "unknown";
}
