import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { billingClinic } from "./billingAccess";
import { billingSettingsSchema } from "./billingValidation";

export async function getBillingSettingsForClinic(actor: ActorContext, clinicId: string, tx: Prisma.TransactionClient = prisma) {
  await requireModule(actor, MODULE_FEATURES.billing, tx);
  const clinic = await billingClinic(actor, clinicId, tx);
  const row = await tx.clinicBillingSettings.findFirst({ where: { clinicId: clinic.id, tenantId: clinic.tenantId } });
  return {
    clinicId: clinic.id,
    gstin: row?.gstin ?? null,
    legalName: row?.legalName ?? null,
    invoicePrefix: row?.invoicePrefix ?? "INV",
    staffDiscountLimitPercent: row?.staffDiscountLimitPercent.toFixed(2) ?? "0.00",
    footerNote: row?.footerNote ?? null,
  };
}
export type BillingSettingsRecord = Awaited<ReturnType<typeof getBillingSettingsForClinic>>;

export async function saveBillingSettings(actor: ActorContext, clinicId: string, input: unknown) {
  const data = billingSettingsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireModule(actor, MODULE_FEATURES.billing, tx);
    const clinic = await billingClinic(actor, clinicId, tx);
    await requirePermission(actor, "billing:settings:manage", clinic.id, tx);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${clinic.tenantId} FOR UPDATE`;
    const row = await tx.clinicBillingSettings.upsert({
      where: { clinicId: clinic.id },
      create: { ...data, tenantId: clinic.tenantId, clinicId: clinic.id },
      update: data,
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.BILLING_SETTINGS_UPDATED, targetType: "ClinicBillingSettings", targetId: row.id,
      actorUserId: actor.userId, actorTenantId: actor.tenantId,
      afterValue: { clinicId: clinic.id, invoicePrefix: row.invoicePrefix, staffDiscountLimitPercent: row.staffDiscountLimitPercent.toFixed(2) },
    });
    return getBillingSettingsForClinic(actor, clinic.id, tx);
  });
}
