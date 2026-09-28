/** Three consecutive real-database numbering runs, using an explicit deployment-matched pool size. */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { createDraftInvoice, saveDraftInvoice, issueInvoice } from "@/lib/billing/invoices";

const execFileAsync = promisify(execFile);

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname), "Disposable local billing DB required");
const poolSize = Number(url.searchParams.get("connection_limit"));
assert.ok(Number.isInteger(poolSize) && poolSize > 0, "Set an explicit connection_limit matching the verified deployment");
console.log(`PB-3 concurrency: connection_limit=${poolSize}; 20 simultaneous issueInvoice calls; transaction timeout remains 15000ms`);
let tenantId: string | undefined;
async function captureStallEvidence(run: number, seconds: number) {
  const statements = ["SHOW ENGINE INNODB STATUS\\G", "SHOW FULL PROCESSLIST"];
  for (const statement of statements) {
    try {
      const result = await execFileAsync("docker", ["exec", "medcare-pb3-validation-20260928", "mariadb", "-uroot", "-ppb3-disposable-only", "-e", statement], { timeout: 5000 });
      console.error(`Run ${run} at ${seconds}s, ${statement}:\n${result.stdout}`);
    } catch (error) { console.error(`Run ${run} at ${seconds}s, ${statement} unavailable:`, error); }
  }
}
try {
  await seedFeatureCatalogue(prisma);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  const stamp = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: "PB-3 concurrency", slug: `pb3-concurrency-${stamp}`, email: `pb3-${stamp}@example.test`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id } });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, name: "Owner", permissions: ["*"] } });
  const user = await prisma.user.create({ data: { tenantId, name: "Synthetic", email: `owner-${stamp}@example.test`, passwordHash: "synthetic-no-login", userRoles: { create: { roleId: role.id } } } });
  const actor = { tenantId, userId: user.id };
  for (let run = 1; run <= 3; run++) {
    const clinic: { id: string } = await prisma.clinic.create({ data: { tenantId, name: `Numbering run ${run}` }, select: { id: true } });
    const drafts = [];
    for (let index = 0; index < 20; index++) {
      const patient = await prisma.patient.create({ data: { tenantId, clinicId: clinic.id, patientCode: `PB3-${run}-${index}`, name: "Synthetic concurrency patient", mobileNumber: "9000000000" } });
      const visit = await prisma.registration.create({ data: { clinicId: clinic.id, patientId: patient.id, department: "General", amount: "100.00", visitDate: new Date(), createdBy: user.id } });
      const draft = await createDraftInvoice(actor, visit.id);
      drafts.push(await saveDraftInvoice(actor, draft.id, { revision: 0, lines: [{ serviceItemId: null, description: "Synthetic consultation", category: "CONSULTATION", quantity: 1, unitPrice: "200.00", discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null }] }));
    }
    const started = performance.now();
    let finished = false;
    const evidence = [8, 12].map((seconds) => setTimeout(() => {
      if (!finished) void captureStallEvidence(run, seconds);
    }, seconds * 1000));
    const outcomes = await Promise.allSettled(drafts.map((draft) => issueInvoice(actor, draft.id, { revision: draft.revision })));
    finished = true;
    evidence.forEach(clearTimeout);
    const elapsedMs = Math.round(performance.now() - started);
    console.log(JSON.stringify({ run, elapsedMs, poolSize, fulfilled: outcomes.filter((result) => result.status === "fulfilled").length,
      rejected: outcomes.filter((result) => result.status === "rejected").length }));
    const failure = outcomes.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const issued = outcomes.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const numbers = issued.map((invoice) => invoice.invoiceNumber!.slice(-5)).sort();
    assert.deepEqual(numbers, Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(5, "0")));
    const sequence: { lastNumber: number } = await prisma.invoiceNumberSequence.findFirstOrThrow({ where: { clinicId: clinic.id }, select: { lastNumber: true } });
    assert.equal(sequence.lastNumber, 20);
    console.log(`PASS concurrency run ${run}: ${numbers.join(",")}; ${elapsedMs}ms wall clock, no gaps, duplicates or timeouts`);
  }
} catch (error) {
  console.error("PB-3 concurrency failed", error);
  throw error;
} finally {
  try {
    if (tenantId) {
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
