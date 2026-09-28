import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { accessibleClinicScope, PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { billingClinic } from "./billingAccess";
import { daysSinceIssue, duesAgeBucket, issuedAtRangeForBucket } from "./duesAge";
import { duesFiltersSchema, type DuesFilters, type InvoiceSnapshot } from "./invoiceValidation";

const PAGE_SIZE = 25;
/** A download, not an unbounded table scan — the registration export's cap. */
const EXPORT_ROW_LIMIT = 5000;
const EXPORT_PERMISSION = "reports:export";

const duesSelect = { id: true, invoiceNumber: true, issuedAt: true, snapshot: true, grandTotal: true, amountPaid: true,
  balanceDue: true, paymentStatus: true } satisfies Prisma.InvoiceSelect;
type DueRow = Prisma.InvoiceGetPayload<{ select: typeof duesSelect }>;

function dueRecord(row: DueRow, now: Date) {
  const snapshot = row.snapshot as unknown as InvoiceSnapshot;
  const ageDays = daysSinceIssue(row.issuedAt!, now);
  return { id: row.id, invoiceNumber: row.invoiceNumber!, issuedAt: row.issuedAt!.toISOString(), ageDays, ageBucket: duesAgeBucket(ageDays),
    patientName: snapshot.patient.name, patientCode: snapshot.patient.patientCode, mobileNumber: snapshot.patient.mobileNumber,
    clinicName: snapshot.clinic.name, doctorName: snapshot.doctor?.name ?? null, paymentStatus: row.paymentStatus,
    grandTotal: row.grandTotal.toFixed(2), amountPaid: row.amountPaid.toFixed(2), balanceDue: row.balanceDue.toFixed(2) };
}
export type DueRecord = ReturnType<typeof dueRecord>;

/** FR-11.18: ISSUED bills still owing money, inside the actor's invoice:read clinics. */
async function duesWhere(actor: ActorContext, filters: DuesFilters, now: Date): Promise<Prisma.InvoiceWhereInput> {
  if (filters.clinicId) await billingClinic(actor, filters.clinicId);
  const clinic = await clinicWhereForActor(actor, "invoice:read", filters.clinicId);
  if (!clinic) throw new ScopeError();
  return { tenantId: actor.tenantId, clinic, status: "ISSUED", balanceDue: { gt: 0 }, doctorId: filters.doctorId,
    ...(filters.age ? { issuedAt: issuedAtRangeForBucket(filters.age, now) } : {}),
    ...(filters.search ? { OR: [ { invoiceNumber: { contains: filters.search } },
      ...["name", "mobileNumber", "patientCode"].map((key) => ({ patient: { [key]: { contains: filters.search } } })) ] } : {}) };
}

export async function listDuesForActor(actor: ActorContext, input: unknown = {}, now: Date = new Date()) {
  const filters = duesFiltersSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  const where = await duesWhere(actor, filters, now);
  const [rows, summary] = await Promise.all([
    prisma.invoice.findMany({ where, select: duesSelect, orderBy: [{ issuedAt: "asc" }, { id: "asc" }], take: PAGE_SIZE, skip: (filters.page - 1) * PAGE_SIZE }),
    prisma.invoice.aggregate({ where, _count: { _all: true }, _sum: { balanceDue: true } }),
  ]);
  return { items: rows.map((row) => dueRecord(row, now)), total: summary._count._all,
    totalBalanceDue: (summary._sum.balanceDue?.toFixed(2)) ?? "0.00", page: filters.page, pageSize: PAGE_SIZE };
}

/** The same rows as the screen, additionally intersected with reports:export scope. */
export async function listDuesForExport(actor: ActorContext, input: unknown = {}, now: Date = new Date()): Promise<DueRecord[]> {
  const filters = duesFiltersSchema.parse(input);
  await requireModule(actor, MODULE_FEATURES.billing);
  if ((await accessibleClinicScope(actor, EXPORT_PERMISSION)).scope === "none") throw new PermissionError(EXPORT_PERMISSION);
  const where = await duesWhere(actor, filters, now);
  const exportClinic = await clinicWhereForActor(actor, EXPORT_PERMISSION, filters.clinicId);
  // A clinic outside the export grant narrows the file to nothing, as the revenue export does.
  if (!exportClinic) return [];
  const rows = await prisma.invoice.findMany({ where: { AND: [where, { clinic: exportClinic }] }, select: duesSelect,
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }], take: EXPORT_ROW_LIMIT });
  return rows.map((row) => dueRecord(row, now));
}
