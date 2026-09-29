import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { can, type ActorContext } from "@/lib/rbac";
import { invoiceForActor, toInvoiceRecord } from "./invoices";
import { paymentInclude, toPaymentRecord } from "./payments";

/** /billing/[id]: the bill, its payments and which actions this actor may take. */
export async function getInvoiceDetailForActor(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const row = await invoiceForActor(actor, id);
  const [payments, replacement, live, mayRecordPayment, mayCancel, mayCreate] = await Promise.all([
    prisma.invoicePayment.findMany({ where: { invoiceId: row.id, tenantId: actor.tenantId }, include: paymentInclude, orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] }),
    prisma.invoice.findFirst({ where: { replacesInvoiceId: row.id, tenantId: actor.tenantId }, select: { id: true, status: true, invoiceNumber: true } }),
    prisma.invoice.findFirst({ where: { activeKey: row.registrationId, tenantId: actor.tenantId }, select: { id: true } }),
    can(actor, "payment:record", row.clinicId),
    can(actor, "invoice:cancel", row.clinicId),
    can(actor, "invoice:create", row.clinicId),
  ]);
  return { invoice: toInvoiceRecord(row), payments: payments.map(toPaymentRecord), replacement,
    liveInvoiceId: live && live.id !== row.id ? live.id : null, may: { recordPayment: mayRecordPayment, cancel: mayCancel, create: mayCreate } };
}
export type InvoiceDetail = Awaited<ReturnType<typeof getInvoiceDetailForActor>>;

/** /billing/[id]/print (FR-11.22): the frozen bill plus its ACTIVE payments, read live. */
export async function getInvoicePrintForActor(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const row = await invoiceForActor(actor, id);
  const payments = await prisma.invoicePayment.findMany({ where: { invoiceId: row.id, tenantId: actor.tenantId, status: "ACTIVE" },
    include: paymentInclude, orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] });
  return { invoice: toInvoiceRecord(row), payments: payments.map(toPaymentRecord) };
}
