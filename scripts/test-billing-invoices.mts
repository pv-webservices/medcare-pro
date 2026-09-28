/** PB-3 checks called by the localhost-guarded test-billing runner. Synthetic fixtures only. */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { prisma } from "@/lib/prisma";
import { createDraftInvoice, saveDraftInvoice, issueInvoice, discardDraftInvoice, getInvoiceForActor, getLiveInvoiceForRegistration, listInvoicesForActor } from "@/lib/billing/invoices";
import { updateRegistration } from "@/lib/registrations";
import { saveBillingSettings } from "@/lib/billing/billingSettings";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { ConflictError, BadRequestError } from "@/lib/domainErrors";
import { FeatureError } from "@/lib/featureResolution";
import type { InvoiceLineInput } from "@/lib/billing/invoiceValidation";

export async function testBillingInvoices(context: { owner: ActorContext; otherOwner: ActorContext; staff: ActorContext; reception: ActorContext; clinicA: string; clinicB: string; foreignClinic: string }) {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname), "Disposable local DB required");
  const { owner, otherOwner, staff, reception, clinicA, clinicB, foreignClinic } = context;
  const registrations: string[] = [];
  const patients: string[] = [];
  const doctors: string[] = [];
  let checks = 0;
  const check = (label: string, condition: unknown) => { assert.ok(condition, label); checks++; console.log(`PASS PB-3 ${label}`); };
  const reject = async (label: string, work: () => Promise<unknown>, kind: new (...args: never[]) => Error) => {
    await assert.rejects(work, (error: unknown) => error instanceof kind); checks++; console.log(`PASS PB-3 ${label}`);
  };
  const line = (patch: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({ serviceItemId: null, description: "Synthetic service", category: "OTHER", quantity: 1, unitPrice: "200.00", discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null, ...patch });
  async function visit(clinicId = clinicA, actor = owner, amount = "100.00") {
    const patient = await prisma.patient.create({ data: { tenantId: actor.tenantId, clinicId, patientCode: `PB3-${crypto.randomUUID()}`, name: "Synthetic billing patient", mobileNumber: "9000000000" } });
    patients.push(patient.id);
    const doctor = await prisma.doctor.create({ data: { clinicId, name: "Synthetic billing doctor", department: "General" } });
    doctors.push(doctor.id);
    const row = await prisma.registration.create({ data: { clinicId, patientId: patient.id, doctorId: doctor.id, department: "General", amount, visitDate: new Date("2026-09-28T10:00:00Z"), createdBy: actor.userId } });
    registrations.push(row.id);
    return row;
  }
  async function prepared(clinicId = clinicA, actor = owner, lines = [line()]) {
    const registration = await visit(clinicId, actor);
    const draft = await createDraftInvoice(actor, registration.id);
    const saved = await saveDraftInvoice(actor, draft.id, { revision: draft.revision, lines });
    return { registration, draft: saved };
  }
  // Pause precisely after updateRegistration's pre-read, before its transaction.
  // Invoice operations retain their real database transactions and row locks.
  async function editAfterConcurrentWrite(registrationId: string, edit: Parameters<typeof updateRegistration>[2], concurrent: () => Promise<unknown>) {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = prisma.$transaction;
    const restore = () => Object.defineProperty(prisma, "$transaction", { configurable: true, writable: true, value: original });
    Object.defineProperty(prisma, "$transaction", { configurable: true, writable: true, value: async (...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "function") {
        restore();
        entered();
        await gate;
      }
      return Reflect.apply(original, prisma, args);
    } });
    const result = updateRegistration(owner, registrationId, edit);
    try {
      await Promise.race([waiting, result.then(() => { throw new Error("Edit did not reach transaction barrier"); })]);
      await concurrent();
    } finally { restore(); release(); }
    return result;
  }
  try {
    const first = await visit();
    const created = await createDraftInvoice(owner, first.id);
    check("prefills consultation from visit amount and allocates no number", created.lines[0].unitPrice === "100.00" && created.lines[0].description === "Consultation" && created.invoiceNumber === null);
    check("copies registration doctor", (await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } })).doctorId === first.doctorId);
    await reject("one live invoice per visit", () => createDraftInvoice(owner, first.id), ConflictError);
    await reject("Staff cannot create", () => createDraftInvoice(staff, first.id), PermissionError);
    const saved = await saveDraftInvoice(owner, created.id, { revision: 0, lines: [line()] });
    await reject("stale save revision", () => saveDraftInvoice(owner, created.id, { revision: 0, lines: [line()] }), ConflictError);
    await reject("stale issue revision", () => issueInvoice(owner, created.id, { revision: 0 }), ConflictError);
    check("draft permits registration amount edits", (await updateRegistration(owner, first.id, { amount: 120 })).amount === "120.00");
    const batch = [saved];
    for (let index = 1; index < 20; index++) batch.push((await prepared()).draft);
    const outcomes = await Promise.allSettled(batch.map((invoice) => issueInvoice(owner, invoice.id, { revision: invoice.revision })));
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const issued = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
    const numbers = issued.map((invoice) => Number(invoice.invoiceNumber!.slice(-5))).sort((a, b) => a - b);
    check("20 concurrent issues allocate exactly 00001-00020 without gaps", JSON.stringify(numbers) === JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 1)));
    check("registration amount synced", (await prisma.registration.findUniqueOrThrow({ where: { id: first.id } })).amount.toFixed(2) === "200.00");
    const log = await prisma.registrationEditLog.findFirstOrThrow({ where: { registrationId: first.id }, orderBy: { timestamp: "desc" } });
    check("amount audit keeps existing shape and locked before value", JSON.stringify(log.changedFields) === JSON.stringify({ amount: { from: "120.00", to: "200.00" } }));
    const count = await prisma.registrationEditLog.count({ where: { registrationId: first.id } });
    await assert.rejects(() => updateRegistration(owner, first.id, { amount: 300 }), (error: unknown) => error instanceof ConflictError && error.message === "This visit has been billed — change the bill instead.");
    check("billed amount edit is 409 with no log", await prisma.registrationEditLog.count({ where: { registrationId: first.id } }) === count);
    check("equal billed amount succeeds without an amount log", (await updateRegistration(owner, first.id, { amount: 200 })).amount === "200.00"
      && await prisma.registrationEditLog.count({ where: { registrationId: first.id } }) === count);
    check("non-amount edit preserves billed total", (await updateRegistration(owner, first.id, { department: "Updated department" })).amount === "200.00");
    const race = await prepared();
    await Promise.all([issueInvoice(owner, race.draft.id, { revision: race.draft.revision }), updateRegistration(owner, race.registration.id, { department: "Concurrent edit" })]);
    check("concurrent issue and non-amount edit preserve synced total", (await prisma.registration.findUniqueOrThrow({ where: { id: race.registration.id } })).amount.toFixed(2) === "200.00");
    const forcedRace = await prepared();
    await editAfterConcurrentWrite(forcedRace.registration.id, { department: "Stale read edit" }, () => issueInvoice(owner, forcedRace.draft.id, { revision: forcedRace.draft.revision }));
    check("forced stale non-amount read cannot overwrite an issued total", (await prisma.registration.findUniqueOrThrow({ where: { id: forcedRace.registration.id } })).amount.toFixed(2) === "200.00");
    const staleAmount = await visit();
    await assert.rejects(() => editAfterConcurrentWrite(staleAmount.id, { amount: 150 }, () => prisma.registration.update({ where: { id: staleAmount.id }, data: { amount: "175.00" } })),
      (error: unknown) => error instanceof ConflictError && error.message === "This visit was changed by someone else — reload and try again.");
    check("stale explicit amount edit rejects without a log", await prisma.registrationEditLog.count({ where: { registrationId: staleAmount.id } }) === 0);
    const b = await prepared(clinicB);
    const bi = await issueInvoice(owner, b.draft.id, { revision: b.draft.revision });
    check("second clinic has independent numbering and INVOICE type", bi.invoiceNumber?.endsWith("00001") && bi.snapshot?.documentType === "INVOICE");
    check("GST registered all-zero tax produces BILL_OF_SUPPLY", issued[0].snapshot?.documentType === "BILL_OF_SUPPLY");
    const snap = JSON.stringify(issued[0].snapshot);
    await prisma.patient.update({ where: { id: first.patientId }, data: { name: "Changed profile" } });
    await prisma.doctor.update({ where: { id: first.doctorId! }, data: { name: "Changed doctor" } });
    await prisma.clinic.update({ where: { id: clinicA }, data: { name: "Changed clinic" } });
    check("issued snapshot survives all profile edits", JSON.stringify((await getInvoiceForActor(owner, created.id)).snapshot) === snap);
    await reject("issued bill cannot be saved", () => saveDraftInvoice(owner, created.id, { revision: issued[0].revision, lines: [] }), ConflictError);
    await reject("issued bill cannot be discarded", () => discardDraftInvoice(owner, created.id), ConflictError);
    const gst = await prepared(clinicB, owner, [line({ taxRatePercent: "18.00" })]);
    await reject("GST rechecked at issue", () => issueInvoice(owner, gst.draft.id, { revision: gst.draft.revision }), BadRequestError);
    check("failed issue does not consume a number", (await prisma.invoiceNumberSequence.findFirstOrThrow({ where: { clinicId: clinicB } })).lastNumber === 1);
    await saveBillingSettings(owner, clinicB, { gstin: "27aapfu0939f1zv" });
    const taxed = await issueInvoice(owner, gst.draft.id, { revision: gst.draft.revision });
    check("tax invoice adds and splits GST", taxed.snapshot?.documentType === "TAX_INVOICE" && taxed.totals.grandTotal === "236.00" && taxed.totals.cgstTotal === "18.00" && taxed.totals.sgstTotal === "18.00");
    const discounted = await prepared(clinicA, owner, [line({ discountAmount: "100.00" })]);
    await reject("Receptionist cannot exceed discount limit", () => issueInvoice(reception, discounted.draft.id, { revision: discounted.draft.revision }), PermissionError);
    const override = await issueInvoice(owner, discounted.draft.id, { revision: discounted.draft.revision });
    const overrideAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: override.id, action: "INVOICE_ISSUED" } });
    check("override records PB-4 notification flag", (overrideAudit.afterValue as { discountOverride: boolean }).discountOverride === true);
    const withinLimit = await prepared(clinicA, reception, [line({ discountAmount: "25.00" })]);
    check("Receptionist can issue at the exact configured discount limit", (await issueInvoice(reception, withinLimit.draft.id, { revision: withinLimit.draft.revision })).status === "ISSUED");
    const zero = await prepared(clinicA, owner, [line({ unitPrice: "0.00" })]);
    const paid = await issueInvoice(owner, zero.draft.id, { revision: zero.draft.revision });
    check("zero total is immediately paid", paid.paymentStatus === "PAID" && paid.balanceDue === "0.00");
    const empty = await visit(clinicA, owner, "0.00");
    const emptyDraft = await createDraftInvoice(owner, empty.id);
    check("zero registration adds no consultation line", emptyDraft.lines.length === 0);
    await reject("cannot issue empty draft", () => issueInvoice(owner, emptyDraft.id, { revision: 0 }), BadRequestError);
    const otherDraft = await createDraftInvoice(reception, (await visit()).id);
    const discarded = await discardDraftInvoice(reception, otherDraft.id);
    check("creator can discard without number", discarded.status === "CANCELLED" && discarded.invoiceNumber === null && await getLiveInvoiceForRegistration(owner, discarded.registrationId) === null);
    check("discard frees live invoice key", (await createDraftInvoice(owner, discarded.registrationId)).status === "DRAFT");
    await reject("non-creator without cancel cannot discard", () => discardDraftInvoice(reception, emptyDraft.id), PermissionError);
    await discardDraftInvoice(owner, emptyDraft.id);
    const foreign = await prepared(foreignClinic, otherOwner);
    await reject("foreign invoice is not found", () => getInvoiceForActor(owner, foreign.draft.id), ScopeError);
    await reject("foreign visit is not found", () => createDraftInvoice(owner, foreign.registration.id), ScopeError);
    await reject("other clinic invoice is not found", () => getInvoiceForActor(staff, b.draft.id), ScopeError);
    await reject("foreign invoice save is not found", () => saveDraftInvoice(owner, foreign.draft.id, { revision: 0, lines: [] }), ScopeError);
    const globalService = await prisma.serviceItem.findFirstOrThrow({ where: { tenantId: owner.tenantId, clinicId: null, isActive: true } });
    const invalidService = await prisma.serviceItem.findFirstOrThrow({ where: { tenantId: otherOwner.tenantId } });
    const pick = await prepared();
    await reject("foreign catalogue item cannot be used", () => saveDraftInvoice(owner, pick.draft.id, { revision: pick.draft.revision, lines: [line({ serviceItemId: invalidService.id })] }), BadRequestError);
    check("tenant-wide active item is billable", (await saveDraftInvoice(owner, pick.draft.id, { revision: pick.draft.revision, lines: [line({ serviceItemId: globalService.id })] })).lines[0].serviceItemId === globalService.id);
    const result = await listInvoicesForActor(staff, { status: "ISSUED", page: 1 });
    check("listing scopes clinic and paginates", result.items.length <= 25 && result.items.every((invoice) => invoice.clinicId === clinicA && invoice.status === "ISSUED"));
    check("invoice number search", (await listInvoicesForActor(owner, { search: bi.invoiceNumber! })).items.some((invoice) => invoice.id === bi.id));
    const feature = await prisma.feature.findUniqueOrThrow({ where: { key: "billing" } });
    await prisma.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, featureId: feature.id, enabled: false, reason: "Synthetic PB-3 regression" } });
    try {
      check("billing disabled permits former amount behavior", (await updateRegistration(owner, first.id, { amount: 350 })).amount === "350.00");
      await reject("billing disabled blocks invoice reads", () => getInvoiceForActor(owner, created.id), FeatureError);
    } finally { await prisma.tenantFeatureOverride.delete({ where: { tenantId_featureId: { tenantId: owner.tenantId, featureId: feature.id } } }); }
    const fy1 = await prepared(clinicB);
    const fy2 = await prepared(clinicB);
    try {
      mock.timers.enable({ apis: ["Date"], now: new Date("2027-03-31T18:29:59Z") });
      const before = await issueInvoice(owner, fy1.draft.id, { revision: fy1.draft.revision });
      mock.timers.setTime(new Date("2027-03-31T18:30:00Z").getTime());
      const after = await issueInvoice(owner, fy2.draft.id, { revision: fy2.draft.revision });
      check("1 April IST starts new FY at sequence one", before.invoiceNumber?.includes("-2627-") && after.invoiceNumber === "INV-2728-00001");
    } finally { mock.timers.reset(); }
    check("normal issue produces no billing notifications", await prisma.notification.count({ where: { tenantId: owner.tenantId, type: { startsWith: "invoice." } } }) === 0);
  } catch (error) {
    console.error("PB-3 acceptance failure before fixture cleanup:", error);
    throw error;
  } finally {
    mock.timers.reset();
    await prisma.invoice.deleteMany({ where: { registrationId: { in: registrations } } });
    await prisma.registrationEditLog.deleteMany({ where: { registrationId: { in: registrations } } });
    await prisma.registration.deleteMany({ where: { id: { in: registrations } } });
    await prisma.patient.deleteMany({ where: { id: { in: patients } } });
    await prisma.doctor.deleteMany({ where: { id: { in: doctors } } });
    await prisma.invoiceNumberSequence.deleteMany({ where: { clinicId: { in: [clinicA, clinicB, foreignClinic] } } });
  }
  return checks;
}
