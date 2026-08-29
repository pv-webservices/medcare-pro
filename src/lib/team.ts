import { z } from "zod";
import type { MembershipStatus } from "@prisma/client";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { canTransitionMembershipStatus } from "@/lib/accessStatus";
import { revokeAllSessionsForUser } from "@/lib/appSession";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { listInvitations, type InvitationSummary } from "@/lib/invitations";
import { WILDCARD } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  can,
  requirePermission,
  ScopeError,
  toPermissionList,
  type ActorContext,
} from "@/lib/rbac";
import { listGrantableRoles, type GrantableRole } from "@/lib/roles";

/**
 * Team management — Stage 6, the tenant side of who may use this account.
 *
 * THE ONE COLUMN THIS MODULE OWNS is `users.membership_status`. Its counterpart
 * `account_status` belongs to the Platform Owner and is never written here —
 * see lib/accessStatus.ts for why the two exist separately, and
 * lib/platform/memberActivation.ts for the single narrow exception, which runs
 * only when an invitation is accepted and only from PENDING.
 *
 * ROLES ARE NOT ASSIGNED HERE, deliberately. `user_roles` has exactly two
 * writers: lib/roles.ts, behind `role:manage` and its three escalation guards,
 * and the invitation acceptance in lib/invitations.ts, which applies the same
 * rule-1 check at issue time through `assertRoleGrantableBy`. A third writer on
 * this screen under a different permission would be the weaker door. The team
 * screen shows each member's roles and links across to change them.
 *
 * WHAT SUSPENDING SOMEONE ACTUALLY DOES. `requireActor()` re-reads the status
 * columns on every request, so access ends on the next navigation with no
 * further action. Sessions are revoked as well, in the same transaction — a
 * 30-day "remember me" row that outlives a suspension is a row somebody has to
 * remember to clean up later, and nobody ever does.
 */

const VIEW = "team:view";
const INVITE = "team:invite";
const APPROVE = "team:approve";
const MANAGE = "team:manage";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TeamMemberRole {
  roleName: string;
  /** null = account-wide. */
  clinicName: string | null;
}

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  membershipStatus: MembershipStatus;
  roles: TeamMemberRole[];
  lastLoginAt: string | null;
  /** True for the signed-in user, who cannot act on their own access. */
  isSelf: boolean;
  /**
   * The platform axis is not ACTIVE, so this person cannot sign in no matter
   * what the tenant sets. Surfaced as a flag rather than as the status itself:
   * an admin needs to know why an ACTIVE member is locked out, not which of the
   * Owner's states applies.
   */
  isBlockedByPlatform: boolean;
  /** Holds `*` account-wide — the account's root, protected from lockout. */
  isAccountOwner: boolean;
}

export interface TeamOverview {
  members: TeamMember[];
  invitations: InvitationSummary[];
  /** Only roles this actor could actually hand out, for the invite form. */
  roles: GrantableRole[];
  clinics: { id: string; name: string }[];
  canInvite: boolean;
  canApprove: boolean;
  canManage: boolean;
  canAssignAccountWide: boolean;
}

/** Everything the team screen renders, in one round trip. */
export async function getTeamOverview(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<TeamOverview> {
  await requirePermission(actor, VIEW);

  const [users, invitations, roles, clinics, canInvite, canApprove, canManage, canAssignAccountWide] =
    await Promise.all([
      prisma.user.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ name: "asc" }, { email: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          membershipStatus: true,
          accountStatus: true,
          lastLoginAt: true,
          userRoles: {
            select: {
              clinicId: true,
              role: { select: { name: true, permissions: true } },
              clinic: { select: { name: true } },
            },
          },
        },
      }),
      listInvitations(actor, now),
      listGrantableRoles(actor),
      prisma.clinic.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      can(actor, INVITE),
      can(actor, APPROVE),
      can(actor, MANAGE),
      can(actor, WILDCARD),
    ]);

  return {
    members: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      membershipStatus: user.membershipStatus,
      roles: user.userRoles.map((assignment) => ({
        roleName: assignment.role.name,
        clinicName: assignment.clinic?.name ?? null,
      })),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      isSelf: user.id === actor.userId,
      isBlockedByPlatform: user.accountStatus !== "ACTIVE",
      isAccountOwner: user.userRoles.some(
        (assignment) =>
          assignment.clinicId === null &&
          toPermissionList(assignment.role.permissions).includes(WILDCARD),
      ),
    })),
    invitations,
    roles,
    clinics,
    canInvite,
    canApprove,
    canManage,
    canAssignAccountWide,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const teamMutationSchema = z.object({
  action: z.enum(["approve", "reject", "suspend", "reactivate", "remove"]),
  userId: z.string().trim().min(1).max(64),
  /** Recorded on the audit row. Never shown to the person it is about. */
  reason: z.string().trim().max(1000).optional(),
});

export type TeamMutationInput = z.infer<typeof teamMutationSchema>;
type TeamAction = TeamMutationInput["action"];

interface ActionRule {
  permission: string;
  target: MembershipStatus;
  auditAction: string;
  /** Access is being taken away, so sessions die and lockout is possible. */
  endsAccess: boolean;
}

/**
 * One table, so the permission, the resulting status and the audit action for
 * an action can never be set in three places and disagree.
 *
 * `team:approve` covers the two decisions on somebody waiting; `team:manage`
 * covers the lifecycle of somebody already admitted. That split is what the
 * permission catalogue promises, so it is honoured exactly.
 */
const ACTION_RULES: Record<TeamAction, ActionRule> = {
  approve: {
    permission: APPROVE,
    target: "ACTIVE",
    auditAction: AUDIT_ACTIONS.TEAM_MEMBER_APPROVED,
    endsAccess: false,
  },
  reject: {
    permission: APPROVE,
    target: "REJECTED",
    auditAction: AUDIT_ACTIONS.TEAM_MEMBER_REJECTED,
    endsAccess: true,
  },
  suspend: {
    permission: MANAGE,
    target: "SUSPENDED",
    auditAction: AUDIT_ACTIONS.TEAM_MEMBER_SUSPENDED,
    endsAccess: true,
  },
  reactivate: {
    permission: MANAGE,
    target: "ACTIVE",
    auditAction: AUDIT_ACTIONS.TEAM_MEMBER_REACTIVATED,
    endsAccess: false,
  },
  remove: {
    permission: MANAGE,
    target: "REMOVED",
    auditAction: AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
    endsAccess: true,
  },
};

/**
 * The account must keep at least one person who can still sign in AND holds
 * account-wide `*`.
 *
 * lib/roles.ts guards the same invariant from the other direction: it stops the
 * last owner ASSIGNMENT being deleted. Neither check subsumes the other — an
 * account with one owner who has been suspended is just as locked out as one
 * with no owner at all, and only this check sees status.
 */
async function assertAnotherOwnerRemains(
  tenantId: string,
  excludingUserId: string,
): Promise<void> {
  // Account-wide assignments held by somebody who can still sign in. Both
  // status columns are required, because either one being off is enough to
  // make that person unable to unlock the account.
  const owners = await prisma.userRole.findMany({
    where: {
      clinicId: null,
      role: { tenantId },
      user: {
        tenantId,
        id: { not: excludingUserId },
        membershipStatus: "ACTIVE",
        accountStatus: "ACTIVE",
      },
    },
    select: { role: { select: { permissions: true } } },
  });

  const hasOwner = owners.some((assignment) =>
    toPermissionList(assignment.role.permissions).includes(WILDCARD),
  );

  if (!hasOwner) {
    throw new ConflictError(
      "That would leave the account with no active owner. Give someone else " +
        "owner access first.",
    );
  }
}

export interface TeamMutationResult {
  userId: string;
  membershipStatus: MembershipStatus;
  /** How many live sessions were ended by the change. */
  sessionsRevoked: number;
}

/**
 * Moves one member through the tenant-side lifecycle.
 *
 * Everything commits in one transaction: the status, the session revocations
 * and the audit row. A suspension recorded without its audit entry is a change
 * nobody can account for, which is the failure that table exists to prevent.
 */
export async function updateTeamMembership(
  actor: ActorContext,
  input: TeamMutationInput,
  options: { now?: Date; ip?: string | null; userAgent?: string | null } = {},
): Promise<TeamMutationResult> {
  const now = options.now ?? new Date();
  const rule = ACTION_RULES[input.action];

  // Account-wide, with no clinic id: membership reaches every clinic the person
  // works in, so a clinic-scoped grant of team:manage must not confer it.
  await requirePermission(actor, rule.permission);

  // SELF-ACTION IS REFUSED OUTRIGHT. Not because suspending yourself is an
  // escalation — it is the opposite — but because it is the one mistake with no
  // way back through the interface.
  if (input.userId === actor.userId) {
    throw new BadRequestError("You cannot change your own access.");
  }

  const target = await prisma.user.findFirst({
    where: { id: input.userId, tenantId: actor.tenantId },
    select: {
      id: true,
      email: true,
      membershipStatus: true,
      platformRole: true,
      userRoles: {
        select: { clinicId: true, role: { select: { permissions: true } } },
      },
    },
  });

  if (!target) {
    // 404, not 403 — another account's user id must not be confirmable.
    throw new ScopeError();
  }

  // A platform user is not a member of a customer organisation and is not
  // administrable from one. Defence in depth: Owners live in the reserved
  // platform tenant, so the tenant filter above should already have excluded
  // them.
  if (target.platformRole !== null) {
    throw new ScopeError();
  }

  if (!canTransitionMembershipStatus(target.membershipStatus, rule.target)) {
    throw new ConflictError(
      `That person is ${target.membershipStatus.toLowerCase()} — this change does not apply to them.`,
    );
  }

  const isAccountOwner = target.userRoles.some(
    (assignment) =>
      assignment.clinicId === null &&
      toPermissionList(assignment.role.permissions).includes(WILDCARD),
  );

  if (rule.endsAccess && isAccountOwner) {
    await assertAnotherOwnerRemains(actor.tenantId, target.id);
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        membershipStatus: rule.target,
        // `removedAt` is the only denormalised pointer this lifecycle owns; the
        // suspension pointers belong to the Owner's column and stay untouched.
        ...(rule.target === "REMOVED" ? { removedAt: now } : {}),
      },
    });

    const sessionsRevoked = rule.endsAccess
      ? await revokeAllSessionsForUser(tx, {
          userId: target.id,
          revokedById: actor.userId,
          reason: `team:${input.action}`,
          now,
        })
      : 0;

    await writeAuditLog(tx, {
      action: rule.auditAction,
      targetType: "User",
      targetId: target.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { membershipStatus: target.membershipStatus },
      afterValue: { membershipStatus: rule.target, sessionsRevoked },
      reason: input.reason ?? null,
      ip: options.ip ?? null,
      userAgent: options.userAgent ?? null,
    });

    return {
      userId: target.id,
      membershipStatus: rule.target,
      sessionsRevoked,
    };
  });
}
