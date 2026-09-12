import { Prisma } from "@prisma/client";
import { z } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import {
  clinicCapacityTransactionOptions,
  lockTenantForClinicCapacity,
  resolveClinicCapacity,
} from "@/lib/clinicCapacity";
import {
  canApprovePaidClinicCapacity,
  canSetClinicCapacityPaymentStatus,
  calculateClinicCapacity,
  capacityStatus,
  isOpenClinicCapacityRequest,
} from "@/lib/clinicCapacityPolicy";
import { notifyClinicCapacityDecision } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { ScopeError } from "@/lib/rbac";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import type { PlatformActorContext } from "@/lib/platform/context";
import { DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";

const reasonSchema = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(2_000);

export const ownerClinicRequestFilterSchema = z.object({
  status: z.enum([
    "PENDING",
    "PAYMENT_PENDING",
    "PAYMENT_SUBMITTED",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "CANCELLED",
    "ALL",
  ]).optional(),
  search: z.string().trim().max(120).optional(),
});

export const ownerPaymentSchema = z.object({
  paymentStatus: z.enum(["CONFIRMED", "WAIVED", "FAILED"]),
  reviewNote: z.string().trim().max(2_000).optional(),
}).strict();

export const ownerApprovalSchema = z.object({
  confirmation: z.string().trim().min(1),
  reviewNote: z.string().trim().max(2_000).optional(),
  acceptFeatureLoss: z.boolean().optional(),
}).strict();

export const ownerRejectionSchema = z.object({ reason: reasonSchema }).strict();

export const manualClinicCapacityGrantSchema = z.object({
  tenantId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().min(1).max(100),
  type: z.enum(["PAID_ADDON", "COMPLIMENTARY", "ENTERPRISE", "MIGRATION"]),
  reason: reasonSchema,
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
}).strict().refine(
  (value) => !value.expiresAt || !value.startsAt || value.expiresAt > value.startsAt,
  { message: "Expiry must be after the start date." },
);

export const revokeClinicCapacityGrantSchema = z.object({ reason: reasonSchema }).strict();

export const planClinicPolicySchema = z.object({
  planKey: z.string().trim().min(1).max(64),
  includedClinics: z.coerce.number().int().min(1).max(10_000),
  additionalClinicPrice: z.union([
    z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Use a valid amount with up to two decimals.").refine((value) => Number(value) > 0, "Additional clinic price must be greater than zero."),
    z.null(),
  ]),
  additionalClinicCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  additionalClinicBillingInterval: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]).nullable(),
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  if (value.additionalClinicPrice !== null && value.additionalClinicBillingInterval === null) {
    context.addIssue({ code: "custom", path: ["additionalClinicBillingInterval"], message: "Choose a billing interval when a price is configured." });
  }
});

async function featureImpact(
  currentPlanId: string | null,
  requestedPlanId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const [current, requested] = await Promise.all([
    currentPlanId
      ? client.planFeature.findMany({
          where: { planId: currentPlanId, enabled: true },
          select: { feature: { select: { key: true, name: true } } },
        })
      : Promise.resolve([]),
    client.planFeature.findMany({
      where: { planId: requestedPlanId, enabled: true },
      select: { feature: { select: { key: true, name: true } } },
    }),
  ]);
  const currentKeys = new Set(current.map((row) => row.feature.key));
  const requestedKeys = new Set(requested.map((row) => row.feature.key));
  return {
    gained: requested.map((row) => row.feature).filter((feature) => !currentKeys.has(feature.key)),
    lost: current.map((row) => row.feature).filter((feature) => !requestedKeys.has(feature.key)),
  };
}

export async function getClinicCapacityInventory(_owner: PlatformActorContext) {
  const now = new Date();
  const [tenants, compatibilityPlan] = await Promise.all([
    prisma.tenant.findMany({
      where: CUSTOMER_TENANT_WHERE,
      orderBy: { businessName: "asc" },
      select: {
        id: true,
        businessName: true,
        email: true,
        status: true,
        plan: { select: { id: true, key: true, name: true, includedClinics: true } },
        _count: { select: { clinics: true } },
        clinicCapacityGrants: {
          select: { id: true, quantity: true, type: true, status: true, startsAt: true, expiresAt: true },
        },
      },
    }),
    prisma.plan.findUnique({
      where: { key: DEFAULT_PLAN_KEY },
      select: { includedClinics: true },
    }),
  ]);

  return tenants.map((tenant) => {
    const includedClinics = tenant.plan?.includedClinics
      ?? (tenant.status === "ACTIVE" ? compatibilityPlan?.includedClinics : undefined)
      ?? 0;
    const calculated = calculateClinicCapacity({
      includedClinics,
      usedClinics: tenant._count.clinics,
      grants: tenant.clinicCapacityGrants,
      now,
    });
    return {
      tenantId: tenant.id,
      tenantName: tenant.businessName,
      tenantEmail: tenant.email,
      tenantStatus: tenant.status,
      planId: tenant.plan?.id ?? null,
      planKey: tenant.plan?.key ?? null,
      planName: tenant.plan?.name ?? null,
      includedClinics,
      usedClinics: tenant._count.clinics,
      usesCompatibilityPlan: tenant.plan === null && tenant.status === "ACTIVE" && compatibilityPlan !== null,
      activeGrants: tenant.clinicCapacityGrants.filter((grant) => grant.status === "ACTIVE" && grant.startsAt <= now && (grant.expiresAt === null || grant.expiresAt > now)),
      ...calculated,
      status: capacityStatus({
        hasPlan: tenant.plan !== null,
        usedClinics: tenant._count.clinics,
        effectiveLimit: calculated.effectiveLimit,
      }),
    };
  });
}

export async function listClinicCapacityRequests(
  _owner: PlatformActorContext,
  filters: z.infer<typeof ownerClinicRequestFilterSchema> = {},
) {
  const where: Prisma.ClinicCapacityRequestWhereInput = {
    ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          tenant: {
            AND: [
              CUSTOMER_TENANT_WHERE,
              {
                OR: [
                  { businessName: { contains: filters.search } },
                  { email: { contains: filters.search } },
                ],
              },
            ],
          },
        }
      : { tenant: CUSTOMER_TENANT_WHERE }),
  };

  const requests = await prisma.clinicCapacityRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      requestType: true,
      requestedQuantity: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      tenant: { select: { id: true, businessName: true, email: true, plan: { select: { name: true } } } },
      requestedPlan: { select: { name: true, includedClinics: true } },
    },
  });

  return Promise.all(
    requests.map(async (request) => ({
      ...request,
      capacity: await resolveClinicCapacity(request.tenant.id),
    })),
  );
}

export async function getClinicCapacityRequest(
  _owner: PlatformActorContext,
  requestId: string,
) {
  const request = await prisma.clinicCapacityRequest.findFirst({
    where: { id: requestId, tenant: CUSTOMER_TENANT_WHERE },
    select: {
      id: true,
      tenantId: true,
      requestType: true,
      requestedQuantity: true,
      status: true,
      unitPriceSnapshot: true,
      currency: true,
      billingInterval: true,
      paymentStatus: true,
      paymentReference: true,
      organizationNote: true,
      reviewNote: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      tenant: { select: { businessName: true, email: true, planId: true, plan: { select: { id: true, name: true, includedClinics: true } } } },
      requestedBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
      requestedPlan: { select: { id: true, key: true, name: true, includedClinics: true, isActive: true } },
      grant: { select: { id: true, quantity: true, type: true, status: true, startsAt: true, expiresAt: true } },
    },
  });
  if (!request) throw new ScopeError();

  return {
    ...request,
    unitPriceSnapshot: request.unitPriceSnapshot?.toFixed(2) ?? null,
    capacity: await resolveClinicCapacity(request.tenantId),
    featureImpact: request.requestedPlan
      ? await featureImpact(request.tenant.planId, request.requestedPlan.id)
      : { gained: [], lost: [] },
  };
}

export async function setClinicCapacityPayment(
  owner: PlatformActorContext,
  requestId: string,
  input: z.infer<typeof ownerPaymentSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.clinicCapacityRequest.findFirst({
      where: { id: requestId, tenant: CUSTOMER_TENANT_WHERE },
      select: { id: true, tenantId: true, requestType: true, status: true, paymentStatus: true },
    });
    if (!before) throw new ScopeError();
    await lockTenantForClinicCapacity(tx, before.tenantId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM clinic_capacity_requests WHERE id = ${requestId} FOR UPDATE`);
    const request = await tx.clinicCapacityRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!isOpenClinicCapacityRequest(request.status)) throw new ConflictError("This request has already been processed.");
    if (request.requestType !== "ADDITIONAL_CLINIC") throw new BadRequestError("Plan upgrade requests do not use this payment action.");
    if (!canSetClinicCapacityPaymentStatus(request.paymentStatus, input.paymentStatus)) {
      throw new ConflictError("Payment status is already final or this change is a no-op.");
    }

    const updated = await tx.clinicCapacityRequest.update({
      where: { id: request.id },
      data: {
        paymentStatus: input.paymentStatus,
        status: input.paymentStatus === "FAILED" ? "PAYMENT_PENDING" : "UNDER_REVIEW",
        reviewNote: input.reviewNote || request.reviewNote,
        reviewedById: owner.userId,
        reviewedAt: new Date(),
      },
      select: { id: true, tenantId: true, paymentStatus: true, status: true },
    });
    await writeAuditLog(tx, {
      action:
        input.paymentStatus === "CONFIRMED"
          ? AUDIT_ACTIONS.CLINIC_CAPACITY_PAYMENT_CONFIRMED
          : input.paymentStatus === "WAIVED"
            ? AUDIT_ACTIONS.CLINIC_CAPACITY_PAYMENT_WAIVED
            : AUDIT_ACTIONS.CLINIC_CAPACITY_PAYMENT_FAILED,
      targetType: "ClinicCapacityRequest",
      targetId: request.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      beforeValue: { paymentStatus: request.paymentStatus, status: request.status },
      afterValue: { paymentStatus: updated.paymentStatus, status: updated.status },
      reason: input.reviewNote || null,
    });
    return updated;
  }, clinicCapacityTransactionOptions);

  if (result.paymentStatus === "FAILED") {
    await notifyClinicCapacityDecision({
      tenantId: result.tenantId,
      type: "clinic.capacity_payment_attention",
      message: "Your clinic capacity request needs payment attention. Open Clinics for its current status.",
      requestId: result.id,
    });
  }
  return result;
}

export async function approveClinicCapacityRequest(
  owner: PlatformActorContext,
  requestId: string,
  input: z.infer<typeof ownerApprovalSchema>,
) {
  if (input.confirmation !== requestId) throw new BadRequestError("Review confirmation does not match this request.");

  const outcome = await prisma.$transaction(async (tx) => {
    const initial = await tx.clinicCapacityRequest.findFirst({
      where: { id: requestId, tenant: CUSTOMER_TENANT_WHERE },
      select: { tenantId: true, requestedPlanId: true },
    });
    if (!initial) throw new ScopeError();
    await lockTenantForClinicCapacity(tx, initial.tenantId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM clinic_capacity_requests WHERE id = ${requestId} FOR UPDATE`);
    if (initial.requestedPlanId) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM plans WHERE id = ${initial.requestedPlanId} FOR UPDATE`);
    }

    const request = await tx.clinicCapacityRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        tenant: { select: { id: true, businessName: true, status: true, planId: true, plan: { select: { id: true, includedClinics: true } } } },
        requestedPlan: { select: { id: true, name: true, includedClinics: true, isActive: true } },
        grant: { select: { id: true, quantity: true } },
      },
    });

    if (request.status === "APPROVED") {
      return { requestId: request.id, tenantId: request.tenantId, requestType: request.requestType, quantity: request.grant?.quantity ?? null, alreadyApproved: true };
    }
    if (!isOpenClinicCapacityRequest(request.status)) throw new ConflictError("This request has already been processed.");
    if (request.tenant.status !== "ACTIVE") throw new ConflictError("The organization must be active before capacity can be approved.");

    let quantity: number | null = null;
    if (request.requestType === "ADDITIONAL_CLINIC") {
      if (!request.requestedQuantity || request.requestedQuantity < 1) throw new BadRequestError("The requested quantity is invalid.");
      if (!canApprovePaidClinicCapacity(request.paymentStatus)) {
        throw new ConflictError("Confirm or waive payment before approving this request.");
      }
      quantity = request.requestedQuantity;
      const grant = await tx.tenantClinicCapacityGrant.create({
        data: {
          tenantId: request.tenantId,
          quantity,
          type: request.paymentStatus === "CONFIRMED" ? "PAID_ADDON" : "COMPLIMENTARY",
          sourceRequestId: request.id,
          approvedById: owner.userId,
          approvedAt: new Date(),
          reason: input.reviewNote || "Approved clinic capacity request.",
          unitPriceSnapshot: request.unitPriceSnapshot,
          currency: request.currency,
          billingInterval: request.billingInterval,
        },
        select: { id: true, quantity: true, type: true },
      });
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CLINIC_CAPACITY_GRANTED,
        targetType: "TenantClinicCapacityGrant",
        targetId: grant.id,
        actorUserId: owner.userId,
        actorPlatformRole: owner.platformRole,
        actorTenantId: null,
        afterValue: { tenantId: request.tenantId, quantity: grant.quantity, type: grant.type, sourceRequestId: request.id },
        reason: input.reviewNote || "Approved clinic capacity request.",
      });
    } else {
      if (!request.requestedPlan || !request.requestedPlan.isActive) throw new ConflictError("The requested plan is no longer active.");
      if (!request.tenant.plan || request.requestedPlan.includedClinics <= request.tenant.plan.includedClinics) {
        throw new ConflictError("The requested plan no longer provides a higher clinic allowance.");
      }
      const impact = await featureImpact(request.tenant.planId, request.requestedPlan.id, tx);
      if (impact.lost.length > 0 && !input.acceptFeatureLoss) {
        throw new ConflictError("This plan would remove features. Review and explicitly accept the feature impact before approval.");
      }
      await tx.tenant.update({ where: { id: request.tenantId }, data: { planId: request.requestedPlan.id } });
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.TENANT_PLAN_UPGRADE_APPROVED,
        targetType: "Tenant",
        targetId: request.tenantId,
        actorUserId: owner.userId,
        actorPlatformRole: owner.platformRole,
        actorTenantId: null,
        beforeValue: { planId: request.tenant.planId, includedClinics: request.tenant.plan.includedClinics },
        afterValue: { planId: request.requestedPlan.id, includedClinics: request.requestedPlan.includedClinics, featuresGained: impact.gained.map((feature) => feature.key), featuresLost: impact.lost.map((feature) => feature.key) },
        reason: input.reviewNote || "Approved clinic capacity plan upgrade.",
      });
    }

    await tx.clinicCapacityRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", reviewedById: owner.userId, reviewedAt: new Date(), reviewNote: input.reviewNote || request.reviewNote },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_REQUEST_APPROVED,
      targetType: "ClinicCapacityRequest",
      targetId: request.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      beforeValue: { status: request.status },
      afterValue: { status: "APPROVED", requestType: request.requestType, quantity },
      reason: input.reviewNote || null,
    });
    return { requestId: request.id, tenantId: request.tenantId, requestType: request.requestType, quantity, alreadyApproved: false };
  }, clinicCapacityTransactionOptions);

  if (!outcome.alreadyApproved) {
    await notifyClinicCapacityDecision({
      tenantId: outcome.tenantId,
      type: "clinic.capacity_approved",
      message: outcome.requestType === "ADDITIONAL_CLINIC"
        ? `Your request for ${outcome.quantity} additional clinic${outcome.quantity === 1 ? "" : "s"} has been approved. You can now add the clinic.`
        : "Your plan upgrade request has been approved. Your new clinic allowance is available now.",
      requestId: outcome.requestId,
    });
  }
  return outcome;
}

export async function rejectClinicCapacityRequest(
  owner: PlatformActorContext,
  requestId: string,
  input: z.infer<typeof ownerRejectionSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.clinicCapacityRequest.findFirst({ where: { id: requestId, tenant: CUSTOMER_TENANT_WHERE }, select: { tenantId: true } });
    if (!initial) throw new ScopeError();
    await lockTenantForClinicCapacity(tx, initial.tenantId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM clinic_capacity_requests WHERE id = ${requestId} FOR UPDATE`);
    const request = await tx.clinicCapacityRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!isOpenClinicCapacityRequest(request.status)) throw new ConflictError("This request has already been processed.");
    const updated = await tx.clinicCapacityRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", rejectionReason: input.reason, reviewedById: owner.userId, reviewedAt: new Date() },
      select: { id: true, tenantId: true, status: true },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_REQUEST_REJECTED,
      targetType: "ClinicCapacityRequest",
      targetId: request.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      beforeValue: { status: request.status },
      afterValue: { status: "REJECTED" },
      reason: input.reason,
    });
    return updated;
  }, clinicCapacityTransactionOptions);
  await notifyClinicCapacityDecision({ tenantId: result.tenantId, type: "clinic.capacity_rejected", message: "Your clinic capacity request was not approved. Open Clinics to review the decision.", requestId: result.id });
  return result;
}

export async function createManualClinicCapacityGrant(
  owner: PlatformActorContext,
  input: z.infer<typeof manualClinicCapacityGrantSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockTenantForClinicCapacity(tx, input.tenantId);
    const tenant = await tx.tenant.findFirst({ where: { id: input.tenantId, ...CUSTOMER_TENANT_WHERE }, select: { id: true, planId: true } });
    if (!tenant) throw new ScopeError();
    if (!tenant.planId) throw new ConflictError("Assign a plan before granting additional clinic capacity.");
    const startsAt = input.startsAt ?? new Date();
    if (input.expiresAt && input.expiresAt <= startsAt) throw new BadRequestError("Expiry must be after the start date.");
    const grant = await tx.tenantClinicCapacityGrant.create({
      data: { tenantId: tenant.id, quantity: input.quantity, type: input.type, approvedById: owner.userId, approvedAt: new Date(), reason: input.reason, startsAt, expiresAt: input.expiresAt },
      select: { id: true, tenantId: true, quantity: true, type: true, status: true },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_GRANTED,
      targetType: "TenantClinicCapacityGrant",
      targetId: grant.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      afterValue: { tenantId: tenant.id, quantity: grant.quantity, type: grant.type, status: grant.status },
      reason: input.reason,
    });
    return grant;
  }, clinicCapacityTransactionOptions);
  await notifyClinicCapacityDecision({ tenantId: result.tenantId, type: "clinic.capacity_approved", message: `${result.quantity} additional clinic slot${result.quantity === 1 ? " has" : "s have"} been added to your organization.`, requestId: result.id });
  return result;
}

export async function revokeClinicCapacityGrant(
  owner: PlatformActorContext,
  grantId: string,
  input: z.infer<typeof revokeClinicCapacityGrantSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.tenantClinicCapacityGrant.findUnique({ where: { id: grantId }, select: { tenantId: true } });
    if (!initial) throw new ScopeError();
    await lockTenantForClinicCapacity(tx, initial.tenantId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tenant_clinic_capacity_grants WHERE id = ${grantId} FOR UPDATE`);
    const grant = await tx.tenantClinicCapacityGrant.findUniqueOrThrow({ where: { id: grantId } });
    if (grant.status !== "ACTIVE") throw new ConflictError("This clinic capacity grant is no longer active.");
    const updated = await tx.tenantClinicCapacityGrant.update({
      where: { id: grant.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: owner.userId, revocationReason: input.reason },
      select: { id: true, tenantId: true, status: true },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_REVOKED,
      targetType: "TenantClinicCapacityGrant",
      targetId: grant.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      beforeValue: { status: grant.status, quantity: grant.quantity },
      afterValue: { status: updated.status, quantity: grant.quantity },
      reason: input.reason,
    });
    return updated;
  }, clinicCapacityTransactionOptions);
}

export async function setPlanClinicPolicy(
  owner: PlatformActorContext,
  input: z.infer<typeof planClinicPolicySchema>,
) {
  const plan = await prisma.plan.findUnique({ where: { key: input.planKey }, select: { id: true } });
  if (!plan) throw new BadRequestError("That plan does not exist.");
  const price = input.additionalClinicPrice === null ? null : new Prisma.Decimal(input.additionalClinicPrice);
  const billingInterval = price === null ? null : input.additionalClinicBillingInterval;
  return prisma.$transaction(async (tx) => {
    // Lock every affected allocation row first. Clinic creation, grants,
    // revocations and plan upgrades use the same per-tenant lock.
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM tenants
      WHERE plan_id = ${plan.id}
        OR (${input.planKey === DEFAULT_PLAN_KEY} AND plan_id IS NULL AND status = 'ACTIVE')
      ORDER BY id FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM plans WHERE id = ${plan.id} FOR UPDATE`);
    const before = await tx.plan.findUniqueOrThrow({
      where: { id: plan.id },
      select: {
        includedClinics: true,
        additionalClinicPrice: true,
        additionalClinicCurrency: true,
        additionalClinicBillingInterval: true,
      },
    });
    const unchanged =
      before.includedClinics === input.includedClinics &&
      (before.additionalClinicPrice?.toFixed(2) ?? null) === (price?.toFixed(2) ?? null) &&
      before.additionalClinicCurrency === input.additionalClinicCurrency &&
      before.additionalClinicBillingInterval === billingInterval;
    if (unchanged) throw new ConflictError("That clinic policy is already current.");
    const updated = await tx.plan.update({
      where: { id: plan.id },
      data: { includedClinics: input.includedClinics, additionalClinicPrice: price, additionalClinicCurrency: input.additionalClinicCurrency, additionalClinicBillingInterval: billingInterval },
      select: { key: true, includedClinics: true, additionalClinicPrice: true, additionalClinicCurrency: true, additionalClinicBillingInterval: true },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.PLAN_CLINIC_LIMIT_CHANGED,
      targetType: "Plan",
      targetId: plan.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      actorTenantId: null,
      beforeValue: { includedClinics: before.includedClinics, additionalClinicPrice: before.additionalClinicPrice?.toFixed(2) ?? null, currency: before.additionalClinicCurrency, billingInterval: before.additionalClinicBillingInterval },
      afterValue: { includedClinics: updated.includedClinics, additionalClinicPrice: updated.additionalClinicPrice?.toFixed(2) ?? null, currency: updated.additionalClinicCurrency, billingInterval: updated.additionalClinicBillingInterval },
      reason: input.reason,
    });
    return { ...updated, additionalClinicPrice: updated.additionalClinicPrice?.toFixed(2) ?? null };
  }, clinicCapacityTransactionOptions);
}
