import { prisma } from "@/lib/prisma";
import { WILDCARD } from "@/lib/permissions";

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

export function toPermissionList(value: unknown): readonly string[] {
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
 * Which clinics the actor may exercise `permission` in.
 *
 * FR-2.3 — every module is scoped by clinic, and a user's reach depends on how
 * their roles are assigned:
 *   - a tenant-wide assignment (clinic_id null) reaches every clinic → "all"
 *   - clinic-scoped assignments reach only those clinics → "clinics"
 *   - no assignment granting the permission → "none"
 *
 * Callers turn this into a Prisma `where` clause. Returning the shape rather
 * than a list of ids for the tenant-wide case keeps a growing tenant from
 * paying for an id list on every request.
 */
export type ClinicScope =
  | { scope: "all" }
  | { scope: "clinics"; clinicIds: readonly string[] }
  | { scope: "none" };

/**
 * Resolves several permission scopes with one assignment query.
 *
 * Dashboards need to decide which widgets may run before they issue any data
 * queries. Calling `accessibleClinicScope` once per widget would re-read the
 * same role assignments for every card, so this batched form keeps the RBAC
 * rule in one place without turning a dashboard render into an N+1 permission
 * check. Every requested key is present in the returned map; an unknown or
 * ungranted key resolves to `none`.
 */
export async function accessibleClinicScopes(
  actor: ActorContext,
  permissions: readonly string[],
): Promise<ReadonlyMap<string, ClinicScope>> {
  const requested = [...new Set(permissions)];
  const assignments = await prisma.userRole.findMany({
    where: { userId: actor.userId, role: { tenantId: actor.tenantId } },
    select: { clinicId: true, role: { select: { permissions: true } } },
  });

  return new Map<string, ClinicScope>(
    requested.map((permission) => {
      const granting = assignments.filter((assignment) => {
        const granted = toPermissionList(assignment.role.permissions);
        return granted.includes(WILDCARD) || granted.includes(permission);
      });

      if (granting.length === 0) {
        return [permission, { scope: "none" } satisfies ClinicScope] as const;
      }

      if (granting.some((assignment) => assignment.clinicId === null)) {
        return [permission, { scope: "all" } satisfies ClinicScope] as const;
      }

      const clinicIds = [
        ...new Set(
          granting
            .map((assignment) => assignment.clinicId)
            .filter((id): id is string => id !== null),
        ),
      ];

      return [
        permission,
        { scope: "clinics", clinicIds } satisfies ClinicScope,
      ] as const;
    }),
  );
}

export async function accessibleClinicScope(
  actor: ActorContext,
  permission: string,
): Promise<ClinicScope> {
  const scopes = await accessibleClinicScopes(actor, [permission]);
  return scopes.get(permission) ?? { scope: "none" };
}

/**
 * Every permission the actor holds in ANY scope.
 *
 * Deliberately scope-blind, unlike `can`: this answers "could this user do X
 * somewhere?", which is the right question for deciding whether to show them a
 * navigation tab at all. A Staff user whose only role is scoped to Clinic A
 * still needs the Registrations tab.
 *
 * One query for the whole nav, rather than one `can` call per link.
 *
 * Showing or hiding a tab is NOT access control — the page behind it does its
 * own check. This exists so a user is not offered a door that will refuse them.
 */
export interface HeldPermissions {
  /** Holds the wildcard somewhere, so every permission is granted. */
  all: boolean;
  keys: ReadonlySet<string>;
}

export async function permissionsHeldAnywhere(
  actor: ActorContext,
): Promise<HeldPermissions> {
  const assignments = await prisma.userRole.findMany({
    // Guards against a role assignment left over from a different tenant.
    where: { userId: actor.userId, role: { tenantId: actor.tenantId } },
    select: { role: { select: { permissions: true } } },
  });

  const keys = new Set<string>();
  let all = false;

  for (const assignment of assignments) {
    for (const permission of toPermissionList(assignment.role.permissions)) {
      if (permission === WILDCARD) {
        all = true;
        continue;
      }
      keys.add(permission);
    }
  }

  return { all, keys };
}

export function holdsAnywhere(held: HeldPermissions, permission: string): boolean {
  return held.all || held.keys.has(permission);
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
