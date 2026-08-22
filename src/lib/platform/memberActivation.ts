import type { Prisma, PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Activating an invited member's LOGIN — Stage 6, and the one narrow exception
 * to "only the Owner writes accountStatus".
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `users.account_status` is the Platform Owner's column. Its schema note says
 * so, and lib/accessStatus.ts explains why: the Owner's suspension and the
 * Tenant Admin's suspension are separate so that neither party can undo the
 * other's decision. Access needs BOTH to be ACTIVE.
 *
 * A newly invited user is created PENDING on both axes. The tenant side can set
 * membershipStatus, but nothing tenant-side may set accountStatus — so without
 * this function every invited receptionist would accept their invitation, land
 * on a valid account, and be refused at the door forever, waiting on a Platform
 * Owner who has no business adjudicating one clinic's hiring.
 *
 * The resolution is to treat approving an ORGANISATION as delegating its
 * staffing. The Owner already decided this tenant may operate; who works there
 * is the tenant's decision within that grant. This function is where that
 * delegation is written down, so it is one auditable rule in platform code
 * rather than a scattering of `accountStatus: "ACTIVE"` in tenant modules.
 *
 * WHAT IT CANNOT DO — the guards are the whole point
 * --------------------------------------------------
 *   - PENDING is the ONLY status it will move. A SUSPENDED or ARCHIVED user is
 *     refused, so accepting an invitation can never lift an Owner's suspension.
 *     That is the escalation the two-column split exists to prevent, and it
 *     survives this file intact.
 *   - The tenant must be ACTIVE. A pending, rejected or suspended organisation
 *     cannot activate logins by mailing itself invitations.
 *   - It takes an invitation id and records it. Every activation therefore
 *     points at the specific invitation that justified it.
 *   - It never grants a role, never touches membershipStatus, and never runs
 *     for a user who already exists outside an acceptance.
 *
 * It takes a transaction client because the activation, the role grant and the
 * invitation's own state change must commit together or not at all.
 */

export interface ActivateInvitedMemberInput {
  userId: string;
  tenantId: string;
  /** The invitation being spent. Recorded so the activation is accountable. */
  invitationId: string;
  /** The inviter, as the actor on the audit row. Null if they have since gone. */
  invitedById?: string | null;
  now?: Date;
}

/** Thrown when the activation rules refuse. Callers map this to a refusal. */
export class MemberActivationError extends Error {
  readonly reason: "not-pending" | "tenant-inactive" | "not-found";

  constructor(reason: "not-pending" | "tenant-inactive" | "not-found") {
    super(`Cannot activate invited member: ${reason}`);
    this.name = "MemberActivationError";
    this.reason = reason;
  }
}

/**
 * Moves one invited user from PENDING to ACTIVE on the platform axis.
 *
 * Returns nothing on success and throws on every refusal, so a caller cannot
 * accidentally treat a refused activation as a completed one.
 */
export async function activateInvitedMemberAccount(
  tx: PrismaClientOrTransaction,
  input: ActivateInvitedMemberInput,
): Promise<void> {
  const now = input.now ?? new Date();

  const user = await tx.user.findFirst({
    where: { id: input.userId, tenantId: input.tenantId },
    select: {
      id: true,
      accountStatus: true,
      tenant: { select: { status: true, isPlatform: true } },
    },
  });

  if (!user) {
    throw new MemberActivationError("not-found");
  }

  // The platform tenant has no invitation flow: Owners are provisioned by the
  // guarded create-owner command, never by someone mailing a link.
  if (user.tenant.isPlatform || user.tenant.status !== "ACTIVE") {
    throw new MemberActivationError("tenant-inactive");
  }

  // THE GUARD. Anything other than PENDING is a decision somebody made, and an
  // invitation acceptance is not allowed to overwrite it.
  if (user.accountStatus !== "PENDING") {
    throw new MemberActivationError("not-pending");
  }

  await tx.user.update({
    where: { id: user.id },
    data: {
      accountStatus: "ACTIVE",
      // `approvedById` is a denormalised display pointer; the inviter is the
      // nearest thing to an approver here, and the audit row below is the
      // authoritative record either way.
      approvedById: input.invitedById ?? null,
      approvedAt: now,
    },
  });

  await writeAuditLog(tx, {
    action: AUDIT_ACTIONS.MEMBER_ACCOUNT_ACTIVATED,
    targetType: "User",
    targetId: user.id,
    actorUserId: input.invitedById ?? null,
    actorTenantId: input.tenantId,
    beforeValue: { accountStatus: "PENDING" },
    afterValue: { accountStatus: "ACTIVE", invitationId: input.invitationId },
    reason: "Invitation accepted under a delegated tenant grant.",
  });
}
