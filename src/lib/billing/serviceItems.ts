import type { Prisma, ServiceItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { accessibleClinicScope, PermissionError, requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { billingClinic } from "./billingAccess";
import { createServiceItemSchema, updateServiceItemSchema } from "./billingValidation";
import { toPaise } from "./invoiceMath";

function record(row: ServiceItem) {
  return { id: row.id, clinicId: row.clinicId, name: row.name, category: row.category,
    price: row.price.toFixed(2), taxRatePercent: row.taxRatePercent.toFixed(2), sacCode: row.sacCode, isActive: row.isActive };
}
export type ServiceItemRecord = ReturnType<typeof record>;

export async function listServiceItemsForActor(actor: ActorContext, filters: { clinicId?: string; includeInactive?: boolean } = {}) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const scope = await accessibleClinicScope(actor, "invoice:read");
  if (scope.scope === "none") throw new PermissionError("invoice:read");
  const clinic = filters.clinicId ? await billingClinic(actor, filters.clinicId) : null;
  const rows = await prisma.serviceItem.findMany({ where: {
    tenantId: actor.tenantId,
    ...(filters.includeInactive ? {} : { isActive: true }),
    ...(clinic ? { OR: [{ clinicId: null }, { clinicId: clinic.id }] }
      : scope.scope === "clinics" ? { OR: [{ clinicId: null }, { clinic: { tenantId: actor.tenantId, id: { in: [...scope.clinicIds] } } }] } : {}),
  }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return rows.map(record);
}

/** Internal invoice helper. Call only AFTER authorizing the invoice/visit's clinic.
 * Derive tenant ownership from that clinic; never accept a tenant from the browser.
 */
export async function listBillableServicesForClinic(clinicId: string, tx: Prisma.TransactionClient = prisma) {
  const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { id: true, tenantId: true } });
  if (!clinic) throw new ScopeError();
  return (await tx.serviceItem.findMany({ where: { tenantId: clinic.tenantId, isActive: true,
    OR: [{ clinicId: null }, { clinicId: clinic.id }] }, orderBy: [{ name: "asc" }, { id: "asc" }] })).map(record);
}

async function authorizeScope(actor: ActorContext, clinicId: string | null, tx: Prisma.TransactionClient) {
  if (clinicId) await billingClinic(actor, clinicId, tx);
  await requirePermission(actor, "billing:settings:manage", clinicId ?? undefined, tx);
}

async function validateService(tx: Prisma.TransactionClient, tenantId: string, input: { clinicId: string | null; name: string; taxRatePercent: string }, exceptId?: string) {
  // Tenant-row lock held by both writers: closes MySQL's NULL unique-index race.
  const duplicate = await tx.serviceItem.findFirst({ where: { tenantId, clinicId: input.clinicId, name: input.name,
    ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (duplicate) throw new ConflictError("A service with this name already exists in this scope.");
  if (input.clinicId && toPaise(input.taxRatePercent) > 0) {
    const settings = await tx.clinicBillingSettings.findFirst({ where: { tenantId, clinicId: input.clinicId }, select: { gstin: true } });
    if (!settings?.gstin) throw new BadRequestError("Set this clinic's GSTIN before saving a service with GST.");
  }
}

async function audit(tx: Prisma.TransactionClient, actor: ActorContext, row: ServiceItem, action: string) {
  await writeAuditLog(tx, { action, targetType: "ServiceItem", targetId: row.id,
    actorUserId: actor.userId, actorTenantId: actor.tenantId,
    afterValue: { serviceItemId: row.id, clinicId: row.clinicId, price: row.price.toFixed(2), taxRatePercent: row.taxRatePercent.toFixed(2), isActive: row.isActive } });
}

export async function createServiceItem(actor: ActorContext, input: unknown) {
  const data = createServiceItemSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireModule(actor, MODULE_FEATURES.billing, tx);
    await authorizeScope(actor, data.clinicId, tx);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    await validateService(tx, actor.tenantId, data);
    const row = await tx.serviceItem.create({ data: { ...data, tenantId: actor.tenantId } });
    await audit(tx, actor, row, AUDIT_ACTIONS.SERVICE_ITEM_CREATED);
    return record(row);
  }, { isolationLevel: "ReadCommitted" });
}

export async function updateServiceItem(actor: ActorContext, id: string, input: unknown) {
  const patch = updateServiceItemSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireModule(actor, MODULE_FEATURES.billing, tx);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    const row = await tx.serviceItem.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!row) throw new ScopeError();
    await authorizeScope(actor, row.clinicId, tx);
    const data = { ...record(row), ...patch };
    await authorizeScope(actor, data.clinicId, tx);
    await validateService(tx, actor.tenantId, data, id);
    const updated = await tx.serviceItem.update({ where: { id: row.id }, data: patch });
    await audit(tx, actor, updated, AUDIT_ACTIONS.SERVICE_ITEM_UPDATED);
    return record(updated);
  }, { isolationLevel: "ReadCommitted" });
}
