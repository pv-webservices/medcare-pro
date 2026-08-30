import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessibleClinicScope, type ActorContext } from "@/lib/rbac";
import {
  bucketKeysInRange,
  bucketLabel,
  previousPeriod,
  type DateRange,
  type DashboardPreset,
  type TrendInterval,
} from "@/lib/dashboardDateRange";

/**
 * Dashboard aggregation for the tenant (Account Owner) dashboard.
 *
 * Read-only. Every query is scoped to the actor's tenant and the clinics they
 * can reach — see `resolveDashboardClinics`. The shapes mirror what the
 * dashboard page renders, so the component receives structured data rather than
 * running calculations.
 *
 * Revenue is defined the same way as in reports.ts: SUM(registration.amount)
 * over registrations whose visitDate falls within the selected range. Cancelled
 * appointments are excluded from appointment totals but are counted in
 * today's operational overview for visibility.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DashboardKpi {
  current: number;
  previous: number;
  change: number | null;
}

export interface DashboardSummary {
  revenue: DashboardKpi;
  registrations: DashboardKpi;
  appointments: DashboardKpi;
  activeDoctors: number;
}

export interface TrendPoint {
  key: string;
  label: string;
  revenue: number;
  registrations: number;
}

export interface ClinicPerformanceRow {
  clinicId: string;
  clinicName: string;
  revenue: number;
  registrations: number;
  appointments: number;
  doctors: number;
  revenueChange: number | null;
}

export interface DoctorPerformanceRow {
  doctorId: string | null;
  doctorName: string;
  clinicName: string;
  registrations: number;
  revenue: number;
}

export interface TodayOverview {
  appointments: number;
  registrations: number;
  completedAppointments: number;
  cancelledAppointments: number;
}

export interface AttentionItem {
  type: string;
  message: string;
  href?: string;
}

export interface ActivityRow {
  actor: string;
  action: string;
  subject: string;
  timestamp: Date;
}

export interface DashboardData {
  summary: DashboardSummary;
  trend: TrendPoint[];
  clinicPerformance: ClinicPerformanceRow[];
  doctorPerformance: DoctorPerformanceRow[];
  today: TodayOverview;
  attentionItems: AttentionItem[];
  recentActivity: ActivityRow[];
  clinicCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

const ACTIVE_APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "CONVERTED",
] as const;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

interface DashboardClinic {
  id: string;
  name: string;
}

async function resolveDashboardClinics(
  actor: ActorContext,
  selectedClinicId: string | null,
): Promise<DashboardClinic[]> {
  const access = await accessibleClinicScope(actor, "clinic:read");

  if (access.scope === "none") return [];

  const clinics = await prisma.clinic.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(access.scope === "clinics"
        ? { id: { in: [...access.clinicIds] } }
        : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!selectedClinicId) return clinics;
  return clinics.filter((c) => c.id === selectedClinicId);
}

// ---------------------------------------------------------------------------
// KPI aggregation
// ---------------------------------------------------------------------------

async function buildSummary(
  clinicIds: readonly string[],
  range: DateRange,
  prev: DateRange,
  tenantId: string,
): Promise<DashboardSummary> {
  if (clinicIds.length === 0) {
    return {
      revenue: { current: 0, previous: 0, change: null },
      registrations: { current: 0, previous: 0, change: null },
      appointments: { current: 0, previous: 0, change: null },
      activeDoctors: 0,
    };
  }

  const ids = [...clinicIds];

  const [
    curReg,
    prevReg,
    curAppt,
    prevAppt,
    activeDoctors,
  ] = await Promise.all([
    prisma.registration.aggregate({
      where: { clinicId: { in: ids }, visitDate: { gte: range.start, lt: range.end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.registration.aggregate({
      where: { clinicId: { in: ids }, visitDate: { gte: prev.start, lt: prev.end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.appointment.count({
      where: {
        tenantId,
        clinicId: { in: ids },
        slotStart: { gte: range.start, lt: range.end },
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      },
    }),
    prisma.appointment.count({
      where: {
        tenantId,
        clinicId: { in: ids },
        slotStart: { gte: prev.start, lt: prev.end },
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      },
    }),
    prisma.doctor.count({ where: { clinicId: { in: ids } } }),
  ]);

  const curRevenue = toNumber(curReg._sum.amount);
  const prevRevenue = toNumber(prevReg._sum.amount);
  const curRegCount = curReg._count._all;
  const prevRegCount = prevReg._count._all;

  return {
    revenue: {
      current: curRevenue,
      previous: prevRevenue,
      change: pctChange(curRevenue, prevRevenue),
    },
    registrations: {
      current: curRegCount,
      previous: prevRegCount,
      change: pctChange(curRegCount, prevRegCount),
    },
    appointments: {
      current: curAppt,
      previous: prevAppt,
      change: pctChange(curAppt, prevAppt),
    },
    activeDoctors,
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

interface TrendRow {
  bucket: string;
  revenue: unknown;
  registrations: unknown;
}

const BUCKET_SQL: Record<TrendInterval, Prisma.Sql> = {
  daily: Prisma.sql`DATE_FORMAT(visit_date, '%Y-%m-%d')`,
  monthly: Prisma.sql`DATE_FORMAT(visit_date, '%Y-%m-01')`,
};

async function buildTrend(
  clinicIds: readonly string[],
  range: DateRange,
  interval: TrendInterval,
): Promise<TrendPoint[]> {
  const keys = bucketKeysInRange(interval, range);

  const rows =
    clinicIds.length === 0
      ? []
      : await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
          SELECT ${BUCKET_SQL[interval]} AS bucket,
                 SUM(amount) AS revenue,
                 COUNT(*) AS registrations
          FROM registrations
          WHERE clinic_id IN (${Prisma.join([...clinicIds])})
            AND visit_date >= ${range.start}
            AND visit_date < ${range.end}
          GROUP BY bucket
        `);

  const byBucket = new Map(rows.map((r) => [r.bucket, r]));

  return keys.map((key) => {
    const row = byBucket.get(key);
    return {
      key,
      label: bucketLabel(interval, key),
      revenue: toNumber(row?.revenue),
      registrations: toNumber(row?.registrations),
    };
  });
}

// ---------------------------------------------------------------------------
// Clinic performance
// ---------------------------------------------------------------------------

async function buildClinicPerformance(
  clinics: readonly DashboardClinic[],
  range: DateRange,
  prev: DateRange,
  tenantId: string,
): Promise<ClinicPerformanceRow[]> {
  if (clinics.length <= 1) return [];

  const ids = clinics.map((c) => c.id);

  const [regByClinic, apptByClinic, docByClinic, prevRevByClinic] =
    await Promise.all([
      prisma.registration.groupBy({
        by: ["clinicId"],
        where: {
          clinicId: { in: ids },
          visitDate: { gte: range.start, lt: range.end },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ["clinicId"],
        where: {
          tenantId,
          clinicId: { in: ids },
          slotStart: { gte: range.start, lt: range.end },
          status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        },
        _count: { _all: true },
      }),
      prisma.doctor.groupBy({
        by: ["clinicId"],
        where: { clinicId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.registration.groupBy({
        by: ["clinicId"],
        where: {
          clinicId: { in: ids },
          visitDate: { gte: prev.start, lt: prev.end },
        },
        _sum: { amount: true },
      }),
    ]);

  const regMap = new Map(regByClinic.map((r) => [r.clinicId, r]));
  const apptMap = new Map(apptByClinic.map((r) => [r.clinicId, r]));
  const docMap = new Map(docByClinic.map((r) => [r.clinicId, r]));
  const prevMap = new Map(prevRevByClinic.map((r) => [r.clinicId, r]));

  return clinics
    .map((clinic) => {
      const rev = toNumber(regMap.get(clinic.id)?._sum.amount);
      const prevRev = toNumber(prevMap.get(clinic.id)?._sum.amount);

      return {
        clinicId: clinic.id,
        clinicName: clinic.name,
        revenue: rev,
        registrations: regMap.get(clinic.id)?._count._all ?? 0,
        appointments: apptMap.get(clinic.id)?._count._all ?? 0,
        doctors: docMap.get(clinic.id)?._count._all ?? 0,
        revenueChange: pctChange(rev, prevRev),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Doctor performance
// ---------------------------------------------------------------------------

async function buildDoctorPerformance(
  clinicIds: readonly string[],
  clinics: readonly DashboardClinic[],
  range: DateRange,
): Promise<DoctorPerformanceRow[]> {
  if (clinicIds.length === 0) return [];

  const grouped = await prisma.registration.groupBy({
    by: ["doctorId"],
    where: {
      clinicId: { in: [...clinicIds] },
      visitDate: { gte: range.start, lt: range.end },
      doctorId: { not: null },
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  const doctorIds = grouped
    .map((r) => r.doctorId)
    .filter((id): id is string => id !== null);

  if (doctorIds.length === 0) return [];

  const doctors = await prisma.doctor.findMany({
    where: { id: { in: doctorIds } },
    select: { id: true, name: true, clinicId: true },
  });

  const nameMap = new Map(doctors.map((d) => [d.id, d]));
  const clinicMap = new Map(clinics.map((c) => [c.id, c.name]));

  return grouped.map((row) => {
    const doc = row.doctorId ? nameMap.get(row.doctorId) : null;
    const count = typeof row._count === "number" ? row._count : 0;
    return {
      doctorId: row.doctorId,
      doctorName: doc?.name ?? "Unknown",
      clinicName: doc ? (clinicMap.get(doc.clinicId) ?? "Unknown") : "Unknown",
      registrations: count,
      revenue: toNumber(row._sum?.amount),
    };
  });
}

// ---------------------------------------------------------------------------
// Today's operational overview
// ---------------------------------------------------------------------------

async function buildTodayOverview(
  clinicIds: readonly string[],
  tenantId: string,
  now: Date,
): Promise<TodayOverview> {
  if (clinicIds.length === 0) {
    return {
      appointments: 0,
      registrations: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
    };
  }

  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const ids = [...clinicIds];

  const [apptTotal, apptConverted, apptCancelled, regToday] =
    await Promise.all([
      prisma.appointment.count({
        where: {
          tenantId,
          clinicId: { in: ids },
          slotStart: { gte: todayStart, lt: todayEnd },
        },
      }),
      prisma.appointment.count({
        where: {
          tenantId,
          clinicId: { in: ids },
          slotStart: { gte: todayStart, lt: todayEnd },
          status: "CONVERTED",
        },
      }),
      prisma.appointment.count({
        where: {
          tenantId,
          clinicId: { in: ids },
          slotStart: { gte: todayStart, lt: todayEnd },
          status: "CANCELLED",
        },
      }),
      prisma.registration.count({
        where: {
          clinicId: { in: ids },
          visitDate: { gte: todayStart, lt: todayEnd },
        },
      }),
    ]);

  return {
    appointments: apptTotal,
    registrations: regToday,
    completedAppointments: apptConverted,
    cancelledAppointments: apptCancelled,
  };
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

async function buildAttentionItems(
  clinics: readonly DashboardClinic[],
  range: DateRange,
  prev: DateRange,
  tenantId: string,
  now: Date,
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  if (clinics.length === 0) return items;

  const ids = clinics.map((c) => c.id);

  const [curByClinic, prevByClinic, onLeave, unread] = await Promise.all([
    prisma.registration.groupBy({
      by: ["clinicId"],
      where: {
        clinicId: { in: ids },
        visitDate: { gte: range.start, lt: range.end },
      },
      _sum: { amount: true },
    }),
    prisma.registration.groupBy({
      by: ["clinicId"],
      where: {
        clinicId: { in: ids },
        visitDate: { gte: prev.start, lt: prev.end },
      },
      _sum: { amount: true },
    }),
    prisma.doctorLeave.findMany({
      where: {
        doctor: { clinicId: { in: ids } },
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { doctor: { select: { name: true } } },
      take: 5,
    }),
    prisma.notification.count({
      where: { tenantId, read: false },
    }),
  ]);

  const curMap = new Map(
    curByClinic.map((r) => [r.clinicId, toNumber(r._sum.amount)]),
  );
  const prevMap = new Map(
    prevByClinic.map((r) => [r.clinicId, toNumber(r._sum.amount)]),
  );

  for (const clinic of clinics) {
    const cur = curMap.get(clinic.id) ?? 0;
    const prv = prevMap.get(clinic.id) ?? 0;
    if (prv > 0) {
      const decline = ((prv - cur) / prv) * 100;
      if (decline >= 15) {
        items.push({
          type: "revenue_decline",
          message: `Revenue for ${clinic.name} is down ${Math.round(decline)}% compared with the previous period.`,
          href: "/reports",
        });
      }
    }
  }

  for (const leave of onLeave) {
    items.push({
      type: "doctor_leave",
      message: `${leave.doctor.name} is currently on approved leave.`,
      href: "/doctors",
    });
  }

  if (unread > 0) {
    items.push({
      type: "notifications",
      message: `${unread} unread notification${unread === 1 ? "" : "s"} require${unread === 1 ? "s" : ""} attention.`,
      href: "/notifications",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

async function buildRecentActivity(
  clinicIds: readonly string[],
  tenantId: string,
): Promise<ActivityRow[]> {
  if (clinicIds.length === 0) return [];

  const ids = [...clinicIds];

  const [recentRegistrations, recentAppointments] = await Promise.all([
    prisma.registration.findMany({
      where: { clinicId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        createdAt: true,
        visitType: true,
        patient: { select: { name: true } },
        creator: { select: { name: true } },
      },
    }),
    prisma.appointment.findMany({
      where: { tenantId, clinicId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        createdAt: true,
        status: true,
        name: true,
        bookingSource: true,
        bookedBy: { select: { name: true } },
      },
    }),
  ]);

  const rows: ActivityRow[] = [];

  for (const reg of recentRegistrations) {
    rows.push({
      actor: reg.creator.name ?? "Staff",
      action:
        reg.visitType === "NEW"
          ? "created a registration for"
          : "recorded a follow-up for",
      subject: reg.patient.name,
      timestamp: reg.createdAt,
    });
  }

  for (const appt of recentAppointments) {
    const verb =
      appt.status === "CANCELLED"
        ? "cancelled appointment for"
        : appt.status === "CONVERTED"
          ? "completed appointment for"
          : "booked appointment for";
    rows.push({
      actor:
        appt.bookedBy?.name ??
        (appt.bookingSource === "PHONE_IVR" ? "Phone IVR" : "Staff"),
      action: verb,
      subject: appt.name,
      timestamp: appt.createdAt,
    });
  }

  return rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getAccountDashboardData(
  actor: ActorContext,
  selectedClinicId: string | null,
  preset: DashboardPreset,
  range: DateRange,
  interval: TrendInterval,
  now: Date = new Date(),
): Promise<DashboardData> {
  const clinics = await resolveDashboardClinics(actor, selectedClinicId);
  const clinicIds = clinics.map((c) => c.id);
  const prev = previousPeriod(range);

  const [summary, trend, clinicPerformance, doctorPerformance, today, attentionItems, recentActivity] =
    await Promise.all([
      buildSummary(clinicIds, range, prev, actor.tenantId),
      buildTrend(clinicIds, range, interval),
      buildClinicPerformance(clinics, range, prev, actor.tenantId),
      buildDoctorPerformance(clinicIds, clinics, range),
      buildTodayOverview(clinicIds, actor.tenantId, now),
      buildAttentionItems(clinics, range, prev, actor.tenantId, now),
      buildRecentActivity(clinicIds, actor.tenantId),
    ]);

  return {
    summary,
    trend,
    clinicPerformance,
    doctorPerformance,
    today,
    attentionItems,
    recentActivity,
    clinicCount: clinics.length,
  };
}
