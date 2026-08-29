import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  PermissionError,
  type ActorContext,
} from "@/lib/rbac";
import {
  bucketFullLabel,
  bucketKey,
  bucketKeysIn,
  bucketLabel,
  currentRange,
  previousRange,
  rangeLabel,
  REPORT_PERIODS,
  seriesRange,
  type DateRange,
  type ReportPeriod,
} from "@/lib/reportPeriods";

/**
 * Revenue reporting — PRD §6.6 (FR-6.1 … FR-6.4).
 *
 * Read-only: nothing here writes. The permission is `report:read`, which the
 * seeded Staff role deliberately does not hold — a receptionist records revenue
 * but does not get to see the clinic's totals.
 *
 * Scoping works differently here from the other modules, and deliberately so.
 * Elsewhere a clinic filter is folded into a Prisma `where`; a report has to
 * name every clinic it covers anyway (FR-6.4 breaks the total down by clinic),
 * so the accessible clinics are resolved up front and every query — including
 * the raw one — is constrained to that explicit id list. A clinic the actor
 * cannot reach can therefore never contribute a rupee to a total.
 */

export const reportFilterSchema = z.object({
  period: z.enum(REPORT_PERIODS).optional(),
  clinicId: z.string().trim().max(64).optional(),
});

export type ReportFilters = z.infer<typeof reportFilterSchema>;

export const DEFAULT_PERIOD: ReportPeriod = "monthly";

/**
 * The two gates on this module — Stage 7.
 *
 * `report:read` opens the report. `reports:export` opens the download, and is
 * checked IN ADDITION to the view gate rather than instead of it: an export is
 * the report in a file, so nobody should be able to obtain figures by
 * downloading them that they are refused on screen.
 *
 * The catalogue also lists `reports:view`. It is deliberately NOT accepted
 * here. Its entry in lib/permissions.ts tells anyone editing a role that
 * granting it alone opens nothing, and quietly making that untrue would hand
 * revenue figures to every custom role that had already ticked an inert box.
 */
export const REPORT_VIEW_PERMISSION = "report:read";
export const REPORT_EXPORT_PERMISSION = "reports:export";

export interface RevenueKpis {
  /** Exact decimal strings — never a float, which would drift on money. */
  totalRevenue: string;
  registrationCount: number;
  /** Distinct people seen, not visits — a follow-up is the same patient. */
  patientCount: number;
  averageRevenuePerPatient: string;
  previousRevenue: string;
  /** null when the previous period earned nothing: growth from zero is not a %. */
  revenueChangePercent: number | null;
}

export interface RevenuePoint {
  bucket: string;
  label: string;
  fullLabel: string;
  /** Exact, for display. */
  revenue: string;
  /** The same number as a float, for chart geometry only — never for display. */
  value: number;
  registrations: number;
}

export interface BreakdownRow {
  id: string | null;
  name: string;
  revenue: string;
  registrations: number;
  /** 0–100, share of the period's total revenue. */
  sharePercent: number;
}

export interface RevenueReport {
  period: ReportPeriod;
  rangeLabel: string;
  /**
   * First day of the reported window, `YYYY-MM-DD`. The label above is written
   * for a person ("August 2026"); this is for anything that has to sort or name
   * a file, which is why the export uses it rather than the download date.
   */
  rangeStartDate: string;
  kpis: RevenueKpis;
  series: RevenuePoint[];
  byClinic: BreakdownRow[];
  byDoctor: BreakdownRow[];
  /** Set when the switcher has narrowed the report to a single clinic. */
  clinicName: string | null;
  /** False when the actor can read reports but reaches no clinic. */
  hasClinics: boolean;
}

export interface DailyRevenueSnapshot {
  /** Exact decimal string, using the same definition as the Reports module. */
  totalRevenue: string;
  hasClinics: boolean;
}

// ---------------------------------------------------------------------------
// Value coercion
//
// `$queryRaw` hands back whatever the MySQL driver produced: SUM() over a
// DECIMAL column arrives as a Decimal or a string depending on driver version,
// and COUNT(*) arrives as a BigInt. Both are normalised here rather than at
// each call site.
// ---------------------------------------------------------------------------

function toDecimalString(value: unknown): string {
  if (value === null || value === undefined) {
    return "0.00";
  }

  if (value instanceof Prisma.Decimal) {
    return value.toFixed(2);
  }

  if (typeof value === "bigint") {
    return `${value}.00`;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function toCount(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Money divided by a count, to 2dp. Guards the empty-period divide-by-zero. */
function divideMoney(total: string, divisor: number): string {
  if (divisor <= 0) {
    return "0.00";
  }

  return (Number(total) / divisor).toFixed(2);
}

function percentageChange(current: string, previous: string): number | null {
  const before = Number(previous);

  // Growth from nothing is undefined, not "infinite" and not "100%".
  if (!Number.isFinite(before) || before === 0) {
    return null;
  }

  return ((Number(current) - before) / before) * 100;
}

function sharePercent(part: string, total: string): number {
  const whole = Number(total);
  return whole === 0 ? 0 : (Number(part) / whole) * 100;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

interface ReportClinic {
  id: string;
  name: string;
}

/**
 * The clinics the actor may exercise EVERY one of `permissions` in.
 *
 * Reports take a list rather than a single key because the export needs both
 * gates at once, and the answer is the intersection — a user assigned
 * `report:read` tenant-wide but `reports:export` only at the Riverside branch
 * may download Riverside's figures and no others. Anything looser would let a
 * clinic-scoped export grant fields the assignment never covered.
 *
 * Throws PermissionError (→ 403) for the first permission held nowhere, so the
 * refusal names the gate that actually stopped them.
 */
async function reportableClinics(
  actor: ActorContext,
  permissions: readonly string[],
): Promise<{ scope: "all" } | { scope: "clinics"; clinicIds: readonly string[] }> {
  let narrowed: readonly string[] | null = null;

  for (const permission of permissions) {
    const access = await accessibleClinicScope(actor, permission);

    if (access.scope === "none") {
      throw new PermissionError(permission);
    }

    if (access.scope === "all") {
      continue;
    }

    narrowed =
      narrowed === null
        ? access.clinicIds
        : narrowed.filter((id) => access.clinicIds.includes(id));
  }

  return narrowed === null ? { scope: "all" } : { scope: "clinics", clinicIds: narrowed };
}

/**
 * The clinics this report covers.
 *
 * Throws PermissionError (→ 403) when the actor holds a required gate nowhere —
 * that is a refusal, not an empty report. A *selected* clinic outside their
 * reach is different: that is a filter that matches nothing, and returns an
 * empty list so the page renders zeros rather than an error.
 */
async function resolveReportClinics(
  actor: ActorContext,
  selectedClinicId: string | null | undefined,
  permissions: readonly string[],
): Promise<ReportClinic[]> {
  const access = await reportableClinics(actor, permissions);

  const clinics = await prisma.clinic.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(access.scope === "clinics" ? { id: { in: [...access.clinicIds] } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!selectedClinicId) {
    return clinics;
  }

  return clinics.filter((clinic) => clinic.id === selectedClinicId);
}

function registrationsIn(
  clinicIds: readonly string[],
  range: DateRange,
): Prisma.RegistrationWhereInput {
  return {
    clinicId: { in: [...clinicIds] },
    visitDate: { gte: range.start, lt: range.end },
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Bucket expressions for the growth graph, one per granularity.
 *
 * These are SQL *expressions*, not bindable parameters, so they are composed as
 * `Prisma.Sql` fragments from this fixed map — the period arrives validated
 * against REPORT_PERIODS, and no request value is ever interpolated into SQL.
 *
 * Raw SQL is used here on purpose. Grouping by a truncated date is the one
 * thing Prisma's query API cannot express, and the alternatives are worse: one
 * aggregate per bucket is up to fourteen round trips, and pulling every row
 * back to bucket in JavaScript is unbounded — five years of visits for a busy
 * clinic is a lot of rows to move to count them.
 *
 * Every branch returns 'YYYY-MM-DD' so the bucket key is one type, whichever
 * granularity produced it.
 */
const BUCKET_EXPRESSION: Record<ReportPeriod, Prisma.Sql> = {
  daily: Prisma.sql`DATE_FORMAT(visit_date, '%Y-%m-%d')`,
  weekly: Prisma.sql`DATE_FORMAT(DATE_SUB(DATE(visit_date), INTERVAL WEEKDAY(visit_date) DAY), '%Y-%m-%d')`,
  monthly: Prisma.sql`DATE_FORMAT(visit_date, '%Y-%m-01')`,
  yearly: Prisma.sql`DATE_FORMAT(visit_date, '%Y-01-01')`,
};

interface SeriesRow {
  bucket: string;
  revenue: unknown;
  registrations: unknown;
}

/** FR-6.3 — revenue per bucket across the graph's window, zero-filled. */
async function buildSeries(
  period: ReportPeriod,
  clinicIds: readonly string[],
  range: DateRange,
): Promise<RevenuePoint[]> {
  const keys = bucketKeysIn(period, range);

  const rows =
    clinicIds.length === 0
      ? []
      : await prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
          SELECT ${BUCKET_EXPRESSION[period]} AS bucket,
                 SUM(amount) AS revenue,
                 COUNT(*) AS registrations
          FROM registrations
          WHERE clinic_id IN (${Prisma.join([...clinicIds])})
            AND visit_date >= ${range.start}
            AND visit_date < ${range.end}
          GROUP BY bucket
        `);

  const byBucket = new Map(rows.map((row) => [row.bucket, row]));

  return keys.map((key) => {
    const row = byBucket.get(key);
    const revenue = toDecimalString(row?.revenue);

    return {
      bucket: key,
      label: bucketLabel(period, key),
      fullLabel: bucketFullLabel(period, key),
      revenue,
      value: Number(revenue),
      registrations: toCount(row?.registrations),
    };
  });
}

/** FR-6.4 — the period's revenue split by clinic. */
async function buildClinicBreakdown(
  clinics: readonly ReportClinic[],
  range: DateRange,
  total: string,
): Promise<BreakdownRow[]> {
  const grouped = await prisma.registration.groupBy({
    by: ["clinicId"],
    where: registrationsIn(
      clinics.map((clinic) => clinic.id),
      range,
    ),
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byClinic = new Map(grouped.map((row) => [row.clinicId, row]));

  return clinics
    .map((clinic) => {
      const row = byClinic.get(clinic.id);
      const revenue = toDecimalString(row?._sum.amount);

      return {
        id: clinic.id,
        name: clinic.name,
        revenue,
        registrations: row?._count._all ?? 0,
        sharePercent: sharePercent(revenue, total),
      };
    })
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
}

/** FR-6.4 — the period's revenue split by doctor. */
async function buildDoctorBreakdown(
  clinicIds: readonly string[],
  range: DateRange,
  total: string,
): Promise<BreakdownRow[]> {
  const grouped = await prisma.registration.groupBy({
    by: ["doctorId"],
    where: registrationsIn(clinicIds, range),
    _sum: { amount: true },
    _count: { _all: true },
  });

  const doctorIds = grouped
    .map((row) => row.doctorId)
    .filter((id): id is string => id !== null);

  // Named in a second query rather than through a join: groupBy cannot select
  // a relation field, and this is one extra round trip for the whole table.
  const doctors =
    doctorIds.length === 0
      ? []
      : await prisma.doctor.findMany({
          where: { id: { in: doctorIds } },
          select: { id: true, name: true },
        });

  const names = new Map(doctors.map((doctor) => [doctor.id, doctor.name]));

  return grouped
    .map((row) => {
      const revenue = toDecimalString(row._sum.amount);

      return {
        id: row.doctorId,
        // FR-3.1 leaves the doctor optional, so a walk-in with nobody assigned
        // still has to appear — dropping it would make the column undercount
        // the total it is supposed to break down.
        name: row.doctorId ? (names.get(row.doctorId) ?? "Unknown") : "Not assigned",
        revenue,
        registrations: row._count._all,
        sharePercent: sharePercent(revenue, total),
      };
    })
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const EMPTY_KPIS: RevenueKpis = {
  totalRevenue: "0.00",
  registrationCount: 0,
  patientCount: 0,
  averageRevenuePerPatient: "0.00",
  previousRevenue: "0.00",
  revenueChangePercent: null,
};

/** FR-6.1 … FR-6.4 — the whole report for one period. */
export async function getRevenueReport(
  actor: ActorContext,
  filters: ReportFilters,
  now: Date = new Date(),
  permissions: readonly string[] = [REPORT_VIEW_PERMISSION],
): Promise<RevenueReport> {
  const period = filters.period ?? DEFAULT_PERIOD;
  const clinics = await resolveReportClinics(actor, filters.clinicId, permissions);
  const clinicIds = clinics.map((clinic) => clinic.id);

  const range = currentRange(period, now);
  const clinicName =
    filters.clinicId && clinics.length === 1 ? clinics[0].name : null;

  if (clinicIds.length === 0) {
    return {
      period,
      rangeLabel: rangeLabel(period, range),
      rangeStartDate: bucketKey(range.start),
      kpis: EMPTY_KPIS,
      series: bucketKeysIn(period, seriesRange(period, now)).map((key) => ({
        bucket: key,
        label: bucketLabel(period, key),
        fullLabel: bucketFullLabel(period, key),
        revenue: "0.00",
        value: 0,
        registrations: 0,
      })),
      byClinic: [],
      byDoctor: [],
      clinicName,
      hasClinics: false,
    };
  }

  const previous = previousRange(period, range);

  const [current, prior, patientCount, series] = await Promise.all([
    prisma.registration.aggregate({
      where: registrationsIn(clinicIds, range),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.registration.aggregate({
      where: registrationsIn(clinicIds, previous),
      _sum: { amount: true },
    }),
    // FR-6.2's "average revenue per patient" is per person, not per visit —
    // counted here as distinct patients with a visit in the window, so a
    // follow-up does not inflate the denominator.
    prisma.patient.count({
      where: { registrations: { some: registrationsIn(clinicIds, range) } },
    }),
    buildSeries(period, clinicIds, seriesRange(period, now)),
  ]);

  const totalRevenue = toDecimalString(current._sum.amount);
  const previousRevenue = toDecimalString(prior._sum.amount);

  const [byClinic, byDoctor] = await Promise.all([
    buildClinicBreakdown(clinics, range, totalRevenue),
    buildDoctorBreakdown(clinicIds, range, totalRevenue),
  ]);

  return {
    period,
    rangeLabel: rangeLabel(period, range),
    rangeStartDate: bucketKey(range.start),
    kpis: {
      totalRevenue,
      registrationCount: current._count._all,
      patientCount,
      averageRevenuePerPatient: divideMoney(totalRevenue, patientCount),
      previousRevenue,
      revenueChangePercent: percentageChange(totalRevenue, previousRevenue),
    },
    series,
    byClinic,
    byDoctor,
    clinicName,
    hasClinics: true,
  };
}

/**
 * The dashboard's deliberately small financial view.
 *
 * This follows the exact same scope resolver, date window, registration filter
 * and Decimal normalisation as `getRevenueReport`. Keeping this focused avoids
 * building clinic/doctor breakdowns and a historical series merely to render
 * one operational KPI, while guaranteeing that Reports and Dashboard cannot
 * disagree about what a rupee of revenue means.
 */
export async function getDailyRevenueSnapshot(
  actor: ActorContext,
  selectedClinicId: string | null | undefined,
  date: Date,
): Promise<DailyRevenueSnapshot> {
  const clinics = await resolveReportClinics(actor, selectedClinicId, [
    REPORT_VIEW_PERMISSION,
  ]);
  const clinicIds = clinics.map((clinic) => clinic.id);

  return getDailyRevenueSnapshotForClinicIds(actor, clinicIds, date);
}

/**
 * Dashboard-only entry point after its own `dashboard:revenue:view` scope has
 * already been resolved server-side. Keeping this separate prevents
 * `report:read` from becoming the dashboard card's source of truth.
 */
export async function getDailyRevenueSnapshotForClinicIds(
  actor: ActorContext,
  clinicIds: readonly string[],
  date: Date,
): Promise<DailyRevenueSnapshot> {
  if (clinicIds.length === 0) {
    return { totalRevenue: "0.00", hasClinics: false };
  }

  const range = currentRange("daily", date);
  const aggregate = await prisma.registration.aggregate({
    where: {
      ...registrationsIn(clinicIds, range),
      clinic: { tenantId: actor.tenantId },
    },
    _sum: { amount: true },
  });

  return {
    totalRevenue: toDecimalString(aggregate._sum.amount),
    hasClinics: true,
  };
}

/**
 * The same report, for download — Stage 7.
 *
 * A thin wrapper on purpose: the export must never be able to show a figure the
 * screen would not, so it runs the identical query path and differs only in
 * demanding `reports:export` on top of the view gate.
 */
export async function getRevenueReportForExport(
  actor: ActorContext,
  filters: ReportFilters,
  now: Date = new Date(),
): Promise<RevenueReport> {
  return getRevenueReport(actor, filters, now, [
    REPORT_VIEW_PERMISSION,
    REPORT_EXPORT_PERMISSION,
  ]);
}
