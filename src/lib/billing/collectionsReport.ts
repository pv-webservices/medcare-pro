import { Prisma, type PaymentMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import type { ActorContext } from "@/lib/rbac";
import { bucketFullLabel, bucketKey, bucketKeysIn, bucketLabel, rangeLabel, type DateRange, type ReportPeriod } from "@/lib/reportPeriods";
import {
  DEFAULT_PERIOD,
  REPORT_EXPORT_PERMISSION,
  REPORT_VIEW_PERMISSION,
  resolveReportClinics,
  type BreakdownRow,
  type ReportFilters,
  type RevenuePoint,
} from "@/lib/reports";
import { PAYMENT_MODE_LABELS } from "./billingLabels";
import { billingCurrentWindow, billingPreviousWindow, billingSeriesWindow, bucketKeyForIndiaDay, IST_OFFSET_MINUTES } from "./billingPeriods";

/**
 * Collections report — FR-11.23. Read-only.
 *
 * Revenue (src/lib/reports.ts) is `registrations.amount` by visit date and is
 * untouched. This report reads the billing tables instead:
 *   - Billed: ISSUED invoices by issued_at. A cancelled bill never counts.
 *   - Collected: ACTIVE payments by received_at. Voided entries never count.
 *   - Outstanding: SUM(balance_due) of ISSUED invoices, now — not period-bound.
 *     Cancelled bills keep their last balance fields, so status is the filter.
 *   - Discounts and GST: ISSUED invoices in the period, like Billed.
 *
 * Scope is the clinics where the actor holds `report:read` AND `invoice:read`
 * (plus `reports:export` for a download), resolved by the revenue report's own
 * resolver, and every query is constrained to that explicit id list and the
 * session tenant. Periods are India-time windows (./billingPeriods).
 *
 * Money stays Decimal end to end; only share percentages and chart geometry
 * become floats, as in the revenue report.
 */

export const COLLECTIONS_VIEW_PERMISSIONS = [REPORT_VIEW_PERMISSION, "invoice:read"] as const;
const COLLECTIONS_EXPORT_PERMISSIONS = [...COLLECTIONS_VIEW_PERMISSIONS, REPORT_EXPORT_PERMISSION] as const;

export interface CollectionsKpis {
  billed: string;
  billCount: number;
  previousBilled: string;
  collected: string;
  paymentCount: number;
  previousCollected: string;
  /** Point-in-time, across every issued bill in scope. */
  outstanding: string;
  outstandingCount: number;
  discounts: string;
  cgst: string;
  sgst: string;
  gst: string;
}

/** `revenue` is the clinic's collections and `registrations` its payment count, as the table shows them. */
export interface ClinicCollectionsRow extends BreakdownRow {
  billed: string;
  billCount: number;
  outstanding: string;
  discounts: string;
  cgst: string;
  sgst: string;
}

export interface CollectionsReport {
  period: ReportPeriod;
  rangeLabel: string;
  /** First India day of the window, `YYYY-MM-DD`, for filenames. */
  rangeStartDate: string;
  /** When the point-in-time Outstanding figure was read. */
  asOf: string;
  kpis: CollectionsKpis;
  /** `registrations` counts the visits billed in the bucket. */
  billedSeries: RevenuePoint[];
  /** `registrations` counts the distinct visits paid for in the bucket. */
  collectedSeries: RevenuePoint[];
  /** `revenue` is the amount collected in that mode, `registrations` the payment count. */
  byPaymentMode: BreakdownRow[];
  byClinic: ClinicCollectionsRow[];
  clinicName: string | null;
  hasClinics: boolean;
}

const ZERO = new Prisma.Decimal(0);

/** SUM() arrives as Decimal, string or null depending on the path; COUNT() may be a BigInt. */
function money(value: unknown): Prisma.Decimal {
  if (value === null || value === undefined) return ZERO;
  return new Prisma.Decimal(typeof value === "bigint" ? value.toString() : (value as Prisma.Decimal.Value));
}
function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function share(part: Prisma.Decimal, total: Prisma.Decimal): number {
  return total.isZero() ? 0 : part.div(total).times(100).toNumber();
}
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), ZERO);

function issuedIn(tenantId: string, clinicIds: string[], range: DateRange): Prisma.InvoiceWhereInput {
  return { tenantId, clinicId: { in: clinicIds }, status: "ISSUED", issuedAt: { gte: range.start, lt: range.end } };
}
function collectedIn(tenantId: string, clinicIds: string[], range: DateRange): Prisma.InvoicePaymentWhereInput {
  return { tenantId, clinicId: { in: clinicIds }, status: "ACTIVE", receivedAt: { gte: range.start, lt: range.end } };
}

/**
 * The India calendar day of an instant column, as 'YYYY-MM-DD'. The offset is
 * the helper's constant, never request input; weeks, months and years are
 * rolled up from these days by bucketKeyForIndiaDay.
 */
function indiaDay(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`DATE_FORMAT(DATE_ADD(${column}, INTERVAL ${Prisma.raw(String(IST_OFFSET_MINUTES))} MINUTE), '%Y-%m-%d')`;
}

interface Bucket {
  amount: Prisma.Decimal;
  visits: Set<string> | number;
}

function toSeries(period: ReportPeriod, keys: string[], buckets: Map<string, Bucket>): RevenuePoint[] {
  return keys.map((key) => {
    const bucket = buckets.get(key);
    const amount = bucket?.amount ?? ZERO;
    const visits = bucket ? (typeof bucket.visits === "number" ? bucket.visits : bucket.visits.size) : 0;
    return { bucket: key, label: bucketLabel(period, key), fullLabel: bucketFullLabel(period, key),
      revenue: amount.toFixed(2), value: amount.toNumber(), registrations: visits };
  });
}

async function buildSeries(tenantId: string, clinicIds: string[], period: ReportPeriod, range: DateRange, keys: string[]) {
  const [billedDays, collectedDays] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; amount: unknown; visits: unknown }>>(Prisma.sql`
      SELECT ${indiaDay(Prisma.sql`issued_at`)} AS day, SUM(grand_total) AS amount, COUNT(*) AS visits
      FROM invoices
      WHERE tenant_id = ${tenantId}
        AND clinic_id IN (${Prisma.join(clinicIds)})
        AND status = 'ISSUED'
        AND issued_at >= ${range.start}
        AND issued_at < ${range.end}
      GROUP BY day`),
    // Grouped per visit as well, so a visit paid twice in one bucket counts once.
    prisma.$queryRaw<Array<{ day: string; registrationId: string; amount: unknown }>>(Prisma.sql`
      SELECT ${indiaDay(Prisma.sql`p.received_at`)} AS day, i.registration_id AS registrationId, SUM(p.amount) AS amount
      FROM invoice_payments p
      JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
      WHERE p.tenant_id = ${tenantId}
        AND p.clinic_id IN (${Prisma.join(clinicIds)})
        AND p.status = 'ACTIVE'
        AND p.received_at >= ${range.start}
        AND p.received_at < ${range.end}
      GROUP BY day, i.registration_id`),
  ]);
  // One ISSUED bill per visit (D1), so a day's bill count is its visit count and days add up exactly.
  const billed = new Map<string, Bucket>();
  for (const row of billedDays) {
    const key = bucketKeyForIndiaDay(period, row.day);
    const bucket = billed.get(key) ?? { amount: ZERO, visits: 0 };
    billed.set(key, { amount: bucket.amount.plus(money(row.amount)), visits: (bucket.visits as number) + count(row.visits) });
  }
  const collected = new Map<string, Bucket>();
  for (const row of collectedDays) {
    const key = bucketKeyForIndiaDay(period, row.day);
    const bucket = collected.get(key) ?? { amount: ZERO, visits: new Set<string>() };
    (bucket.visits as Set<string>).add(row.registrationId);
    collected.set(key, { amount: bucket.amount.plus(money(row.amount)), visits: bucket.visits });
  }
  return { billedSeries: toSeries(period, keys, billed), collectedSeries: toSeries(period, keys, collected) };
}

const EMPTY_KPIS: CollectionsKpis = { billed: "0.00", billCount: 0, previousBilled: "0.00", collected: "0.00", paymentCount: 0,
  previousCollected: "0.00", outstanding: "0.00", outstandingCount: 0, discounts: "0.00", cgst: "0.00", sgst: "0.00", gst: "0.00" };

/** FR-11.23 — the Billing section of /reports for one period. */
export async function getCollectionsReport(
  actor: ActorContext,
  filters: ReportFilters,
  now: Date = new Date(),
  permissions: readonly string[] = COLLECTIONS_VIEW_PERMISSIONS,
): Promise<CollectionsReport> {
  await requireModule(actor, MODULE_FEATURES.reports);
  await requireModule(actor, MODULE_FEATURES.billing);
  const period = filters.period ?? DEFAULT_PERIOD;
  const clinics = await resolveReportClinics(actor, filters.clinicId, permissions);
  const clinicIds = clinics.map((clinic) => clinic.id);
  const current = billingCurrentWindow(period, now);
  const seriesWindow = billingSeriesWindow(period, now);
  const keys = bucketKeysIn(period, seriesWindow.wallClock);
  const header = {
    period,
    rangeLabel: rangeLabel(period, current.wallClock),
    rangeStartDate: bucketKey(current.wallClock.start),
    asOf: now.toISOString(),
    clinicName: filters.clinicId && clinics.length === 1 ? clinics[0].name : null,
  };
  if (clinicIds.length === 0) {
    return { ...header, kpis: EMPTY_KPIS, billedSeries: toSeries(period, keys, new Map()), collectedSeries: toSeries(period, keys, new Map()),
      byPaymentMode: [], byClinic: [], hasClinics: false };
  }

  const tenantId = actor.tenantId;
  const previous = billingPreviousWindow(period, current);
  const [billedByClinic, collectedByClinicMode, outstandingByClinic, priorBilled, priorCollected, series] = await Promise.all([
    prisma.invoice.groupBy({ by: ["clinicId"], where: issuedIn(tenantId, clinicIds, current.instants),
      _sum: { grandTotal: true, discountTotal: true, cgstTotal: true, sgstTotal: true }, _count: { _all: true } }),
    prisma.invoicePayment.groupBy({ by: ["clinicId", "mode"], where: collectedIn(tenantId, clinicIds, current.instants),
      _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ["clinicId"], where: { tenantId, clinicId: { in: clinicIds }, status: "ISSUED", balanceDue: { gt: 0 } },
      _sum: { balanceDue: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: issuedIn(tenantId, clinicIds, previous.instants), _sum: { grandTotal: true } }),
    prisma.invoicePayment.aggregate({ where: collectedIn(tenantId, clinicIds, previous.instants), _sum: { amount: true } }),
    buildSeries(tenantId, clinicIds, period, seriesWindow.instants, keys),
  ]);

  const billedFor = new Map(billedByClinic.map((row) => [row.clinicId, row]));
  const outstandingFor = new Map(outstandingByClinic.map((row) => [row.clinicId, row]));
  const collectedTotal = sum(collectedByClinicMode.map((row) => money(row._sum.amount)));

  const byClinic: ClinicCollectionsRow[] = clinics.map((clinic) => {
    const billed = billedFor.get(clinic.id);
    const payments = collectedByClinicMode.filter((row) => row.clinicId === clinic.id);
    const collected = sum(payments.map((row) => money(row._sum.amount)));
    return { id: clinic.id, name: clinic.name, revenue: collected.toFixed(2),
      registrations: payments.reduce((total, row) => total + row._count._all, 0), sharePercent: share(collected, collectedTotal),
      billed: money(billed?._sum.grandTotal).toFixed(2), billCount: billed?._count._all ?? 0,
      outstanding: money(outstandingFor.get(clinic.id)?._sum.balanceDue).toFixed(2),
      discounts: money(billed?._sum.discountTotal).toFixed(2), cgst: money(billed?._sum.cgstTotal).toFixed(2), sgst: money(billed?._sum.sgstTotal).toFixed(2) };
  }).sort((a, b) => new Prisma.Decimal(b.revenue).comparedTo(a.revenue) || a.name.localeCompare(b.name));

  const modes = new Map<PaymentMode, { amount: Prisma.Decimal; payments: number }>();
  for (const row of collectedByClinicMode) {
    const entry = modes.get(row.mode) ?? { amount: ZERO, payments: 0 };
    modes.set(row.mode, { amount: entry.amount.plus(money(row._sum.amount)), payments: entry.payments + row._count._all });
  }
  const byPaymentMode: BreakdownRow[] = [...modes].map(([mode, entry]) => ({ id: mode, name: PAYMENT_MODE_LABELS[mode],
    revenue: entry.amount.toFixed(2), registrations: entry.payments, sharePercent: share(entry.amount, collectedTotal) }))
    .sort((a, b) => new Prisma.Decimal(b.revenue).comparedTo(a.revenue) || a.name.localeCompare(b.name));

  const cgst = sum(billedByClinic.map((row) => money(row._sum.cgstTotal)));
  const sgst = sum(billedByClinic.map((row) => money(row._sum.sgstTotal)));
  return {
    ...header,
    kpis: {
      billed: sum(billedByClinic.map((row) => money(row._sum.grandTotal))).toFixed(2),
      billCount: billedByClinic.reduce((total, row) => total + row._count._all, 0),
      previousBilled: money(priorBilled._sum.grandTotal).toFixed(2),
      collected: collectedTotal.toFixed(2),
      paymentCount: collectedByClinicMode.reduce((total, row) => total + row._count._all, 0),
      previousCollected: money(priorCollected._sum.amount).toFixed(2),
      outstanding: sum(outstandingByClinic.map((row) => money(row._sum.balanceDue))).toFixed(2),
      outstandingCount: outstandingByClinic.reduce((total, row) => total + row._count._all, 0),
      discounts: sum(billedByClinic.map((row) => money(row._sum.discountTotal))).toFixed(2),
      cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), gst: cgst.plus(sgst).toFixed(2),
    },
    ...series,
    byPaymentMode,
    byClinic,
    hasClinics: true,
  };
}

/** The same report for download: the identical query path, additionally intersected with `reports:export`. */
export async function getCollectionsReportForExport(actor: ActorContext, filters: ReportFilters, now: Date = new Date()) {
  return getCollectionsReport(actor, filters, now, COLLECTIONS_EXPORT_PERMISSIONS);
}
