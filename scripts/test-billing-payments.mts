/** PB-4 checks called by the localhost-guarded test-billing runner. Synthetic fixtures only. */
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { createDraftInvoice, saveDraftInvoice, issueInvoice, discardDraftInvoice, cancelInvoice, createReplacementInvoice, getLiveInvoiceForRegistration } from "@/lib/billing/invoices";
import { recordPayment, voidPayment } from "@/lib/billing/payments";
import { listDuesForActor, listDuesForExport } from "@/lib/billing/dues";
import { toDuesCsv } from "@/lib/billing/duesCsv";
import { getInvoiceDetailForActor } from "@/lib/billing/invoiceDetail";
import { listNotificationsForActor } from "@/lib/notifications";
import { updateRegistration } from "@/lib/registrations";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { FeatureError } from "@/lib/featureResolution";

const IST_MS = 19_800_000;
const DAY_MS = 86_400_000;

export async function testBillingPayments(context: { owner: ActorContext; otherOwner: ActorContext; staff: ActorContext; reception: ActorContext; clinicA: string; clinicB: string }) {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname), "Disposable local DB required");
  const { owner, otherOwner, staff, reception, clinicA, clinicB } = context;
  const registrations: string[] = [];
  const patients: string[] = [];
  const doctors: string[] = [];
  const stamp = crypto.randomUUID().slice(0, 8);
  let checks = 0;
  const check = (label: string, condition: unknown) => { assert.ok(condition, label); checks++; console.log(`PASS PB-4 ${label}`); };
  const reject = async (label: string, work: () => Promise<unknown>, kind: new (...args: never[]) => Error) => {
    await assert.rejects(work, (error: unknown) => error instanceof kind); checks++; console.log(`PASS PB-4 ${label}`);
  };
  async function doctor(clinicId: string, name: string) {
    const row = await prisma.doctor.create({ data: { clinicId, name, department: "General" } });
    doctors.push(row.id);
    return row;
  }
  async function visit(clinicId = clinicA, amount = "0.00") {
    const patient = await prisma.patient.create({ data: { tenantId: owner.tenantId, clinicId, patientCode: `PB4-${crypto.randomUUID()}`, name: `Dues patient ${stamp}`, mobileNumber: "9111111111" } });
    patients.push(patient.id);
    const doc = await doctor(clinicId, "Synthetic PB-4 doctor");
    const row = await prisma.registration.create({ data: { clinicId, patientId: patient.id, doctorId: doc.id, department: "General", amount, visitDate: new Date("2026-09-28T10:00:00Z"), createdBy: owner.userId } });
    registrations.push(row.id);
    return row;
  }
  async function issued(total = "1000.00", clinicId = clinicA) {
    const registration = await visit(clinicId);
    const draft = await createDraftInvoice(owner, registration.id);
    const saved = await saveDraftInvoice(owner, draft.id, { revision: draft.revision, lines: [{ serviceItemId: null, description: "Synthetic procedure",
      category: "PROCEDURE", quantity: 1, unitPrice: total, discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }] });
    return { registration, invoice: await issueInvoice(owner, saved.id, { revision: saved.revision }) };
  }
  const pay = (actor: ActorContext, invoiceId: string, amount: string, extra: Record<string, unknown> = {}) => recordPayment(actor, invoiceId, { amount, mode: "UPI", ...extra });
  try {
    const adminRole = await prisma.role.create({ data: { tenantId: owner.tenantId, name: `PB-4 admin ${stamp}`, permissions: [...DEFAULT_ROLES.find((role) => role.key === "CLINIC_ADMIN")!.permissions] } });
    const adminUser = await prisma.user.create({ data: { tenantId: owner.tenantId, name: "PB-4 admin", email: `pb4-admin-${stamp}@example.test`, passwordHash: "synthetic-no-login",
      userRoles: { create: { roleId: adminRole.id, clinicId: clinicA } } } });
    const admin: ActorContext = { tenantId: owner.tenantId, userId: adminUser.id };

    // Payments: partial, limits, permissions, void and recomputation.
    const { registration, invoice } = await issued();
    const first = await pay(reception, invoice.id, "400", { reference: "UTR-SYNTHETIC-1" });
    check("Receptionist records a partial UPI payment", first.invoice.paymentStatus === "PARTIAL" && first.invoice.amountPaid === "400.00" && first.invoice.balanceDue === "600.00" && first.payment.reference === "UTR-SYNTHETIC-1");
    const paymentAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: first.payment.id, action: "PAYMENT_RECORDED" } });
    check("payment audit holds amounts and no reference", JSON.stringify(paymentAudit.afterValue).includes("400.00") && !JSON.stringify(paymentAudit.afterValue).includes("UTR-SYNTHETIC"));
    await reject("payment above balance is refused", () => pay(owner, invoice.id, "600.01"), BadRequestError);
    await reject("zero payment is refused", () => pay(owner, invoice.id, "0"), ZodError);
    await reject("received time beyond five minutes ahead is refused", () => pay(owner, invoice.id, "1", { receivedAt: new Date(Date.now() + 6 * 60_000).toISOString() }), BadRequestError);
    const second = await pay(owner, invoice.id, "100", { mode: "CASH", receivedAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    check("received time within five minutes is accepted", second.invoice.balanceDue === "500.00");
    await reject("Staff cannot record a payment", () => pay(staff, invoice.id, "1"), PermissionError);
    await reject("foreign tenant cannot record a payment", () => pay(otherOwner, invoice.id, "1"), ScopeError);
    await reject("Receptionist cannot void a payment", () => voidPayment(reception, invoice.id, first.payment.id, { reason: "Wrong entry" }), PermissionError);
    await reject("Receptionist cannot cancel a bill", () => cancelInvoice(reception, invoice.id, { reason: "Wrong bill" }), PermissionError);
    await reject("cancel is blocked while payments are active", () => cancelInvoice(owner, invoice.id, { reason: "Wrong bill" }), ConflictError);
    await reject("void needs a reason of 3+ characters", () => voidPayment(owner, invoice.id, first.payment.id, { reason: "no" }), ZodError);
    const other = await issued("50.00", clinicB);
    await reject("a payment id from another bill is not found", () => voidPayment(owner, other.invoice.id, first.payment.id, { reason: "Wrong entry" }), ScopeError);
    await reject("Staff from Clinic A cannot void in Clinic B", () => voidPayment(staff, other.invoice.id, first.payment.id, { reason: "Wrong entry" }), ScopeError);
    const voided = await voidPayment(owner, invoice.id, first.payment.id, { reason: "Synthetic void narrative" });
    check("void restores the balance and keeps the row", voided.invoice.balanceDue === "900.00" && voided.invoice.paymentStatus === "PARTIAL" && voided.payment.status === "VOIDED"
      && (await prisma.invoicePayment.findUniqueOrThrow({ where: { id: first.payment.id } })).voidReason === "Synthetic void narrative");
    await reject("a voided payment cannot be voided again", () => voidPayment(owner, invoice.id, first.payment.id, { reason: "Again" }), ConflictError);
    const unpaid = await voidPayment(owner, invoice.id, second.payment.id, { reason: "Duplicate entry" });
    check("voiding every payment returns the bill to Unpaid", unpaid.invoice.paymentStatus === "UNPAID" && unpaid.invoice.amountPaid === "0.00" && unpaid.invoice.balanceDue === "1000.00");
    const full = await pay(reception, invoice.id, "1000.00", { mode: "CARD" });
    check("paying the balance marks the bill Paid", full.invoice.paymentStatus === "PAID" && full.invoice.balanceDue === "0.00");
    await reject("a paid bill takes no further payment", () => pay(owner, invoice.id, "0.01"), ConflictError);
    const detail = await getInvoiceDetailForActor(reception, invoice.id);
    check("detail lists every payment with receptionist actions", detail.payments.length === 3 && detail.may.recordPayment && !detail.may.cancel);
    const voidAudit = await prisma.auditLog.findMany({ where: { action: "PAYMENT_VOIDED", targetId: { in: [first.payment.id, second.payment.id] } } });
    check("void audit excludes the narrative", voidAudit.length === 2 && !JSON.stringify(voidAudit).includes("Synthetic void narrative"));
    const race = await issued("1000.00");
    const raced = await Promise.allSettled([pay(owner, race.invoice.id, "600"), pay(reception, race.invoice.id, "600")]);
    check("two payments that together exceed the balance: exactly one succeeds",
      raced.filter((result) => result.status === "fulfilled").length === 1 && (await prisma.invoice.findUniqueOrThrow({ where: { id: race.invoice.id } })).balanceDue.toFixed(2) === "400.00");

    // Cancellation.
    await voidPayment(owner, invoice.id, full.payment.id, { reason: "Paid by mistake" });
    const draftOnly = await createDraftInvoice(owner, (await visit()).id);
    await reject("a draft is discarded, not cancelled", () => cancelInvoice(owner, draftOnly.id, { reason: "Not needed" }), ConflictError);
    const logsBefore = await prisma.registrationEditLog.count({ where: { registrationId: registration.id } });
    const cancelled = await cancelInvoice(owner, invoice.id, { reason: "Synthetic cancel narrative" });
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    check("cancel keeps number and snapshot and frees the live key", cancelled.status === "CANCELLED" && row.activeKey === null && row.invoiceNumber === invoice.invoiceNumber && row.snapshot !== null && row.cancelReason === "Synthetic cancel narrative");
    check("cancel sets the visit amount to 0", (await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).amount.toFixed(2) === "0.00");
    const cancelLog = await prisma.registrationEditLog.findFirstOrThrow({ where: { registrationId: registration.id }, orderBy: { timestamp: "desc" } });
    check("cancel writes one amount edit-log row in the existing shape", await prisma.registrationEditLog.count({ where: { registrationId: registration.id } }) === logsBefore + 1
      && JSON.stringify(cancelLog.changedFields) === JSON.stringify({ amount: { from: "1000.00", to: "0.00" } }));
    const cancelAudit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: invoice.id, action: "INVOICE_CANCELLED" } });
    check("cancel audit excludes the narrative", !JSON.stringify(cancelAudit.afterValue).includes("Synthetic cancel narrative"));
    await reject("a cancelled bill takes no payment", () => pay(owner, invoice.id, "1"), ConflictError);
    await reject("a cancelled bill cannot be cancelled again", () => cancelInvoice(owner, invoice.id, { reason: "Again" }), ConflictError);
    check("registration amount is editable again after cancel", (await updateRegistration(owner, registration.id, { amount: 10 })).amount === "10.00");
    await updateRegistration(owner, registration.id, { amount: 0 });

    // Replacement.
    await reject("Staff cannot create a replacement", () => createReplacementInvoice(staff, invoice.id), PermissionError);
    await reject("a discarded draft cannot be replaced", async () => createReplacementInvoice(owner, (await discardDraftInvoice(owner, draftOnly.id)).id), ConflictError);
    const newDoctor = await doctor(clinicA, `Replacement doctor ${stamp}`);
    await prisma.registration.update({ where: { id: registration.id }, data: { doctorId: newDoctor.id } });
    const racedReplacements = await Promise.allSettled([createReplacementInvoice(reception, invoice.id), createReplacementInvoice(owner, invoice.id)]);
    const replacements = racedReplacements.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    check("only one replacement per cancelled bill, even concurrently", replacements.length === 1
      && racedReplacements.some((result) => result.status === "rejected" && result.reason instanceof ConflictError));
    const replacement = replacements[0];
    check("replacement clones the lines as a draft for the same visit", replacement.status === "DRAFT" && replacement.replacesInvoiceId === invoice.id
      && replacement.registrationId === registration.id && replacement.lines.length === 1 && replacement.totals.grandTotal === "1000.00" && replacement.invoiceNumber === null);
    await reject("a second replacement is refused", () => createReplacementInvoice(owner, invoice.id), ConflictError);
    const reissued = await issueInvoice(owner, replacement.id, { revision: replacement.revision });
    check("replacement issue gets a new number and sets the amount again", reissued.invoiceNumber !== invoice.invoiceNumber
      && (await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).amount.toFixed(2) === "1000.00");
    const reissuedRow = await prisma.invoice.findUniqueOrThrow({ where: { id: replacement.id } });
    check("issue bills the visit's current doctor", reissuedRow.doctorId === newDoctor.id && reissued.snapshot?.doctor?.name === `Replacement doctor ${stamp}`);
    const blocked = await issued("20.00");
    await cancelInvoice(owner, blocked.invoice.id, { reason: "Wrong service" });
    await createDraftInvoice(owner, blocked.registration.id);
    await reject("replacement is refused while the visit has another live bill", () => createReplacementInvoice(owner, blocked.invoice.id), ConflictError);
    check("the fresh live bill is untouched", (await getLiveInvoiceForRegistration(owner, blocked.registration.id))?.replacesInvoiceId === null);

    // Notifications (after commit, clinic-scoped, invoice number + amount, no demographics).
    const notes = await prisma.notification.findMany({ where: { tenantId: owner.tenantId, relatedRecordId: invoice.id } });
    const cancelNote = notes.find((note) => note.type === "invoice.cancelled");
    const voidNotes = notes.filter((note) => note.type === "payment.voided");
    check("cancel and each void raise one notification", !!cancelNote && voidNotes.length === 3 && notes.every((note) => note.clinicId === clinicA));
    check("messages name the number and amount, never the patient", cancelNote!.message.includes(invoice.invoiceNumber!) && cancelNote!.message.includes("₹1,000.00")
      && notes.every((note) => !note.message.includes("Dues patient") && !note.message.includes("9111111111")));
    const adminFeed = await listNotificationsForActor(admin, { limit: 200 });
    check("Admin sees billing notifications linked to the bill", adminFeed.items.some((item) => item.type === "invoice.cancelled" && item.href === `/billing/${invoice.id}`)
      && adminFeed.items.some((item) => item.type === "payment.voided"));
    await reject("Staff cannot read the notification feed", () => listNotificationsForActor(staff), PermissionError);

    // Dues: IST day boundaries at 7/8 and 30/31, filters, totals and CSV scope.
    const now = new Date("2026-10-15T06:00:00Z");
    const istMidnight = (daysAgo: number) => new Date(Math.floor((now.getTime() + IST_MS) / DAY_MS - daysAgo) * DAY_MS - IST_MS);
    const ages = { 7: istMidnight(7), 8: new Date(istMidnight(7).getTime() - 1000), 30: istMidnight(30), 31: new Date(istMidnight(30).getTime() - 1000) } as const;
    const aged: Record<string, string> = {};
    for (const [days, at] of Object.entries(ages)) {
      const bill = await issued("75.00");
      await prisma.invoice.update({ where: { id: bill.invoice.id }, data: { issuedAt: at } });
      aged[days] = bill.invoice.id;
    }
    const bucketIds = async (age: string) => new Set((await listDuesForActor(owner, { age, search: `Dues patient ${stamp}` }, now)).items.map((item) => item.id));
    const [young, middle, old] = [await bucketIds("0-7"), await bucketIds("8-30"), await bucketIds("31+")];
    check("day 7 is 0-7 and day 8 is 8-30 at the IST boundary", young.has(aged[7]) && !young.has(aged[8]) && middle.has(aged[8]) && !middle.has(aged[7]));
    check("day 30 is 8-30 and day 31 is 31+ at the IST boundary", middle.has(aged[30]) && !middle.has(aged[31]) && old.has(aged[31]) && !old.has(aged[30]));
    const ageRows = (await listDuesForActor(owner, { search: `Dues patient ${stamp}` }, now)).items.filter((item) => Object.values(aged).includes(item.id));
    check("row ages match the bucket boundaries", JSON.stringify(ageRows.map((item) => [item.ageDays, item.ageBucket]).sort())
      === JSON.stringify([[30, "8-30"], [31, "31+"], [7, "0-7"], [8, "8-30"]]));
    const dues = await listDuesForActor(owner, { search: `Dues patient ${stamp}` });
    check("dues exclude paid, cancelled and draft bills", !dues.items.some((item) => [invoice.id, blocked.invoice.id].includes(item.id))
      && dues.items.every((item) => item.balanceDue !== "0.00"));
    const single = await listDuesForActor(owner, { search: race.invoice.invoiceNumber! });
    check("dues total is the balance of the matching bills", single.total === 1 && single.totalBalanceDue === "400.00");
    check("dues search by mobile number", (await listDuesForActor(owner, { search: "9111111111" })).items.some((item) => item.id === race.invoice.id));
    await reject("Staff cannot filter dues to another clinic", () => listDuesForActor(staff, { clinicId: clinicB }), ScopeError);
    check("Staff dues stay inside Clinic A", (await listDuesForActor(staff, {})).items.every((item) => item.id !== other.invoice.id));
    await reject("CSV export needs reports:export", () => listDuesForExport(reception, {}), PermissionError);
    const exported = await listDuesForExport(owner, { search: `Dues patient ${stamp}` });
    check("CSV rows match the screen and use an INR header", exported.length === dues.total && toDuesCsv(exported).includes("Balance due (INR)"));

    const feature = await prisma.feature.findUniqueOrThrow({ where: { key: "billing" } });
    await prisma.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, featureId: feature.id, enabled: false, reason: "Synthetic PB-4 regression" } });
    try {
      await reject("billing disabled blocks payments", () => pay(owner, race.invoice.id, "1"), FeatureError);
      await reject("billing disabled blocks dues", () => listDuesForActor(owner, {}), FeatureError);
    } finally { await prisma.tenantFeatureOverride.delete({ where: { tenantId_featureId: { tenantId: owner.tenantId, featureId: feature.id } } }); }
  } catch (error) {
    console.error("PB-4 acceptance failure before fixture cleanup:", error);
    throw error;
  } finally {
    await prisma.invoicePayment.deleteMany({ where: { invoice: { registrationId: { in: registrations } } } });
    await prisma.invoice.updateMany({ where: { registrationId: { in: registrations } }, data: { replacesInvoiceId: null } });
    await prisma.invoice.deleteMany({ where: { registrationId: { in: registrations } } });
    await prisma.registrationEditLog.deleteMany({ where: { registrationId: { in: registrations } } });
    await prisma.registration.deleteMany({ where: { id: { in: registrations } } });
    await prisma.patient.deleteMany({ where: { id: { in: patients } } });
    await prisma.doctor.deleteMany({ where: { id: { in: doctors } } });
    await prisma.invoiceNumberSequence.deleteMany({ where: { clinicId: { in: [clinicA, clinicB] } } });
  }
  return checks;
}
