/** PB-4 concurrency gate: three consecutive real-database runs at an explicit deployment-matched pool size. */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { createDraftInvoice, saveDraftInvoice, issueInvoice, cancelInvoice } from "@/lib/billing/invoices";
import { recordPayment } from "@/lib/billing/payments";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";

const execFileAsync = promisify(execFile);
const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname), "Disposable local billing DB required");
const poolSize = Number(url.searchParams.get("connection_limit"));
assert.ok(Number.isInteger(poolSize) && poolSize > 0, "Set an explicit connection_limit matching the verified deployment");
const PAYMENTS = 10;
const PAIRS = 10;
console.log(`PB-4 concurrency: connection_limit=${poolSize}; (a) ${PAYMENTS} simultaneous 300.00 payments on a 1000.00 bill; `
  + `(b) ${PAIRS} bills each with a simultaneous cancel + payment; transaction timeout remains 15000ms`);

let tenantId: string | undefined;
async function captureStallEvidence(label: string, seconds: number) {
  for (const statement of ["SHOW ENGINE INNODB STATUS\\G", "SHOW FULL PROCESSLIST"]) {
    try {
      const result = await execFileAsync("docker", ["exec", "medcare-pb4-validation-20260929", "mariadb", "-uroot", "-ppb4-disposable-only", "-e", statement], { timeout: 5000 });
      console.error(`${label} at ${seconds}s, ${statement}:\n${result.stdout}`);
    } catch (error) { console.error(`${label} at ${seconds}s, ${statement} unavailable:`, error); }
  }
}
async function timed<T>(label: string, work: () => Promise<T>) {
  let finished = false;
  const evidence = [8, 12].map((seconds) => setTimeout(() => { if (!finished) void captureStallEvidence(label, seconds); }, seconds * 1000));
  const started = performance.now();
  try { return { result: await work(), elapsedMs: Math.round(performance.now() - started) }; }
  finally { finished = true; evidence.forEach(clearTimeout); }
}
const expectedRejection = (reason: unknown) => reason instanceof BadRequestError || reason instanceof ConflictError;

try {
  await seedFeatureCatalogue(prisma);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  const stamp = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: "PB-4 concurrency", slug: `pb4-concurrency-${stamp}`, email: `pb4-${stamp}@example.test`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id } });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, name: "Owner", permissions: ["*"] } });
  const user = await prisma.user.create({ data: { tenantId, name: "Synthetic", email: `owner-${stamp}@example.test`, passwordHash: "synthetic-no-login", userRoles: { create: { roleId: role.id } } } });
  const actor = { tenantId, userId: user.id };
  async function issuedBill(clinicId: string, label: string) {
    const patient = await prisma.patient.create({ data: { tenantId: actor.tenantId, clinicId, patientCode: `PB4-${label}`, name: "Synthetic concurrency patient", mobileNumber: "9000000000" } });
    const visit = await prisma.registration.create({ data: { clinicId, patientId: patient.id, department: "General", amount: "0.00", visitDate: new Date(), createdBy: user.id } });
    const draft = await createDraftInvoice(actor, visit.id);
    const saved = await saveDraftInvoice(actor, draft.id, { revision: 0, lines: [{ serviceItemId: null, description: "Synthetic procedure", category: "PROCEDURE", quantity: 1, unitPrice: "1000.00", discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }] });
    return issueInvoice(actor, saved.id, { revision: saved.revision });
  }
  for (let run = 1; run <= 3; run++) {
    const clinic = await prisma.clinic.create({ data: { tenantId, name: `Payment run ${run}` }, select: { id: true } });

    // (a) Overdraw attempt: 10 × 300.00 against 1000.00. Exactly three fit.
    const bill = await issuedBill(clinic.id, `${run}-a`);
    const a = await timed(`Run ${run} (a)`, () => Promise.allSettled(Array.from({ length: PAYMENTS }, () => recordPayment(actor, bill.id, { amount: "300.00", mode: "CASH" }))));
    const fulfilled = a.result.filter((outcome) => outcome.status === "fulfilled").length;
    const unexpected = a.result.find((outcome) => outcome.status === "rejected" && !expectedRejection(outcome.reason));
    if (unexpected?.status === "rejected") throw unexpected.reason;
    const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } });
    const active = await prisma.invoicePayment.aggregate({ where: { invoiceId: bill.id, status: "ACTIVE" }, _sum: { amount: true }, _count: { _all: true } });
    assert.equal(fulfilled, 3);
    assert.equal(active._count._all, 3);
    assert.equal(active._sum.amount?.toFixed(2), "900.00");
    assert.equal(settled.amountPaid.toFixed(2), "900.00");
    assert.equal(settled.balanceDue.toFixed(2), "100.00");
    assert.ok(!settled.balanceDue.isNegative(), "balance never negative");
    assert.equal(settled.paymentStatus, "PARTIAL");
    console.log(JSON.stringify({ run, gate: "a", elapsedMs: a.elapsedMs, poolSize, fulfilled, rejected: PAYMENTS - fulfilled, balanceDue: settled.balanceDue.toFixed(2) }));

    // (b) Cancel races payment on each of 10 bills, all 20 operations at once.
    const bills: Awaited<ReturnType<typeof issuedBill>>[] = [];
    for (let index = 0; index < PAIRS; index++) bills.push(await issuedBill(clinic.id, `${run}-b-${index}`));
    const b = await timed(`Run ${run} (b)`, () => Promise.all(bills.map((target) => Promise.allSettled([
      cancelInvoice(actor, target.id, { reason: "Synthetic concurrency cancel" }),
      recordPayment(actor, target.id, { amount: "250.00", mode: "UPI" }),
    ]))));
    let cancelWon = 0;
    let paymentWon = 0;
    for (const [index, [cancel, payment]] of b.result.entries()) {
      for (const outcome of [cancel, payment]) if (outcome.status === "rejected" && !(outcome.reason instanceof ConflictError)) throw outcome.reason;
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: bills[index].id } });
      const activePayments = await prisma.invoicePayment.count({ where: { invoiceId: row.id, status: "ACTIVE" } });
      assert.ok(!(row.status === "CANCELLED" && activePayments > 0), "never CANCELLED with an ACTIVE payment");
      assert.equal([cancel, payment].filter((outcome) => outcome.status === "fulfilled").length, 1, "exactly one of the pair commits");
      if (cancel.status === "fulfilled") { cancelWon++; assert.equal(row.status, "CANCELLED"); assert.equal(activePayments, 0); }
      else { paymentWon++; assert.equal(row.status, "ISSUED"); assert.equal(activePayments, 1); assert.equal(row.balanceDue.toFixed(2), "750.00"); }
    }
    console.log(JSON.stringify({ run, gate: "b", elapsedMs: b.elapsedMs, poolSize, pairs: PAIRS, cancelWon, paymentWon }));
    console.log(`PASS payment concurrency run ${run}: (a) 3/${PAYMENTS} fit in ${a.elapsedMs}ms; (b) ${cancelWon} cancel-first, ${paymentWon} payment-first in ${b.elapsedMs}ms; no CANCELLED bill holds an ACTIVE payment, no timeouts`);
  }
} catch (error) {
  console.error("PB-4 concurrency failed", error);
  throw error;
} finally {
  try {
    if (tenantId) {
      await prisma.invoicePayment.deleteMany({ where: { tenantId } });
      await prisma.invoice.deleteMany({ where: { tenantId } });
      await prisma.invoiceNumberSequence.deleteMany({ where: { clinic: { tenantId } } });
      await prisma.registrationEditLog.deleteMany({ where: { registration: { clinic: { tenantId } } } });
      await prisma.registration.deleteMany({ where: { clinic: { tenantId } } });
      await prisma.patient.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({ where: { actorTenantId: tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  } finally { await prisma.$disconnect(); }
}
