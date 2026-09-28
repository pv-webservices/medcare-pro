import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { can, requirePermission, resolveRoleNameAtTime, ScopeError, type ActorContext } from "@/lib/rbac";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { writeAuditLog } from "@/lib/audit";
import { writeRegistrationChanges } from "@/lib/registrations";
import { billingClinic } from "./billingAccess";
import { getBillingSettingsForClinic } from "./billingSettings";
import { listBillableServicesForClinic } from "./serviceItems";
import { computeLine, computeTotals, derivePaymentStatus, exceedsDiscountLimit, fromPaise, toPaise } from "./invoiceMath";
import { financialYearFor } from "./financialYear";
import { formatInvoiceNumber } from "./invoiceNumber";
import { invoiceFiltersSchema, issueInvoiceSchema, saveInvoiceSchema, type InvoiceLineInput, type InvoiceSnapshot } from "./invoiceValidation";

const include = { lines: { orderBy: { position: "asc" as const } } } satisfies Prisma.InvoiceInclude;
type Invoice = Prisma.InvoiceGetPayload<{ include: typeof include }>;
const visitInclude = { patient: true, clinic: true, doctor: true } satisfies Prisma.RegistrationInclude;
type Visit = Prisma.RegistrationGetPayload<{ include: typeof visitInclude }>;

async function visitForActor(actor: ActorContext, id: string, tx: Prisma.TransactionClient = prisma) {
  const visit = await tx.registration.findFirst({ where: { id, clinic: { tenantId: actor.tenantId } }, include: visitInclude });
  if (!visit || visit.patient.tenantId !== actor.tenantId || visit.patient.clinicId !== visit.clinicId) throw new ScopeError();
  await billingClinic(actor, visit.clinicId, tx);
  return visit;
}
async function invoiceForActor(actor: ActorContext, id: string, tx: Prisma.TransactionClient = prisma) {
  const invoice = await tx.invoice.findFirst({ where: { id, tenantId: actor.tenantId }, include });
  if (!invoice) throw new ScopeError();
  await billingClinic(actor, invoice.clinicId, tx);
  return invoice;
}
function totalsRecord(row: Invoice) {
  return { subtotal: row.subtotal.toFixed(2), discountTotal: row.discountTotal.toFixed(2), taxableTotal: row.taxableTotal.toFixed(2),
    cgstTotal: row.cgstTotal.toFixed(2), sgstTotal: row.sgstTotal.toFixed(2), grandTotal: row.grandTotal.toFixed(2) };
}
function linesRecord(row: Invoice) {
  return row.lines.map((line) => ({ position: line.position, serviceItemId: line.serviceItemId, description: line.description,
    category: line.category, quantity: line.quantity, unitPrice: line.unitPrice.toFixed(2), discountAmount: line.discountAmount.toFixed(2),
    taxRatePercent: line.taxRatePercent.toFixed(2), sacCode: line.sacCode, taxableAmount: line.taxableAmount.toFixed(2),
    taxAmount: line.taxAmount.toFixed(2), lineTotal: line.lineTotal.toFixed(2) }));
}
function record(row: Invoice) {
  return { id: row.id, registrationId: row.registrationId, clinicId: row.clinicId, status: row.status,
    invoiceNumber: row.invoiceNumber, revision: row.revision, paymentStatus: row.paymentStatus,
    amountPaid: row.amountPaid.toFixed(2), balanceDue: row.balanceDue.toFixed(2), totals: totalsRecord(row),
    lines: linesRecord(row), snapshot: row.snapshot as unknown as InvoiceSnapshot | null,
    issuedAt: row.issuedAt?.toISOString() ?? null, createdById: row.createdById };
}
export type InvoiceRecord = ReturnType<typeof record>;

function calculate(lines: InvoiceLineInput[]) {
  try {
    const computed = lines.map(computeLine);
    const totals = computeTotals(computed);
    return { totals: { subtotal: fromPaise(totals.subtotal), discountTotal: fromPaise(totals.discountTotal),
      taxableTotal: fromPaise(totals.taxableTotal), cgstTotal: fromPaise(totals.cgstTotal), sgstTotal: fromPaise(totals.sgstTotal), grandTotal: fromPaise(totals.grandTotal) },
    lines: lines.map((line, position) => ({ ...line, position, taxableAmount: fromPaise(computed[position].taxable),
      taxAmount: fromPaise(computed[position].tax), lineTotal: fromPaise(computed[position].lineTotal) })) };
  } catch (error) {
    if (error instanceof RangeError) throw new BadRequestError(error.message);
    throw error;
  }
}
function draft(row: Invoice, revision?: number) {
  if (row.status !== "DRAFT") throw new ConflictError("This bill is no longer a draft.");
  if (revision !== undefined && row.revision !== revision) throw new ConflictError("This draft changed in another session. Reload and review it.");
}
async function audit(tx: Prisma.TransactionClient, actor: ActorContext, row: Invoice, action: string, extra: Record<string, unknown> = {}) {
  await writeAuditLog(tx, { action, targetType: "Invoice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId,
    afterValue: { invoiceId: row.id, registrationId: row.registrationId, clinicId: row.clinicId, invoiceNumber: row.invoiceNumber,
      status: row.status, grandTotal: row.grandTotal.toFixed(2), ...extra } });
}

/** Clinical and billing writes share Registration FIRST. No invoice/sequence lock can precede it. */
async function withVisitLock<T>(actor: ActorContext, registrationId: string, work: (tx: Prisma.TransactionClient, visit: Visit) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await requireModule(actor, MODULE_FEATURES.billing, tx);
    const visible = await visitForActor(actor, registrationId, tx);
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.id} FOR UPDATE`;
    return work(tx, await visitForActor(actor, registrationId, tx));
  }, { isolationLevel: "ReadCommitted", timeout: 15000, maxWait: 15000 });
}
async function lockedInvoice(tx: Prisma.TransactionClient, actor: ActorContext, id: string, visit: Visit) {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} AND registration_id = ${visit.id} FOR UPDATE`;
  const row = await invoiceForActor(actor, id, tx);
  if (row.registrationId !== visit.id || row.clinicId !== visit.clinicId || row.patientId !== visit.patientId) throw new ScopeError();
  return row;
}

export async function getLiveInvoiceForRegistration(actor: ActorContext, registrationId: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const visit = await visitForActor(actor, registrationId);
  const row = await prisma.invoice.findFirst({ where: { activeKey: visit.id, tenantId: actor.tenantId, clinicId: visit.clinicId }, include });
  return row ? record(row) : null;
}
export async function getInvoiceForActor(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  return record(await invoiceForActor(actor, id));
}
export async function getInvoiceEditorForRegistration(actor: ActorContext, registrationId: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const visit = await visitForActor(actor, registrationId);
  const invoice = await getLiveInvoiceForRegistration(actor, registrationId);
  return { invoice, patientName: visit.patient.name, clinicName: visit.clinic.name,
    mayCreate: await can(actor, "invoice:create", visit.clinicId),
    mayDiscard: !invoice || invoice.createdById === actor.userId || await can(actor, "invoice:cancel", visit.clinicId),
    services: await listBillableServicesForClinic(visit.clinicId) };
}
export async function createDraftInvoice(actor: ActorContext, registrationId: string) {
  return withVisitLock(actor, registrationId, async (tx, visit) => {
    await requirePermission(actor, "invoice:create", visit.clinicId, tx);
    const live = await tx.invoice.findUnique({ where: { activeKey: visit.id } });
    if (live) throw new ConflictError("This visit already has a live bill.");
    const lines: InvoiceLineInput[] = visit.amount.greaterThan(0) ? [{ serviceItemId: null, description: "Consultation", category: "CONSULTATION",
      quantity: 1, unitPrice: visit.amount.toFixed(2), discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }] : [];
    const computed = calculate(lines);
    const row = await tx.invoice.create({ data: { tenantId: actor.tenantId, clinicId: visit.clinicId, registrationId: visit.id,
      patientId: visit.patientId, doctorId: visit.doctorId, activeKey: visit.id, createdById: actor.userId,
      ...computed.totals, amountPaid: "0.00", balanceDue: computed.totals.grandTotal,
      lines: { create: computed.lines } }, include });
    await audit(tx, actor, row, "INVOICE_DRAFT_CREATED");
    return record(row);
  });
}
export async function saveDraftInvoice(actor: ActorContext, id: string, input: unknown) {
  const data = saveInvoiceSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  const visible = await invoiceForActor(actor, id);
  return withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const row = await lockedInvoice(tx, actor, id, visit);
    await requirePermission(actor, "invoice:create", visit.clinicId, tx);
    draft(row, data.revision);
    const billable = new Set((await listBillableServicesForClinic(visit.clinicId, tx)).map((service) => service.id));
    if (data.lines.some((line) => line.serviceItemId && !billable.has(line.serviceItemId))) throw new BadRequestError("Select an active service available at this clinic.");
    const computed = calculate(data.lines);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    const saved = await tx.invoice.update({ where: { id }, data: { ...computed.totals, balanceDue: computed.totals.grandTotal,
      revision: { increment: 1 }, lines: { create: computed.lines } }, include });
    await audit(tx, actor, saved, "INVOICE_DRAFT_UPDATED");
    return record(saved);
  });
}

export async function issueInvoice(actor: ActorContext, id: string, input: unknown) {
  const data = issueInvoiceSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  const visible = await invoiceForActor(actor, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withVisitLock(actor, visible.registrationId, async (tx, visit) => {
        const row = await lockedInvoice(tx, actor, id, visit);
        await requirePermission(actor, "invoice:create", visit.clinicId, tx);
        draft(row, data.revision);
        if (!row.lines.length) throw new BadRequestError("Add at least one line before issuing the bill.");
        const computed = calculate(linesRecord(row));
        const settings = await getBillingSettingsForClinic(actor, visit.clinicId, tx);
        const taxed = row.lines.some((line) => !line.taxRatePercent.isZero());
        if (taxed && !settings.gstin) throw new BadRequestError("Set this clinic's GSTIN before issuing a bill with GST.");
        const discountOverride = exceedsDiscountLimit(computed.totals.discountTotal, computed.totals.subtotal, settings.staffDiscountLimitPercent);
        if (discountOverride) await requirePermission(actor, "invoice:discount:override", visit.clinicId, tx);
        // Finish identity/role reads before serializing this clinic's numbering.
        const doctor = row.doctorId ? await tx.doctor.findFirst({ where: { id: row.doctorId, clinicId: visit.clinicId } }) : null;
        if (row.doctorId && !doctor) throw new ScopeError();
        const before = visit.amount.toFixed(2);
        const roleAtTime = before !== computed.totals.grandTotal
          ? await resolveRoleNameAtTime(actor, visit.clinicId, tx) : null;
        const issuedAt = new Date();
        const financialYear = financialYearFor(issuedAt);
        await tx.invoiceNumberSequence.upsert({ where: { clinicId_financialYear: { clinicId: visit.clinicId, financialYear } },
          create: { clinicId: visit.clinicId, financialYear, lastNumber: 0 }, update: {} });
        const sequences = await tx.$queryRaw<Array<{ last_number: number }>>`
          SELECT last_number FROM invoice_number_sequences WHERE clinic_id = ${visit.clinicId} AND financial_year = ${financialYear} FOR UPDATE`;
        const next = sequences[0].last_number + 1;
        if (next > 99999) throw new ConflictError("This clinic has used all invoice numbers for this financial year.");
        const invoiceNumber = formatInvoiceNumber(settings.invoicePrefix, financialYear, next);
        await tx.invoiceNumberSequence.update({ where: { clinicId_financialYear: { clinicId: visit.clinicId, financialYear } }, data: { lastNumber: next } });
        const documentType = !settings.gstin ? "INVOICE" : taxed ? "TAX_INVOICE" : "BILL_OF_SUPPLY";
        const snapshot: InvoiceSnapshot = {
          clinic: { name: visit.clinic.name, legalName: settings.legalName, address: visit.clinic.address, city: visit.clinic.city,
            logoUrl: visit.clinic.logoUrl, gstin: settings.gstin, footerNote: settings.footerNote },
          patient: { patientCode: visit.patient.patientCode, name: visit.patient.name, age: visit.patient.age, gender: visit.patient.gender,
            mobileNumber: visit.patient.mobileNumber, city: visit.patient.city },
          doctor: doctor ? { name: doctor.name, department: doctor.department } : null,
          visit: { date: visit.visitDate.toISOString(), type: visit.visitType }, lines: computed.lines, totals: computed.totals,
          invoiceNumber, documentType, issuedAt: issuedAt.toISOString(),
        };
        const issued = await tx.invoice.update({ where: { id }, data: { status: "ISSUED", revision: { increment: 1 },
          invoiceNumber, financialYear, documentType, issuedAt, issuedById: actor.userId, snapshot: snapshot as unknown as Prisma.InputJsonValue,
          ...computed.totals, amountPaid: "0.00", balanceDue: computed.totals.grandTotal,
          paymentStatus: derivePaymentStatus(toPaise(computed.totals.grandTotal), 0) }, include });
        if (before !== computed.totals.grandTotal) {
          await tx.registration.update({ where: { id: visit.id }, data: { amount: computed.totals.grandTotal } });
          await writeRegistrationChanges(tx, actor, visit.id, roleAtTime!,
            { amount: { from: before, to: computed.totals.grandTotal } });
        }
        await audit(tx, actor, issued, "INVOICE_ISSUED", { discountOverride });
        return record(issued);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not issue the bill. Try again.");
}
export async function discardDraftInvoice(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const visible = await invoiceForActor(actor, id);
  return withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const row = await lockedInvoice(tx, actor, id, visit);
    draft(row);
    const mayCancel = await can(actor, "invoice:cancel", visit.clinicId, tx);
    await requirePermission(actor, mayCancel ? "invoice:cancel" : row.createdById === actor.userId ? "invoice:create" : "invoice:cancel", visit.clinicId, tx);
    const cancelled = await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", activeKey: null,
      cancelledAt: new Date(), cancelledById: actor.userId, revision: { increment: 1 } }, include });
    await audit(tx, actor, cancelled, "INVOICE_DRAFT_DISCARDED");
    return record(cancelled);
  });
}
export async function listInvoicesForActor(actor: ActorContext, input: unknown = {}) {
  const filters = invoiceFiltersSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  if (filters.clinicId) await billingClinic(actor, filters.clinicId);
  const clinic = await clinicWhereForActor(actor, "invoice:read", filters.clinicId);
  if (!clinic) throw new ScopeError();
  const where: Prisma.InvoiceWhereInput = { tenantId: actor.tenantId, clinic,
    status: filters.status, paymentStatus: filters.paymentStatus, doctorId: filters.doctorId,
    ...(filters.from || filters.to ? { issuedAt: {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00+05:30`) } : {}),
      ...(filters.to ? { lt: new Date(new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000) } : {}),
    } } : {}),
    ...(filters.search ? { OR: [ { invoiceNumber: { contains: filters.search } },
      ...["name", "mobileNumber", "patientCode"].map((key) => ({ patient: { [key]: { contains: filters.search } } })) ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: { ...include, patient: { select: { name: true, patientCode: true } }, clinic: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (filters.page - 1) * 25 }),
    prisma.invoice.count({ where }),
  ]);
  return { items: rows.map((row) => ({ ...record(row), patientName: row.patient.name, patientCode: row.patient.patientCode, clinicName: row.clinic.name })),
    total, page: filters.page, pageSize: 25 };
}

export async function getInvoiceFilterOptions(actor: ActorContext) {
  await requireModule(actor, MODULE_FEATURES.billing);
  const clinic = await clinicWhereForActor(actor, "invoice:read");
  if (!clinic) throw new ScopeError();
  const [clinics, doctors] = await Promise.all([
    prisma.clinic.findMany({ where: clinic, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.doctor.findMany({ where: { clinic }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return { clinics, doctors };
}
