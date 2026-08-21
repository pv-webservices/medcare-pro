/**
 * Platform Owner context and authorization policy — Stage 2.
 *
 * THE SHAPE IS THE SECURITY BOUNDARY. `PlatformActorContext` carries no
 * `tenantId`, so it is not assignable to `ActorContext` and cannot be handed to
 * any tenant-scoped function in `lib/rbac.ts`, `lib/clinics.ts` and friends.
 * That is deliberate: the Owner has no clinic of their own, and a context that
 * exposed the reserved platform tenant's id would let an Owner's request be
 * silently scoped to it — reading and writing rows under a tenant that is not a
 * customer at all.
 *
 * Correspondingly there is NO `isOwner` branch inside tenant-scoped code
 * (Stage 0 decision 7). Owner reads and writes live in `src/lib/platform/*` and
 * query across tenants explicitly, so that every cross-tenant read is visible
 * at the call site instead of hidden behind a flag.
 *
 * Pure module: no Prisma, no Auth.js. `requirePlatformOwner()` in ./auth.ts
 * supplies the facts; this file only decides.
 */
import type { PlatformRole, UserAccountStatus } from "@prisma/client";

/**
 * The acting Platform Owner. Compare with `ActorContext` in lib/rbac.ts, which
 * has `tenantId` and no `platformRole` — the two are mutually unassignable on
 * purpose.
 */
export interface PlatformActorContext {
  userId: string;
  platformRole: PlatformRole;
  sessionId: string;
}

/** Which gate refused. For server logs only — the client is told nothing. */
export type PlatformDenialReason =
  | "no-session"
  | "not-platform-user"
  | "insufficient-platform-role"
  | "account-inactive"
  | null;

export interface PlatformEvaluationInput {
  /** Has the session registry already accepted this request? */
  sessionValid: boolean;
  /** Null for an ordinary customer user, which is almost everyone. */
  platformRole: PlatformRole | null;
  /** Owner-controlled. A suspended Owner is locked out like anyone else. */
  accountStatus: UserAccountStatus;
  /** Which role the route demands. Owner routes demand SUPER_ADMIN. */
  required: PlatformRole;
}

export interface PlatformEvaluation {
  allowed: boolean;
  reason: PlatformDenialReason;
}

/**
 * Decides whether a request may act as a Platform Owner.
 *
 * WHAT IS DELIBERATELY NOT CHECKED HERE:
 *
 *   - `membershipStatus`. An Owner must not be governed by tenant-level staff
 *     approval (Stage 1 decision 2). If it were checked, a Tenant Admin who
 *     could reach the membership column of the reserved platform tenant would
 *     be able to lock the Owner out of the platform.
 *   - `Tenant.status`. The Owner's tenant is the reserved platform row, which
 *     is not a customer organisation and has no approval lifecycle.
 *
 * `accountStatus` IS checked, because that column is platform-controlled: it is
 * how one Owner suspends another, and it must keep working.
 */
export function evaluatePlatformAccess(
  input: PlatformEvaluationInput,
): PlatformEvaluation {
  if (!input.sessionValid) {
    return { allowed: false, reason: "no-session" };
  }

  if (input.platformRole === null) {
    return { allowed: false, reason: "not-platform-user" };
  }

  // No hierarchy is implied: SUPPORT_ADMIN is not a lesser SUPER_ADMIN, it is a
  // different role. Stage 9 may add read-only support routes that require it
  // explicitly; until then nothing but an exact match passes.
  if (input.platformRole !== input.required) {
    return { allowed: false, reason: "insufficient-platform-role" };
  }

  if (input.accountStatus !== "ACTIVE") {
    return { allowed: false, reason: "account-inactive" };
  }

  return { allowed: true, reason: null };
}

/**
 * Thrown when a request is not an authorized Platform Owner.
 *
 * The message is a fixed constant. It never names which gate refused, because
 * "you are signed in but not an Owner" and "no such route" must look identical
 * to a customer probing for the platform surface. The reason is carried
 * separately for server-side logging and is never serialised to a response.
 */
export class PlatformAuthorizationError extends Error {
  readonly reason: PlatformDenialReason;

  constructor(reason: PlatformDenialReason) {
    super("Not found.");
    this.name = "PlatformAuthorizationError";
    this.reason = reason;
  }
}

/** The role the /owner surface demands. */
export const OWNER_PLATFORM_ROLE = "SUPER_ADMIN" as const satisfies PlatformRole;
