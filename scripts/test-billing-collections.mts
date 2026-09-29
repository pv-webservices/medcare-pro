/** PB-5 collections report checks called by the localhost-guarded test-billing runner. Synthetic fixtures only. */
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { saveBillingSettings } from "@/lib/billing/billingSettings";
import { createDraftInvoice, saveDraftInvoice, issueInvoice, cancelInvoice, createReplacementInvoice } from "@/lib/billing/invoices";
import { recordPayment, voidPayment } from "@/lib/billing/payments";
import { getCollectionsReport, getCollectionsReportForExport, type CollectionsReport } from "@/lib/billing/collectionsReport";
import { toCollectionsCsv } from "@/lib/billing/collectionsCsv";
import { getRevenueReport } from "@/lib/reports";
import { PermissionError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";

type Actor = (kind: string, tenantId: string, clinicId: string | null, permissions: readonly string[]) => Promise<{ actor: ActorContext }>;
/** An instant from an India clock reading. */
const ist = (local: string) => new Date(`${local}:00+05:30`);

export async function testBillingCollections(context: { tenant: (kind: string) => Promise<{ id: string }>; actor: Actor; otherOwner: ActorContext }) {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname), "Disposable local DB required");
  let checks = 0;
  const check = (label: string, condition: unknown) => { assert.ok(condition, label); checks++; console.log(`PASS PB-5 ${label}`); };
  const reject = async (label: string, work: () => Promise<unknown>, kind: new (...args: never[]) => Error) => {
    await assert.rejects(work, (error: unknown) => error instanceof kind); checks++; console.log(`PASS PB-5 ${label}`);
  };
  // A tenant of its own, so every total below is exact.
  const tenant = await context.tenant("collections");
  const clinicX = await prisma.clinic.create({ data: { tenantId: tenant.id, name: "PB-5 Clinic X" } });
  const clinicY = await prisma.clinic.create({ data: { tenantId: tenant.id, name: "PB-5 Clinic Y" } });
  const owner = (await context.actor("pb5-owner", tenant.id, null, ["*"])).actor;
  const registrations: string[] = [];
  try {
    await saveBillingSettings(owner, clinicX.id, { gstin: "27AAPFU0939F1ZV" });
    async function visit(clinicId: string) {
      const patient = await prisma.patient.create({ data: { tenantId: tenant.id, clinicId, patientCode: `PB5-${crypto.randomUUID()}`, name: "Collections patient", mobileNumber: "9222222222" } });
      const row = await prisma.registration.create({ data: { clinicId, patientId: patient.id, department: "General", amount: "0.00",
        visitDate: new Date("2026-09-28T10:00:00Z"), createdBy: owner.userId } });
      registrations.push(row.id);
      return row;
    }
    const line = (unitPrice: string, discountAmount = "0.00", taxRatePercent = "0.00") => ({ serviceItemId: null, description: "Synthetic service",
      category: "PROCEDURE", quantity: 1, unitPrice, discountAmount, taxRatePercent, sacCode: null });
    async function bill(clinicId: string, issuedAt: Date, lines: ReturnType<typeof line>[]) {
      const draft = await createDraftInvoice(owner, (await visit(clinicId)).id);
      const saved = await saveDraftInvoice(owner, draft.id, { revision: draft.revision, lines });
      const issued = await issueInvoice(owner, saved.id, { revision: saved.revision });
      await prisma.invoice.update({ where: { id: issued.id }, data: { issuedAt } });
      return issued;
    }
    async function pay(invoiceId: string, amount: string, mode: string, receivedAt: Date) {
      const { payment } = await recordPayment(owner, invoiceId, { amount, mode });
      await prisma.invoicePayment.update({ where: { id: payment.id }, data: { receivedAt } });
      return payment;
    }

    // B1 partial, issued and part-paid 23:59 IST 30 Sep; the rest part-paid 00:01 IST 1 Oct.
    const b1 = await bill(clinicX.id, ist("2026-09-30T23:59"), [line("1000.00")]);
    await pay(b1.id, "300.00", "CASH", ist("2026-09-30T23:59"));
    await pay(b1.id, "400.00", "UPI", ist("2026-10-01T00:01"));
    // B2 taxed with a discount (590.00), issued 00:01 IST 1 Oct; one voided payment; 200 paid 23:59 IST 31 Oct.
    const b2 = await bill(clinicX.id, ist("2026-10-01T00:01"), [line("550.00", "50.00", "18.00")]);
    const mistaken = await pay(b2.id, "590.00", "CARD", ist("2026-10-02T10:00"));
    await voidPayment(owner, b2.id, mistaken.id, { reason: "Synthetic mistaken card entry" });
    await pay(b2.id, "200.00", "UPI", ist("2026-10-31T23:59"));
    // B3 taxed with a discount (826.00): paid, voided, cancelled. Its stale balance must never count.
    const b3 = await bill(clinicX.id, ist("2026-10-05T12:00"), [line("750.00", "50.00", "18.00")]);
    await voidPayment(owner, b3.id, (await pay(b3.id, "826.00", "CASH", ist("2026-10-05T12:05"))).id, { reason: "Synthetic cash reversal" });
    await cancelInvoice(owner, b3.id, { reason: "Synthetic wrong service" });
    check("fixture: the cancelled bill keeps a stale balance", (await prisma.invoice.findUniqueOrThrow({ where: { id: b3.id } })).balanceDue.toFixed(2) === "826.00");
    // B4 replaces B3, issued 12:00 IST 6 Oct, paid in full 00:01 IST 1 Nov.
    const replacement = await createReplacementInvoice(owner, b3.id);
    const b4 = await issueInvoice(owner, replacement.id, { revision: replacement.revision });
    await prisma.invoice.update({ where: { id: b4.id }, data: { issuedAt: ist("2026-10-06T12:00") } });
    await pay(b4.id, "826.00", "BANK_TRANSFER", ist("2026-11-01T00:01"));
    // B5 at Clinic Y, part-paid; and a draft that never counts.
    const b5 = await bill(clinicY.id, ist("2026-10-10T10:00"), [line("250.00")]);
    await pay(b5.id, "100.00", "OTHER", ist("2026-10-10T10:00"));
    await createDraftInvoice(owner, (await visit(clinicX.id)).id).then((draft) => saveDraftInvoice(owner, draft.id, { revision: draft.revision, lines: [line("999.00")] }));

    const october = ist("2026-10-15T11:30");
    const report = await getCollectionsReport(owner, { period: "monthly" }, october);
    const k = report.kpis;
    check("billed counts ISSUED bills by issue date: cancelled and draft excluded, 23:59 IST 30 Sep in September",
      k.billed === "1666.00" && k.billCount === 3 && k.previousBilled === "1000.00");
    check("collected counts ACTIVE payments by received date: voided, 23:59 IST 30 Sep and 00:01 IST 1 Nov excluded",
      k.collected === "700.00" && k.paymentCount === 3 && k.previousCollected === "300.00");
    check("outstanding is ISSUED balance only; the cancelled bill's stale balance never counts", k.outstanding === "840.00" && k.outstandingCount === 3);
    check("discounts and GST come from ISSUED bills only", k.discounts === "100.00" && k.cgst === "108.00" && k.sgst === "108.00" && k.gst === "216.00");
    const month = (series: CollectionsReport["billedSeries"], key: string) => series.find((point) => point.bucket === key);
    check("monthly series splits at IST midnight on 1 October", month(report.billedSeries, "2026-09-01")?.revenue === "1000.00"
      && month(report.billedSeries, "2026-10-01")?.revenue === "1666.00" && month(report.collectedSeries, "2026-09-01")?.revenue === "300.00"
      && month(report.collectedSeries, "2026-10-01")?.revenue === "700.00");
    check("series counts visits billed and distinct visits paid", month(report.billedSeries, "2026-10-01")?.registrations === 3
      && month(report.collectedSeries, "2026-10-01")?.registrations === 3 && month(report.collectedSeries, "2026-09-01")?.registrations === 1);
    check("by payment mode: only ACTIVE payments in the period", JSON.stringify(report.byPaymentMode.map((row) => [row.id, row.revenue, row.registrations]))
      === JSON.stringify([["UPI", "600.00", 2], ["OTHER", "100.00", 1]]));
    const [x, y] = [report.byClinic.find((row) => row.id === clinicX.id)!, report.byClinic.find((row) => row.id === clinicY.id)!];
    check("by clinic: every figure per clinic", x.billed === "1416.00" && x.billCount === 2 && x.revenue === "600.00" && x.outstanding === "690.00"
      && x.discounts === "100.00" && x.cgst === "108.00" && y.billed === "250.00" && y.revenue === "100.00" && y.outstanding === "150.00" && y.discounts === "0.00");

    const firstOfOctober = await getCollectionsReport(owner, { period: "daily" }, ist("2026-10-01T11:30"));
    const day = (series: CollectionsReport["billedSeries"], key: string) => series.find((point) => point.bucket === key)?.revenue;
    check("daily: 00:01 IST 1 Oct is today although UTC still reads 30 Sep", firstOfOctober.rangeStartDate === "2026-10-01"
      && firstOfOctober.kpis.billed === "590.00" && firstOfOctober.kpis.collected === "400.00");
    check("daily series: 23:59 IST 30 Sep stays in 30 Sep", day(firstOfOctober.billedSeries, "2026-09-30") === "1000.00"
      && day(firstOfOctober.collectedSeries, "2026-09-30") === "300.00" && day(firstOfOctober.collectedSeries, "2026-10-01") === "400.00");
    const november = await getCollectionsReport(owner, { period: "monthly" }, ist("2026-11-01T12:00"));
    check("23:59 IST 31 Oct is October and 00:01 IST 1 Nov is November", november.kpis.collected === "826.00"
      && november.kpis.previousCollected === "700.00" && november.kpis.billed === "0.00");
    check("outstanding is point-in-time, not bound to the period", november.kpis.outstanding === "840.00");

    const onlyX = await getCollectionsReport(owner, { period: "monthly", clinicId: clinicX.id }, october);
    check("clinic filter narrows every figure", onlyX.clinicName === "PB-5 Clinic X" && onlyX.kpis.billed === "1416.00"
      && onlyX.kpis.collected === "600.00" && onlyX.kpis.outstanding === "690.00" && onlyX.byClinic.length === 1);
    const scoped = (await context.actor("pb5-scoped", tenant.id, clinicY.id, ["report:read", "invoice:read"])).actor;
    const scopedReport = await getCollectionsReport(scoped, { period: "monthly" }, october);
    check("clinic-scoped actor totals cover only their clinic", scopedReport.kpis.billed === "250.00" && scopedReport.kpis.collected === "100.00"
      && scopedReport.kpis.outstanding === "150.00" && scopedReport.kpis.gst === "0.00" && scopedReport.byClinic.map((row) => row.id).join() === clinicY.id);
    const outside = await getCollectionsReport(scoped, { period: "monthly", clinicId: clinicX.id }, october);
    check("a clinic outside scope returns zeros, not its figures", !outside.hasClinics && outside.kpis.billed === "0.00" && outside.kpis.outstanding === "0.00");
    const split = (await context.actor("pb5-split", tenant.id, clinicX.id, ["invoice:read"])).actor;
    await prisma.userRole.create({ data: { userId: split.userId, roleId: (await prisma.role.create({ data: { tenantId: tenant.id, name: "pb5-split-report", permissions: ["report:read"] } })).id, clinicId: clinicY.id } });
    check("report:read and invoice:read must meet in the same clinic", !(await getCollectionsReport(split, { period: "monthly" }, october)).hasClinics);
    const revenueOnly = (await context.actor("pb5-revenue-only", tenant.id, null, ["report:read"])).actor;
    await reject("report:read without invoice:read is refused", () => getCollectionsReport(revenueOnly, { period: "monthly" }, october), PermissionError);
    const billingOnly = (await context.actor("pb5-billing-only", tenant.id, null, ["invoice:read"])).actor;
    await reject("invoice:read without report:read is refused", () => getCollectionsReport(billingOnly, { period: "monthly" }, october), PermissionError);
    await reject("export needs reports:export", () => getCollectionsReportForExport(scoped, { period: "monthly" }, october), PermissionError);
    const exporter = (await context.actor("pb5-exporter", tenant.id, clinicY.id, ["report:read", "invoice:read", "reports:export"])).actor;
    const exported = await getCollectionsReportForExport(exporter, { period: "monthly" }, october);
    check("export carries the screen's figures for the export scope", exported.kpis.billed === "250.00"
      && toCollectionsCsv(exported, "clinics").includes("PB-5 Clinic Y,1,250.00,1,100.00,0.00,0.00,0.00,150.00"));
    const foreign = await getCollectionsReport(context.otherOwner, { period: "monthly", clinicId: clinicX.id }, october);
    check("another tenant naming our clinic gets nothing", !foreign.hasClinics && foreign.kpis.billed === "0.00");
    check("another tenant's report never lists our clinics", !(await getCollectionsReport(context.otherOwner, { period: "monthly" }, october))
      .byClinic.some((row) => [clinicX.id, clinicY.id].includes(row.id ?? "")));
    const revenue = await getRevenueReport(owner, { period: "monthly" }, new Date("2026-09-15T00:00:00Z"));
    const liveTotals = await prisma.registration.aggregate({ where: { id: { in: registrations } }, _sum: { amount: true } });
    check("revenue report still sums registrations.amount by visit date", revenue.kpis.totalRevenue === liveTotals._sum.amount?.toFixed(2));

    const feature = await prisma.feature.findUniqueOrThrow({ where: { key: "billing" } });
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureId: feature.id, enabled: false, reason: "Synthetic PB-5 regression" } });
    try {
      await reject("billing disabled blocks the collections report", () => getCollectionsReport(owner, { period: "monthly" }, october), FeatureError);
      check("billing disabled leaves the revenue report working", (await getRevenueReport(owner, { period: "monthly" })).hasClinics);
    } finally { await prisma.tenantFeatureOverride.deleteMany({ where: { tenantId: tenant.id } }); }
  } catch (error) {
    console.error("PB-5 acceptance failure before fixture cleanup:", error);
    throw error;
  } finally {
    // RESTRICT order: payments, then invoices (replacement link first), then the visits behind them.
    await prisma.invoicePayment.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.invoice.updateMany({ where: { tenantId: tenant.id }, data: { replacesInvoiceId: null } });
    await prisma.invoice.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.registrationEditLog.deleteMany({ where: { registrationId: { in: registrations } } });
    await prisma.registration.deleteMany({ where: { id: { in: registrations } } });
    await prisma.patient.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.invoiceNumberSequence.deleteMany({ where: { clinicId: { in: [clinicX.id, clinicY.id] } } });
  }
  return checks;
}
