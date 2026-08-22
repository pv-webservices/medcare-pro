import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { ScopeError } from "@/lib/rbac";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import {
  CLINIC_DECISIONS,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  evaluateDecision,
  resolveEntitlementChanges,
  type ClinicDecision,
  type EntitlementRequest,
} from "@/lib/platform/decisionPolicy";
import type { PlatformActorContext } from "@/lib/platform/context";
import type { TenantStatus } from "@prisma/client";

/**
 * Owner decisions on a clinic application — Stage 3 items 6 to 11.
 *
 * The only module in the codebase that writes `tenants.status`. Everything it
 * does for one decision happens in ONE transaction: the status change, the plan,
 * the feature overrides, the first user's role, and the audit rows. A decision
 * that committed without its audit row would be a decision nobody can account
 * for afterwards, which is the failure this table exists to prevent.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT WRITE:
 *
 *   `users.membershipStatus` on a rejection or suspension. That column belongs
 *   to the Tenant Admin (see the schema note on User.accountStatus). Access is
 *   already gone the moment `tenants.status` leaves ACTIVE, because
 *   evaluateAccessStatus requires all three to be ACTIVE and requireActor()
 *   re-reads them on every request. Clearing it here would let a platform
 *   action silently undo a tenant-side decision, which is exactly the
 *   escalation the two-column split exists to prevent.
 *
 *   `users.accountStatus` on a rejection. The person did nothing; their
 *   organisation was not approved. Archiving them would be a second, separate
 *   decision with its own audit trail.
 */

export interface ClinicDecisionInput {
  tenantId: string;
  decision: unknown;
  reason?: string | null;
  /** APPROVE only — Stage 3 item 8. */
  planKey?: string | null;
  /** APPROVE only — Stage 3 item 9. Unmentioned features are left untouched. */
  features?: readonly EntitlementRequest[];
  /** Required by Stage 1's schema whenever an override row is written. */
  entitlementReason?: string | null;
  /** Recorded on the audit row. Never an authorization input. */
  ip?: string | null;
  userAgent?: string | null;
}

export interface ClinicDecisionOutcome {
  tenantId: string;
  clinicName: string;
  email: string;
  decision: ClinicDecision;
  status: TenantStatus;
  reason: string | null;
  /** True when this decision gave the first user their account-wide role. */
  roleAssigned: boolean;
  overridesSet: number;
  overridesCleared: number;
  /**
   * False when the decision committed but the applicant could not be told.
   * The decision still stands — see the note at the send site.
   */
  applicantNotified: boolean;
}

const DECISION_AUDIT_ACTION: Record<ClinicDecision, string> = {
  APPROVE: AUDIT_ACTIONS.CLINIC_APPROVED,
  REJECT: AUDIT_ACTIONS.CLINIC_REJECTED,
  SUSPEND: AUDIT_ACTIONS.CLINIC_SUSPENDED,
  REACTIVATE: AUDIT_ACTIONS.CLINIC_REACTIVATED,
};

/** Turns a policy verdict into a message the Owner can act on. */
function policyError(reason: string): never {
  switch (reason) {
    case "unknown-decision":
      throw new BadRequestError("Unknown decision.");
    case "reason-required":
      throw new BadRequestError("A written reason is required for this decision.");
    case "reason-too-short":
      throw new BadRequestError(
        `Give a reason of at least ${MIN_REASON_LENGTH} characters.`,
      );
    case "reason-too-long":
      throw new BadRequestError(
        `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
      );
    case "wrong-starting-status":
    case "illegal-transition":
      throw new ConflictError(
        "This clinic is no longer in a state where that decision applies. Reload and check its current status.",
      );
    default:
      throw new BadRequestError("That decision could not be applied.");
  }
}

/**
 * Applies one decision.
 *
 * The Owner context is a required argument, and only requirePlatformOwner() can
 * produce one — so there is no path into this function that has not authorized.
 * It carries no `tenantId`, which is why the tenant being acted on is passed
 * explicitly rather than inferred from the actor.
 */
export async function decideOnClinicApplication(
  owner: PlatformActorContext,
  input: ClinicDecisionInput,
): Promise<ClinicDecisionOutcome> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, ...CUSTOMER_TENANT_WHERE },
    select: {
      id: true,
      businessName: true,
      email: true,
      status: true,
      planId: true,
      featureOverrides: {
        select: { enabled: true, feature: { select: { key: true } } },
      },
    },
  });

  // Covers "no such tenant" and "that id is the reserved platform row" with one
  // indistinguishable answer, so neither can be probed for.
  if (!tenant) {
    throw new ScopeError();
  }

  const verdict = evaluateDecision({
    decision: input.decision,
    currentStatus: tenant.status,
    reason: input.reason,
  });

  if (!verdict.allowed || verdict.targetStatus === null) {
    policyError(verdict.reason ?? "unknown");
  }

  const decision = input.decision as ClinicDecision;
  const targetStatus = verdict.targetStatus;
  const reason = verdict.normalisedReason;
  const isApproval = decision === CLINIC_DECISIONS.APPROVE;

  // --- Plan and entitlements, resolved before the transaction opens --------
  let planId: string | null = null;
  let entitlements = {
    overridesToSet: [] as readonly EntitlementRequest[],
    overridesToClear: [] as readonly string[],
    requiresReason: false,
  };

  if (isApproval) {
    const planKey = input.planKey?.trim();
    if (!planKey) {
      throw new BadRequestError("Choose a plan before approving.");
    }

    const plan = await prisma.plan.findUnique({
      where: { key: planKey },
      select: {
        id: true,
        isActive: true,
        features: { select: { enabled: true, feature: { select: { key: true } } } },
      },
    });

    if (!plan) {
      throw new BadRequestError("That plan does not exist.");
    }
    if (!plan.isActive) {
      throw new BadRequestError("That plan has been retired. Choose another.");
    }
    planId = plan.id;

    const catalogue = await prisma.feature.findMany({ select: { key: true } });

    const resolved = resolveEntitlementChanges({
      requested: input.features ?? [],
      planDefaults: new Map(
        plan.features.map((row) => [row.feature.key, row.enabled]),
      ),
      catalogue: new Set(catalogue.map((row) => row.key)),
      existingOverrides: new Map(
        tenant.featureOverrides.map((row) => [row.feature.key, row.enabled]),
      ),
    });

    if (resolved.unknownFeatureKeys.length > 0) {
      throw new BadRequestError("The submitted feature list is not valid.");
    }

    const entitlementReason = input.entitlementReason?.trim() ?? "";
    if (resolved.requiresReason && entitlementReason.length < MIN_REASON_LENGTH) {
      throw new BadRequestError(
        `Overriding a plan's features requires a reason of at least ${MIN_REASON_LENGTH} characters.`,
      );
    }
    if (entitlementReason.length > MAX_REASON_LENGTH) {
      throw new BadRequestError(
        `Keep the entitlement reason under ${MAX_REASON_LENGTH} characters.`,
      );
    }

    entitlements = resolved;
  }

  const now = new Date();
  const auditBase = {
    actorUserId: owner.userId,
    actorPlatformRole: owner.platformRole,
    // Null, not the platform tenant's id: this is a platform-wide action taken
    // on a customer, not an action taken inside an organisation.
    actorTenantId: null,
    targetType: "Tenant",
    targetId: tenant.id,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  } as const;

  const result = await prisma.$transaction(async (tx) => {
    const statusFields: Prisma.TenantUpdateInput = { status: targetStatus };

    if (isApproval) {
      statusFields.approvedBy = { connect: { id: owner.userId } };
      statusFields.approvedAt = now;
      statusFields.plan = planId ? { connect: { id: planId } } : undefined;
    }
    if (decision === CLINIC_DECISIONS.REJECT) {
      statusFields.rejectedBy = { connect: { id: owner.userId } };
      statusFields.rejectedAt = now;
      statusFields.rejectionReason = reason;
    }
    if (decision === CLINIC_DECISIONS.SUSPEND) {
      statusFields.suspendedBy = { connect: { id: owner.userId } };
      statusFields.suspendedAt = now;
      statusFields.suspensionReason = reason;
    }
    if (decision === CLINIC_DECISIONS.REACTIVATE) {
      // The denormalised pointers mean "currently suspended by", so they are
      // cleared. The suspension itself is not erased — it is in audit_logs,
      // which nothing in this codebase updates or deletes.
      statusFields.suspendedBy = { disconnect: true };
      statusFields.suspendedAt = null;
      statusFields.suspensionReason = null;
    }

    await tx.tenant.update({ where: { id: tenant.id }, data: statusFields });

    let roleAssigned = false;

    if (isApproval) {
      // --- Stage 3 item 10: the first user gets their account-wide role -----
      //
      // The applicant is the login sharing the organisation's address; signup
      // creates exactly one. `seedDefaultRoles` is create-or-update per role and
      // was already run at signup, so this call only covers a tenant whose seed
      // predates a change to the catalogue.
      await seedDefaultRoles(tx, tenant.id);

      const applicant = await tx.user.findFirst({
        where: { tenantId: tenant.id, email: tenant.email },
        select: { id: true, accountStatus: true },
      });

      if (applicant) {
        await tx.user.update({
          where: { id: applicant.id },
          data: {
            // Owner-controlled column, written by Owner code. Its counterpart
            // membershipStatus is set here too, and ONLY here: at approval the
            // organisation has no Tenant Admin yet to set it, so leaving it
            // PENDING would lock the first user out of the account they just
            // had approved. Every later membership change is the Tenant
            // Admin's, and this module never touches the column again.
            accountStatus: "ACTIVE",
            membershipStatus: "ACTIVE",
            approvedBy: { connect: { id: owner.userId } },
            approvedAt: now,
          },
        });

        const rootRole = await tx.role.findFirst({
          where: { tenantId: tenant.id, key: ROLE_KEYS.OWNER },
          select: { id: true, name: true },
        });

        if (!rootRole) {
          // seedDefaultRoles ran three lines up, so this cannot happen without
          // the catalogue having been edited underneath us. Fail the whole
          // transaction rather than approve a clinic nobody can administer.
          throw new Error(
            `Tenant ${tenant.id} has no root role after seeding — cannot complete approval.`,
          );
        }

        const existing = await tx.userRole.findFirst({
          where: { userId: applicant.id, roleId: rootRole.id, clinicId: null },
          select: { id: true },
        });

        if (!existing) {
          await tx.userRole.create({
            data: {
              userId: applicant.id,
              roleId: rootRole.id,
              // Null = account-wide. The first user is not scoped to a clinic.
              clinicId: null,
              assignedById: owner.userId,
            },
          });
          roleAssigned = true;

          await writeAuditLog(tx, {
            ...auditBase,
            action: AUDIT_ACTIONS.CLINIC_ADMIN_ASSIGNED,
            targetType: "User",
            targetId: applicant.id,
            afterValue: { roleName: rootRole.name, scope: "account-wide" },
          });
        }
      }

      // --- Stage 3 item 9: feature entitlements ---------------------------
      for (const entry of entitlements.overridesToSet) {
        const feature = await tx.feature.findUnique({
          where: { key: entry.featureKey },
          select: { id: true },
        });
        if (!feature) {
          throw new BadRequestError("The submitted feature list is not valid.");
        }

        await tx.tenantFeatureOverride.upsert({
          where: {
            tenantId_featureId: { tenantId: tenant.id, featureId: feature.id },
          },
          create: {
            tenantId: tenant.id,
            featureId: feature.id,
            enabled: entry.enabled,
            reason: input.entitlementReason?.trim() ?? "",
            changedById: owner.userId,
            changedAt: now,
          },
          update: {
            enabled: entry.enabled,
            reason: input.entitlementReason?.trim() ?? "",
            changedById: owner.userId,
            changedAt: now,
          },
        });
      }

      if (entitlements.overridesToClear.length > 0) {
        await tx.tenantFeatureOverride.deleteMany({
          where: {
            tenantId: tenant.id,
            feature: { key: { in: [...entitlements.overridesToClear] } },
          },
        });
      }

      if (
        entitlements.overridesToSet.length > 0 ||
        entitlements.overridesToClear.length > 0 ||
        tenant.planId !== planId
      ) {
        await writeAuditLog(tx, {
          ...auditBase,
          action: AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET,
          reason: input.entitlementReason?.trim() || null,
          beforeValue: { planId: tenant.planId },
          afterValue: {
            planId,
            enabledFeatures: entitlements.overridesToSet
              .filter((entry) => entry.enabled)
              .map((entry) => entry.featureKey),
            disabledFeatures: entitlements.overridesToSet
              .filter((entry) => !entry.enabled)
              .map((entry) => entry.featureKey),
            clearedOverrides: [...entitlements.overridesToClear],
          },
        });
      }
    }

    await writeAuditLog(tx, {
      ...auditBase,
      action: DECISION_AUDIT_ACTION[decision],
      reason,
      beforeValue: { status: tenant.status },
      afterValue: { status: targetStatus },
    });

    return { roleAssigned };
  });

  return {
    tenantId: tenant.id,
    clinicName: tenant.businessName,
    email: tenant.email,
    decision,
    status: targetStatus,
    reason,
    roleAssigned: result.roleAssigned,
    overridesSet: entitlements.overridesToSet.length,
    overridesCleared: entitlements.overridesToClear.length,
    // Filled in by the caller, which owns the mail. Kept out of the transaction
    // on purpose: an SMTP timeout must not roll back an approval.
    applicantNotified: false,
  };
}
