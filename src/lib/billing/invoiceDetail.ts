import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { can, ScopeError, type ActorContext } from "@/lib/rbac";
import { ConflictError } from "@/lib/domainErrors";
import { getBillingSettingsForClinic } from "./billingSettings";
import { documentTypeFor } from "./documentType";
import { financialYearFor } from "./financialYear";
import type { InvoicePreviewSnapshot } from "./invoiceValidation";
import { calculate, invoiceForActor, linesRecord, toInvoiceRecord } from "./invoices";
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

/**
 * Review before issuing (read-only). The SAVED draft rendered the way it will print:
 * live clinic, patient, doctor and billing settings (issue freezes these), the saved
 * lines and totals, and the document type issuing will assign. No number or issue time.
 */
export async function getInvoicePreviewForActor(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const row = await invoiceForActor(actor, id);
  if (row.status !== "DRAFT") throw new ConflictError("This bill is no longer a draft.");
  const visit = await prisma.registration.findFirst({ where: { id: row.registrationId, clinicId: row.clinicId, clinic: { tenantId: actor.tenantId } },
    include: { patient: true, clinic: true, doctor: true } });
  if (!visit) throw new ScopeError();
  const settings = await getBillingSettingsForClinic(actor, row.clinicId);
  const invoice = toInvoiceRecord(row);
  // The same computation issuing uses, so the preview can't disagree with the bill.
  const computed = calculate(linesRecord(row));
  const preview: InvoicePreviewSnapshot = {
    clinic: { name: visit.clinic.name, legalName: settings.legalName, address: visit.clinic.address, city: visit.clinic.city,
      logoUrl: visit.clinic.logoUrl, gstin: settings.gstin, footerNote: settings.footerNote },
    patient: { patientCode: visit.patient.patientCode, name: visit.patient.name, age: visit.patient.age, gender: visit.patient.gender,
      mobileNumber: visit.patient.mobileNumber, city: visit.patient.city },
    doctor: visit.doctor ? { name: visit.doctor.name, department: visit.doctor.department } : null,
    visit: { date: visit.visitDate.toISOString(), type: visit.visitType },
    lines: computed.lines, totals: computed.totals,
    documentType: documentTypeFor(settings.gstin, row.lines.some((line) => !line.taxRatePercent.isZero())),
    invoiceNumber: null, issuedAt: null,
  };
  return { invoiceId: invoice.id, revision: invoice.revision, preview,
    numberExample: `${settings.invoicePrefix}-${financialYearFor(new Date())}-000xx` };
}
export type InvoicePreview = Awaited<ReturnType<typeof getInvoicePreviewForActor>>;
