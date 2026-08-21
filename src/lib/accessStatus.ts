import type {
  MembershipStatus,
  TenantStatus,
  UserAccountStatus,
} from "@prisma/client";

/**
 * Status transition rules and the combined access predicate — Stage 1.
 *
 * Three independent lifecycles gate every request:
 *
 *   Tenant.status          the customer organisation   — Owner-controlled
 *   User.accountStatus     the individual login        — Owner-controlled
 *   User.membershipStatus  access within the tenant    — Tenant-Admin-controlled
 *
 * WHY accountStatus AND membershipStatus ARE SEPARATE
 * ---------------------------------------------------
 * `users.tenant_id` is non-null, so one User belongs to exactly one Tenant and a
 * single status column would appear to be enough. It is not, and merging them
 * would be a privilege-escalation hole: whoever writes the column can undo the
 * other party's decision. With one column, a Tenant Admin reactivating a team
 * member would silently clear a suspension the Platform Owner imposed.
 *
 * So: the Owner writes `accountStatus` (only from src/lib/platform/*), the
 * Tenant Admin writes `membershipStatus` (only from tenant-scoped code), and
 * `isAccessAllowed` requires BOTH. Neither side can reach the other's column,
 * and neither can rescue a user the other has suspended.
 *
 * Type-only imports: this module is pure and has no Prisma client at runtime, so
 * unit tests need no database.
 *
 * CURRENT-SCHEMA LIMITATION: one user, one tenant. Supporting a person who works
 * for several organisations would move `membershipStatus` onto a Membership row.
 * The two-status separation above would survive that change unaltered.
 */

/**
 * Legal moves for the Owner-controlled account lifecycle.
 * ARCHIVED is terminal — the schema has no delete path, so archiving is how an
 * account ends, and reviving one is a deliberate manual act, not a transition.
 */
export const ACCOUNT_STATUS_TRANSITIONS: Record<
  UserAccountStatus,
  readonly UserAccountStatus[]
> = {
  PENDING: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

/**
 * Legal moves for the Tenant-Admin-controlled membership lifecycle.
 * REJECTED is what an unapproved invitee becomes; REMOVED is terminal.
 */
export const MEMBERSHIP_STATUS_TRANSITIONS: Record<
  MembershipStatus,
  readonly MembershipStatus[]
> = {
  PENDING: ["ACTIVE", "REJECTED", "REMOVED"],
  ACTIVE: ["SUSPENDED", "REMOVED"],
  SUSPENDED: ["ACTIVE", "REMOVED"],
  REJECTED: ["REMOVED"],
  REMOVED: [],
};

/**
 * Legal moves for the Owner-controlled organisation lifecycle.
 *
 * REJECTED does not lead back to ACTIVE: re-admitting a rejected applicant is a
 * fresh decision with its own audit trail, not a status flip. ARCHIVED is
 * terminal for the same reason as above.
 */
export const TENANT_STATUS_TRANSITIONS: Record<
  TenantStatus,
  readonly TenantStatus[]
> = {
  PENDING: ["ACTIVE", "REJECTED", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  ARCHIVED: [],
};

/**
 * A no-op transition (X to X) is rejected rather than allowed.
 *
 * Re-suspending an already-suspended user is not an access change but it IS an
 * audit event with a new reason, and letting it through this predicate would
 * write a log entry whose before and after values are identical. Callers that
 * genuinely want an idempotent write should check for the no-op themselves.
 */
export function canTransitionAccountStatus(
  from: UserAccountStatus,
  to: UserAccountStatus,
): boolean {
  return ACCOUNT_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  return MEMBERSHIP_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionTenantStatus(
  from: TenantStatus,
  to: TenantStatus,
): boolean {
  return TENANT_STATUS_TRANSITIONS[from].includes(to);
}

export interface AccessStatusInput {
  tenantStatus: TenantStatus;
  accountStatus: UserAccountStatus;
  membershipStatus: MembershipStatus;
}

/** Which gate refused, for logging. Never shown to the caller — see below. */
export type AccessDenialReason = "tenant" | "account" | "membership" | null;

/**
 * The status half of the Stage 2 authorisation rule:
 *
 *   authenticated session
 *   AND a live, unrevoked AppSession        <- Stage 2, not here
 *   AND tenant ACTIVE                       <- here
 *   AND account ACTIVE                      <- here
 *   AND membership ACTIVE                   <- here
 *   AND the clinic feature entitlement      <- src/lib/featureResolution.ts
 *   AND the role's action permission        <- src/lib/rbac.ts, unchanged
 *
 * The order below is deliberate: the broadest gate is reported first, so a
 * suspended organisation reads as "tenant" rather than as a per-user problem.
 *
 * `reason` is for the server log and the audit trail ONLY. Telling a caller
 * which gate refused them distinguishes "your clinic is suspended" from "you
 * personally are suspended", which is information they have not earned.
 */
export function evaluateAccessStatus(input: AccessStatusInput): {
  allowed: boolean;
  reason: AccessDenialReason;
} {
  if (input.tenantStatus !== "ACTIVE") {
    return { allowed: false, reason: "tenant" };
  }
  if (input.accountStatus !== "ACTIVE") {
    return { allowed: false, reason: "account" };
  }
  if (input.membershipStatus !== "ACTIVE") {
    return { allowed: false, reason: "membership" };
  }
  return { allowed: true, reason: null };
}

export function isAccessAllowed(input: AccessStatusInput): boolean {
  return evaluateAccessStatus(input).allowed;
}
