import type { Prisma } from "@prisma/client";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { formatRupees } from "@/lib/money";
import { notifyPaymentVoided } from "@/lib/notifications";
import { invoiceForActor, invoiceInclude, lockedInvoice, toInvoiceRecord, withVisitLock } from "./invoices";
import { derivePaymentStatus, fromPaise, toPaise } from "./invoiceMath";
import { billingReasonSchema, recordPaymentSchema } from "./invoiceValidation";

/** A received time may run slightly ahead of the server clock, never further. */
const RECEIVED_AT_LEEWAY_MS = 5 * 60 * 1000;

export const paymentInclude = { recorder: { select: { name: true } }, voider: { select: { name: true } } } satisfies Prisma.InvoicePaymentInclude;
type Payment = Prisma.InvoicePaymentGetPayload<{ include: typeof paymentInclude }>;

export function toPaymentRecord(row: Payment) {
  return { id: row.id, amount: row.amount.toFixed(2), mode: row.mode, reference: row.reference, receivedAt: row.receivedAt.toISOString(),
    status: row.status, recordedByName: row.recorder.name, voidedAt: row.voidedAt?.toISOString() ?? null,
    voidedByName: row.voider?.name ?? null, voidReason: row.voidReason };
}
export type PaymentRecord = ReturnType<typeof toPaymentRecord>;

async function activePaidPaise(tx: Prisma.TransactionClient, invoiceId: string) {
  const active = await tx.invoicePayment.findMany({ where: { invoiceId, status: "ACTIVE" }, select: { amount: true } });
  return active.reduce((sum, payment) => sum + toPaise(payment.amount.toFixed(2)), 0);
}
/** Totals always come from the ACTIVE rows, recomputed under the invoice lock. */
async function settle(tx: Prisma.TransactionClient, invoiceId: string, grandTotal: string) {
  const grand = toPaise(grandTotal);
  const paid = await activePaidPaise(tx, invoiceId);
  return tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: fromPaise(paid), balanceDue: fromPaise(grand - paid),
    paymentStatus: derivePaymentStatus(grand, paid) }, include: invoiceInclude });
}
async function auditPayment(tx: Prisma.TransactionClient, actor: ActorContext, action: string, payment: Payment,
  invoice: Awaited<ReturnType<typeof settle>>) {
  await writeAuditLog(tx, { action, targetType: "InvoicePayment", targetId: payment.id, actorUserId: actor.userId, actorTenantId: actor.tenantId,
    afterValue: { paymentId: payment.id, invoiceId: invoice.id, registrationId: invoice.registrationId, clinicId: invoice.clinicId,
      invoiceNumber: invoice.invoiceNumber, mode: payment.mode, amount: payment.amount.toFixed(2), status: payment.status,
      amountPaid: invoice.amountPaid.toFixed(2), balanceDue: invoice.balanceDue.toFixed(2), paymentStatus: invoice.paymentStatus } });
}

/** FR-11.16. Registration then invoice are locked, so concurrent payments cannot overdraw the balance. */
export async function recordPayment(actor: ActorContext, invoiceId: string, input: unknown) {
  const data = recordPaymentSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  const visible = await invoiceForActor(actor, invoiceId);
  return withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const row = await lockedInvoice(tx, actor, invoiceId, visit);
    await requirePermission(actor, "payment:record", visit.clinicId, tx);
    if (row.status !== "ISSUED") throw new ConflictError("Payments can only be recorded against an issued bill.");
    const receivedAt = data.receivedAt ? new Date(data.receivedAt) : new Date();
    if (receivedAt.getTime() > Date.now() + RECEIVED_AT_LEEWAY_MS) throw new BadRequestError("The received time cannot be in the future.");
    const balance = toPaise(row.grandTotal.toFixed(2)) - await activePaidPaise(tx, invoiceId);
    if (balance === 0) throw new ConflictError("This bill is already paid in full.");
    if (toPaise(data.amount) > balance) throw new BadRequestError(`The payment exceeds the balance due of ${formatRupees(fromPaise(balance))}.`);
    const payment = await tx.invoicePayment.create({ data: { tenantId: actor.tenantId, clinicId: visit.clinicId, invoiceId, amount: data.amount,
      mode: data.mode, reference: data.reference, receivedAt, recordedById: actor.userId }, include: paymentInclude });
    const settled = await settle(tx, invoiceId, row.grandTotal.toFixed(2));
    await auditPayment(tx, actor, "PAYMENT_RECORDED", payment, settled);
    return { invoice: toInvoiceRecord(settled), payment: toPaymentRecord(payment) };
  });
}

/** FR-11.17. The row is kept as VOIDED; refunds are out of scope. */
export async function voidPayment(actor: ActorContext, invoiceId: string, paymentId: string, input: unknown) {
  const { reason } = billingReasonSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  const visible = await invoiceForActor(actor, invoiceId);
  const result = await withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const row = await lockedInvoice(tx, actor, invoiceId, visit);
    const current = await tx.invoicePayment.findFirst({ where: { id: paymentId, invoiceId, tenantId: actor.tenantId, clinicId: visit.clinicId } });
    if (!current) throw new ScopeError();
    await requirePermission(actor, "invoice:cancel", visit.clinicId, tx);
    if (current.status !== "ACTIVE") throw new ConflictError("This payment is already voided.");
    const payment = await tx.invoicePayment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date(),
      voidedById: actor.userId, voidReason: reason }, include: paymentInclude });
    const settled = await settle(tx, invoiceId, row.grandTotal.toFixed(2));
    await auditPayment(tx, actor, "PAYMENT_VOIDED", payment, settled);
    return { invoice: toInvoiceRecord(settled), payment: toPaymentRecord(payment), clinicName: visit.clinic.name };
  });
  await notifyPaymentVoided(actor, { invoiceId, clinicId: result.invoice.clinicId, clinicName: result.clinicName,
    invoiceNumber: result.invoice.invoiceNumber!, amount: result.payment.amount });
  return { invoice: result.invoice, payment: result.payment };
}
