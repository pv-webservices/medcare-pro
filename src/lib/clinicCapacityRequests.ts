import { Prisma } from "@prisma/client";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import {
  clinicCapacityTransactionOptions,
  lockTenantForClinicCapacity,
  resolveClinicCapacity,
} from "@/lib/clinicCapacity";
import { isOpenClinicCapacityRequest } from "@/lib/clinicCapacityPolicy";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import type { ClinicCapacityRequestInput } from "@/lib/clinicCapacityRequestSchema";

export { clinicCapacityRequestSchema } from "@/lib/clinicCapacityRequestSchema";

export async function getClinicCapacityForActor(actor: ActorContext) {
  await requireModule(actor, MODULE_FEATURES.clinics);
  await requirePermission(actor, "clinic:create");
  return resolveClinicCapacity(actor.tenantId, { includePlans: true });
}

export async function submitClinicCapacityRequest(
  actor: ActorContext,
  input: ClinicCapacityRequestInput,
) {
  await requireModule(actor, MODULE_FEATURES.clinics);
  // With no clinic id this can only be satisfied by a tenant-wide role.
  await requirePermission(actor, "clinic:create");

  return prisma.$transaction(async (tx) => {
    await lockTenantForClinicCapacity(tx, actor.tenantId);
    const capacity = await resolveClinicCapacity(actor.tenantId, {
      client: tx,
      includePlans: true,
    });

    const existing = await tx.clinicCapacityRequest.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { in: ["PENDING", "PAYMENT_PENDING", "PAYMENT_SUBMITTED", "UNDER_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictError(`Request already submitted. Status: ${existing.status.replaceAll("_", " ").toLowerCase()}.`);
    }
    if (!capacity.hasPlan) {
      throw new BadRequestError("Your organization does not have a plan. Contact MEDCARE PRO before requesting capacity.");
    }

    let requestedPlanId: string | null = null;
    let requestedQuantity: number | null = null;
    let unitPriceSnapshot: Prisma.Decimal | null = null;
    let currency: string | null = null;
    let billingInterval = null as typeof capacity.additionalClinicBillingInterval;
    let paymentStatus: "NOT_REQUIRED" | "PENDING" | "SUBMITTED" = "NOT_REQUIRED";
    let status: "PENDING" | "PAYMENT_PENDING" | "PAYMENT_SUBMITTED" = "PENDING";

    if (input.requestType === "ADDITIONAL_CLINIC") {
      requestedQuantity = input.requestedQuantity!;
      unitPriceSnapshot = capacity.additionalClinicPrice
        ? new Prisma.Decimal(capacity.additionalClinicPrice)
        : null;
      currency = capacity.additionalClinicCurrency;
      billingInterval = capacity.additionalClinicBillingInterval;
      paymentStatus = input.paymentReference ? "SUBMITTED" : "PENDING";
      status = input.paymentReference
        ? "PAYMENT_SUBMITTED"
        : unitPriceSnapshot
          ? "PAYMENT_PENDING"
          : "PENDING";
    } else {
      const plan = capacity.higherPlans.find((entry) => entry.id === input.requestedPlanId);
      if (!plan) {
        throw new BadRequestError("Choose an active plan with a higher clinic allowance.");
      }
      requestedPlanId = plan.id;
    }

    const request = await tx.clinicCapacityRequest.create({
      data: {
        tenantId: actor.tenantId,
        requestedById: actor.userId,
        requestType: input.requestType,
        requestedQuantity,
        requestedPlanId,
        status,
        unitPriceSnapshot,
        currency,
        billingInterval,
        paymentStatus,
        paymentReference: input.paymentReference || null,
        organizationNote: input.organizationNote || null,
      },
      select: {
        id: true,
        requestType: true,
        requestedQuantity: true,
        requestedPlanId: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
      },
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_REQUESTED,
      targetType: "ClinicCapacityRequest",
      targetId: request.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: {
        requestType: request.requestType,
        requestedQuantity: request.requestedQuantity,
        requestedPlanId: request.requestedPlanId,
        status: request.status,
        paymentStatus: request.paymentStatus,
      },
    });

    return request;
  }, clinicCapacityTransactionOptions);
}

export async function cancelClinicCapacityRequest(
  actor: ActorContext,
  requestId: string,
) {
  await requireModule(actor, MODULE_FEATURES.clinics);
  await requirePermission(actor, "clinic:create");

  return prisma.$transaction(async (tx) => {
    await lockTenantForClinicCapacity(tx, actor.tenantId);
    const request = await tx.clinicCapacityRequest.findFirst({
      where: { id: requestId, tenantId: actor.tenantId },
      select: { id: true, status: true },
    });
    if (!request) throw new ScopeError();
    if (!isOpenClinicCapacityRequest(request.status)) {
      throw new ConflictError("This request can no longer be cancelled.");
    }

    const updated = await tx.clinicCapacityRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED" },
      select: { id: true, status: true, updatedAt: true },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_CAPACITY_REQUEST_CANCELLED,
      targetType: "ClinicCapacityRequest",
      targetId: request.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { status: request.status },
      afterValue: { status: updated.status },
    });
    return updated;
  }, clinicCapacityTransactionOptions);
}
