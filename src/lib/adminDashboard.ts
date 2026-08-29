import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_DASHBOARD_ACTION_PERMISSIONS as ACTION_PERMISSIONS,
  ADMIN_DASHBOARD_DATA_PERMISSIONS as DATA_PERMISSIONS,
  resolveAdminDashboardClinicAccess,
  type AdminDashboardActionPermission,
  type AdminDashboardDataPermission,
} from "@/lib/adminDashboardScope";
import {
  bucketKeysInRange,
  bucketLabel,
  presetRange,
  percentChange,
  previousPeriod,
  trendInterval,
  type DashboardPreset,
  type DateRange,
  type TrendInterval,
} from "@/lib/dashboardDateRange";
import { dashboardBucketSql } from "@/lib/dashboardTrend";
import {
  dashboardDataGroupsForWidgetIds,
  type DashboardWidgetDataGroup,
  type DashboardWidgetId,
} from "@/lib/dashboardWidgets";
import { formatClockTime } from "@/lib/dates";
import { resolveModulesForActor } from "@/lib/features";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/appointmentRules";
import { accessibleClinicScopes, type ActorContext } from "@/lib/rbac";

export interface DashboardCapabilities {
  dashboard: {
    view: boolean;
    patients: boolean;
    appointments: boolean;
    revenue: boolean;
    doctors: boolean;
    messages: boolean;
    tasks: boolean;
    schedule: boolean;
    activity: boolean;
    team: boolean;
    clinics: boolean;
  };
  actions: {
    canBookAppointment: boolean;
    canCreateRegistration: boolean;
    canAddDoctor: boolean;
    canManageTeam: boolean;
    canManageRoles: boolean;
    canCreateTask: boolean;
  };
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  value: number;
}

export interface AdminDashboardData {
  userName: string;
  period: DashboardPreset;
  rangeLabel: string;
  comparisonLabel: string;
  scope: {
    selectedClinicId: string | null;
    clinicIds: string[];
    clinicName: string | null;
    clinicCount: number;
  };
  capabilities: DashboardCapabilities;
  summary: {
    totalPatients?: number;
    todaysAppointments?: number;
    todaysCollection?: number;
    monthRevenue?: number;
    activeDoctors?: number;
    pendingTasks?: number;
    overdueTasks?: number;
    messageHealth?: number | null;
    patientChange?: number | null;
    appointmentChange?: number | null;
    revenueChange?: number | null;
  };
  patients?: {
    total: number;
    new: number;
    returning: number;
    followUps: number;
    change: number | null;
    trend: DashboardTrendPoint[];
    recent: Array<{
      id: string;
      patientName: string;
      clinicName: string;
      visitType: string;
      occurredAt: Date;
    }>;
  };
  appointments?: {
    today: number;
    upcoming: number;
    total: number;
    byStatus: Record<AppointmentStatus, number>;
    change: number | null;
    trend: DashboardTrendPoint[];
  };
  schedule?: Array<{
    id: string;
    time: string;
    patientName: string;
    doctorName: string;
    appointmentType: string;
    clinicName: string;
    status: AppointmentStatus;
  }>;
  revenue?: {
    current: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
    previousMonth: number;
    averagePerVisit: number;
    change: number | null;
    trend: DashboardTrendPoint[];
    byDoctor: Array<{
      doctorId: string;
      doctorName: string;
      patients: number;
      revenue: number;
    }>;
  };
  doctors?: {
    active: number;
    availableToday: number;
    onLeave: number;
    performance: Array<{
      doctorId: string;
      doctorName: string;
      clinicName: string;
      appointments: number;
      patients: number;
      revenue?: number;
    }>;
  };
  messages?: {
    total: number;
    accepted: number;
    pending: number;
    failed: number;
    acceptanceRate: number | null;
  };
  tasks?: {
    myPending: number;
    teamPending?: number;
    dueToday: number;
    overdue: number;
    completedToday: number;
  };
  clinicPerformance?: Array<{
    clinicId: string;
    clinicName: string;
    patients?: number;
    appointments?: number;
    doctors?: number;
    revenue?: number;
  }>;
  recentActivity?: Array<{
    id: string;
    type: "PATIENT_REGISTERED" | "APPOINTMENT_CREATED" | "APPOINTMENT_UPDATED";
    patientName: string;
    description: string;
    clinicName: string;
    occurredAt: Date;
  }>;
}

const DAY_MS = 86_400_000;
const OPEN_TASK_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcWeek(now: Date): Date {
  const day = startOfUtcDay(now);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

function startOfUtcMonth(now: Date, offset = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

function moduleAllowed(
  modules: Awaited<ReturnType<typeof resolveModulesForActor>>,
  feature: string,
): boolean {
  return modules.get(feature)?.allowed === true;
}

function emptyStatusCounts(): Record<AppointmentStatus, number> {
  return Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, 0])) as Record<AppointmentStatus, number>;
}

function dateRangeLabel(range: DateRange): string {
  const end = new Date(range.end.getTime() - DAY_MS);
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: range.start.getUTCFullYear() !== end.getUTCFullYear() ? "numeric" : undefined,
    timeZone: "UTC",
  });
  const startLabel = formatter.format(range.start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

interface RawTrendRow { bucket: string; value: unknown }

async function loadOptionalTrendRows(
  widget: "patients" | "appointments" | "revenue",
  actor: ActorContext,
  query: Promise<RawTrendRow[]>,
): Promise<RawTrendRow[]> {
  try {
    return await query;
  } catch (error) {
    // A chart is secondary to its KPI counts. Keep the rest of the authorised
    // dashboard usable if one aggregate expression is incompatible with the
    // database, while leaving a scoped diagnostic in server logs.
    console.error(`Dashboard ${widget} trend query failed`, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      error,
    });
    return [];
  }
}

function zeroFillTrend(
  rows: readonly RawTrendRow[],
  range: DateRange,
  interval: TrendInterval,
): DashboardTrendPoint[] {
  const values = new Map(rows.map((row) => [row.bucket, toNumber(row.value)]));
  return bucketKeysInRange(interval, range).map((date) => ({
    date,
    label: bucketLabel(interval, date),
    value: values.get(date) ?? 0,
  }));
}

async function loadPatientDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  range: DateRange,
  previous: DateRange,
  interval: TrendInterval,
): Promise<NonNullable<AdminDashboardData["patients"]>> {
  const ids = [...clinicIds];
  const patientWhere: Prisma.PatientWhereInput = {
    tenantId: actor.tenantId,
    clinicId: { in: ids },
  };
  const registrationWhere: Prisma.RegistrationWhereInput = {
    clinicId: { in: ids },
    clinic: { tenantId: actor.tenantId },
    visitDate: { gte: range.start, lt: range.end },
  };
  const [total, currentNew, previousNew, visits, recent, trendRows] = await Promise.all([
    prisma.patient.count({ where: patientWhere }),
    prisma.patient.count({ where: { ...patientWhere, createdAt: { gte: range.start, lt: range.end } } }),
    prisma.patient.count({ where: { ...patientWhere, createdAt: { gte: previous.start, lt: previous.end } } }),
    prisma.registration.groupBy({ by: ["visitType"], where: registrationWhere, _count: { _all: true } }),
    prisma.registration.findMany({
      where: registrationWhere,
      orderBy: [{ visitDate: "desc" }, { id: "desc" }],
      take: 8,
      select: { id: true, visitType: true, visitDate: true, patient: { select: { name: true } }, clinic: { select: { name: true } } },
    }),
    loadOptionalTrendRows("patients", actor, prisma.$queryRaw<RawTrendRow[]>(Prisma.sql`
      SELECT ${dashboardBucketSql("patients", interval)} AS bucket, COUNT(*) AS value
      FROM patients p
      INNER JOIN clinics c ON c.id = p.clinic_id
      WHERE p.clinic_id IN (${Prisma.join(ids)})
        AND c.tenant_id = ${actor.tenantId}
        AND p.created_at >= ${range.start} AND p.created_at < ${range.end}
      GROUP BY bucket
    `)),
  ]);
  const byType = new Map(visits.map((row) => [row.visitType, row._count._all]));
  return {
    total,
    new: currentNew,
    returning: byType.get("FOLLOW_UP") ?? 0,
    followUps: byType.get("FOLLOW_UP") ?? 0,
    change: percentChange(currentNew, previousNew),
    trend: zeroFillTrend(trendRows, range, interval),
    recent: recent.map((row) => ({
      id: row.id,
      patientName: row.patient.name,
      clinicName: row.clinic.name,
      visitType: row.visitType,
      occurredAt: row.visitDate,
    })),
  };
}

async function loadAppointmentDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  range: DateRange,
  previous: DateRange,
  interval: TrendInterval,
  now: Date,
): Promise<NonNullable<AdminDashboardData["appointments"]>> {
  const ids = [...clinicIds];
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const base: Prisma.AppointmentWhereInput = { tenantId: actor.tenantId, clinicId: { in: ids } };
  const currentWhere: Prisma.AppointmentWhereInput = { ...base, slotStart: { gte: range.start, lt: range.end } };
  const [grouped, previousTotal, todayCount, upcoming, trendRows] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: currentWhere, _count: { _all: true } }),
    prisma.appointment.count({ where: { ...base, slotStart: { gte: previous.start, lt: previous.end }, status: { not: "RESCHEDULED" } } }),
    prisma.appointment.count({ where: { ...base, slotStart: { gte: today, lt: tomorrow }, status: { not: "RESCHEDULED" } } }),
    prisma.appointment.count({ where: { ...base, slotStart: { gte: now }, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] } } }),
    loadOptionalTrendRows("appointments", actor, prisma.$queryRaw<RawTrendRow[]>(Prisma.sql`
      SELECT ${dashboardBucketSql("appointments", interval)} AS bucket, COUNT(*) AS value
      FROM appointments a
      WHERE a.tenant_id = ${actor.tenantId}
        AND a.clinic_id IN (${Prisma.join(ids)})
        AND a.slot_start >= ${range.start} AND a.slot_start < ${range.end}
        AND a.status <> 'RESCHEDULED'
      GROUP BY bucket
    `)),
  ]);
  const byStatus = emptyStatusCounts();
  for (const row of grouped) byStatus[row.status] = row._count._all;
  const total = APPOINTMENT_STATUSES.filter((status) => status !== "RESCHEDULED").reduce((sum, status) => sum + byStatus[status], 0);
  return {
    today: todayCount,
    upcoming,
    total,
    byStatus,
    change: percentChange(total, previousTotal),
    trend: zeroFillTrend(trendRows, range, interval),
  };
}

async function loadTodaySchedule(
  actor: ActorContext,
  clinicIds: readonly string[],
  now: Date,
): Promise<NonNullable<AdminDashboardData["schedule"]>> {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const rows = await prisma.appointment.findMany({
    where: {
      tenantId: actor.tenantId,
      clinicId: { in: [...clinicIds] },
      slotStart: { gte: now > today ? now : today, lt: tomorrow },
      status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] },
    },
    orderBy: [{ slotStart: "asc" }, { id: "asc" }],
    take: 10,
    select: {
      id: true, name: true, slotStart: true, status: true,
      doctor: { select: { name: true } },
      clinic: { select: { name: true } },
      appointmentType: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    time: formatClockTime(row.slotStart),
    patientName: row.name,
    doctorName: row.doctor.name,
    appointmentType: row.appointmentType.name,
    clinicName: row.clinic.name,
    status: row.status,
  }));
}

async function loadRevenueDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  range: DateRange,
  previous: DateRange,
  interval: TrendInterval,
  now: Date,
): Promise<NonNullable<AdminDashboardData["revenue"]>> {
  const ids = [...clinicIds];
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const week = startOfUtcWeek(now);
  const month = startOfUtcMonth(now);
  const nextMonth = startOfUtcMonth(now, 1);
  const previousMonth = startOfUtcMonth(now, -1);
  const whereFor = (start: Date, end: Date): Prisma.RegistrationWhereInput => ({
    clinicId: { in: ids }, clinic: { tenantId: actor.tenantId }, visitDate: { gte: start, lt: end },
  });
  const [current, prior, todayAgg, weekAgg, monthAgg, previousMonthAgg, trendRows, doctorGroups] = await Promise.all([
    prisma.registration.aggregate({ where: whereFor(range.start, range.end), _sum: { amount: true }, _count: { _all: true } }),
    prisma.registration.aggregate({ where: whereFor(previous.start, previous.end), _sum: { amount: true } }),
    prisma.registration.aggregate({ where: whereFor(today, tomorrow), _sum: { amount: true } }),
    prisma.registration.aggregate({ where: whereFor(week, tomorrow), _sum: { amount: true } }),
    prisma.registration.aggregate({ where: whereFor(month, nextMonth), _sum: { amount: true } }),
    prisma.registration.aggregate({ where: whereFor(previousMonth, month), _sum: { amount: true } }),
    loadOptionalTrendRows("revenue", actor, prisma.$queryRaw<RawTrendRow[]>(Prisma.sql`
      SELECT ${dashboardBucketSql("registrations", interval)} AS bucket, SUM(r.amount) AS value
      FROM registrations r
      INNER JOIN clinics c ON c.id = r.clinic_id
      WHERE r.clinic_id IN (${Prisma.join(ids)})
        AND c.tenant_id = ${actor.tenantId}
        AND r.visit_date >= ${range.start} AND r.visit_date < ${range.end}
      GROUP BY bucket
    `)),
    prisma.registration.groupBy({
      by: ["doctorId"], where: { ...whereFor(range.start, range.end), doctorId: { not: null } },
      _sum: { amount: true }, _count: { _all: true }, orderBy: { _sum: { amount: "desc" } }, take: 6,
    }),
  ]);
  const doctorIds = doctorGroups.map((row) => row.doctorId).filter((id): id is string => id !== null);
  const doctorNames = doctorIds.length === 0 ? [] : await prisma.doctor.findMany({
    where: { id: { in: doctorIds }, clinic: { tenantId: actor.tenantId, id: { in: ids } } }, select: { id: true, name: true },
  });
  const names = new Map(doctorNames.map((doctor) => [doctor.id, doctor.name]));
  const currentValue = toNumber(current._sum.amount);
  return {
    current: currentValue,
    today: toNumber(todayAgg._sum.amount),
    thisWeek: toNumber(weekAgg._sum.amount),
    thisMonth: toNumber(monthAgg._sum.amount),
    previousMonth: toNumber(previousMonthAgg._sum.amount),
    averagePerVisit: current._count._all === 0 ? 0 : currentValue / current._count._all,
    change: percentChange(currentValue, toNumber(prior._sum.amount)),
    trend: zeroFillTrend(trendRows, range, interval),
    byDoctor: doctorGroups.flatMap((row) => row.doctorId && names.has(row.doctorId) ? [{
      doctorId: row.doctorId,
      doctorName: names.get(row.doctorId)!,
      patients: row._count._all,
      revenue: toNumber(row._sum.amount),
    }] : []),
  };
}

async function loadDoctorDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  range: DateRange,
  now: Date,
  revenueByDoctor: ReadonlyMap<string, number>,
): Promise<NonNullable<AdminDashboardData["doctors"]>> {
  const ids = [...clinicIds];
  const today = startOfUtcDay(now);
  const [doctors, availability, leave, appointments, patients] = await Promise.all([
    prisma.doctor.findMany({ where: { clinicId: { in: ids }, clinic: { tenantId: actor.tenantId } }, select: { id: true, name: true, clinic: { select: { name: true } } } }),
    prisma.doctorAvailability.findMany({ where: { date: today, doctor: { clinicId: { in: ids }, clinic: { tenantId: actor.tenantId } } }, distinct: ["doctorId"], select: { doctorId: true } }),
    prisma.doctorLeave.findMany({ where: { startDate: { lte: today }, endDate: { gte: today }, doctor: { clinicId: { in: ids }, clinic: { tenantId: actor.tenantId } } }, distinct: ["doctorId"], select: { doctorId: true } }),
    prisma.appointment.groupBy({ by: ["doctorId"], where: { tenantId: actor.tenantId, clinicId: { in: ids }, slotStart: { gte: range.start, lt: range.end }, status: { not: "RESCHEDULED" } }, _count: { _all: true } }),
    prisma.registration.groupBy({ by: ["doctorId"], where: { clinicId: { in: ids }, clinic: { tenantId: actor.tenantId }, visitDate: { gte: range.start, lt: range.end }, doctorId: { not: null } }, _count: { _all: true } }),
  ]);
  const availableIds = new Set(availability.map((row) => row.doctorId));
  const leaveIds = new Set(leave.map((row) => row.doctorId));
  const appointmentsByDoctor = new Map(appointments.map((row) => [row.doctorId, row._count._all]));
  const patientsByDoctor = new Map(patients.flatMap((row) => row.doctorId ? [[row.doctorId, row._count._all] as const] : []));
  const performance = doctors.map((doctor) => ({
    doctorId: doctor.id,
    doctorName: doctor.name,
    clinicName: doctor.clinic.name,
    appointments: appointmentsByDoctor.get(doctor.id) ?? 0,
    patients: patientsByDoctor.get(doctor.id) ?? 0,
    ...(revenueByDoctor.has(doctor.id) ? { revenue: revenueByDoctor.get(doctor.id) } : {}),
  })).sort((a, b) => b.appointments - a.appointments || b.patients - a.patients).slice(0, 8);
  return {
    active: doctors.length,
    availableToday: [...availableIds].filter((id) => !leaveIds.has(id)).length,
    onLeave: leaveIds.size,
    performance,
  };
}

async function loadMessageDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  now: Date,
): Promise<NonNullable<AdminDashboardData["messages"]>> {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const grouped = await prisma.whatsappMessage.groupBy({
    by: ["status"],
    where: { clinicId: { in: [...clinicIds] }, clinic: { tenantId: actor.tenantId }, sentAt: { gte: today, lt: tomorrow } },
    _count: { _all: true },
  });
  let accepted = 0, failed = 0, pending = 0;
  for (const row of grouped) {
    const status = row.status.toLowerCase();
    if (status === "sent" || status === "accepted") accepted += row._count._all;
    else if (status === "failed") failed += row._count._all;
    else pending += row._count._all;
  }
  const total = accepted + failed + pending;
  return { total, accepted, failed, pending, acceptanceRate: total === 0 ? null : accepted / total * 100 };
}

async function loadTaskDashboardStats(
  actor: ActorContext,
  clinicIds: readonly string[],
  teamClinicIds: readonly string[],
  now: Date,
): Promise<NonNullable<AdminDashboardData["tasks"]>> {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const base: Prisma.TaskWhereInput = { tenantId: actor.tenantId, clinicId: { in: [...clinicIds] }, archivedAt: null };
  const mine: Prisma.TaskWhereInput = { ...base, assignedToId: actor.userId };
  const [myPending, dueToday, overdue, completedToday, teamPending] = await Promise.all([
    prisma.task.count({ where: { ...mine, status: { in: [...OPEN_TASK_STATUSES] } } }),
    prisma.task.count({ where: { ...mine, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { gte: today, lt: tomorrow } } }),
    prisma.task.count({ where: { ...mine, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: now } } }),
    prisma.task.count({ where: { ...mine, status: "COMPLETED", completedAt: { gte: today, lt: tomorrow } } }),
    teamClinicIds.length > 0 ? prisma.task.count({ where: { tenantId: actor.tenantId, clinicId: { in: [...teamClinicIds] }, archivedAt: null, status: { in: [...OPEN_TASK_STATUSES] } } }) : Promise.resolve(undefined),
  ]);
  return { myPending, dueToday, overdue, completedToday, ...(teamPending === undefined ? {} : { teamPending }) };
}

async function loadRecentPatientActivity(
  actor: ActorContext,
  clinicIds: readonly string[],
): Promise<NonNullable<AdminDashboardData["recentActivity"]>> {
  const ids = [...clinicIds];
  const [registrations, appointments] = await Promise.all([
    prisma.registration.findMany({
      where: { clinicId: { in: ids }, clinic: { tenantId: actor.tenantId } }, orderBy: { createdAt: "desc" }, take: 8,
      select: { id: true, createdAt: true, visitType: true, patient: { select: { name: true } }, clinic: { select: { name: true } } },
    }),
    prisma.appointment.findMany({
      where: { tenantId: actor.tenantId, clinicId: { in: ids } }, orderBy: { updatedAt: "desc" }, take: 8,
      select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, clinic: { select: { name: true } } },
    }),
  ]);
  return [
    ...registrations.map((row) => ({
      id: `registration-${row.id}`,
      type: "PATIENT_REGISTERED" as const,
      patientName: row.patient.name,
      description: row.visitType === "FOLLOW_UP" ? "Follow-up registration recorded" : "Patient registered",
      clinicName: row.clinic.name,
      occurredAt: row.createdAt,
    })),
    ...appointments.map((row) => ({
      id: `appointment-${row.id}`,
      type: (row.updatedAt.getTime() > row.createdAt.getTime() ? "APPOINTMENT_UPDATED" : "APPOINTMENT_CREATED") as "APPOINTMENT_UPDATED" | "APPOINTMENT_CREATED",
      patientName: row.name,
      description: row.updatedAt.getTime() > row.createdAt.getTime() ? `Appointment ${row.status.toLowerCase().replaceAll("_", " ")}` : "Appointment created",
      clinicName: row.clinic.name,
      occurredAt: row.updatedAt,
    })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 10);
}

async function loadClinicPerformance(
  actor: ActorContext,
  clinics: readonly { id: string; name: string }[],
  range: DateRange,
  metricIds: {
    patients: readonly string[];
    appointments: readonly string[];
    doctors: readonly string[];
    revenue: readonly string[];
  },
): Promise<NonNullable<AdminDashboardData["clinicPerformance"]>> {
  if (clinics.length <= 1) return [];
  const allowed = new Set(clinics.map((clinic) => clinic.id));
  const within = (ids: readonly string[]) => ids.filter((id) => allowed.has(id));
  const patientIds = within(metricIds.patients), appointmentIds = within(metricIds.appointments);
  const doctorIds = within(metricIds.doctors), revenueIds = within(metricIds.revenue);
  const [patients, appointments, doctors, revenue] = await Promise.all([
    patientIds.length ? prisma.patient.groupBy({ by: ["clinicId"], where: { tenantId: actor.tenantId, clinicId: { in: patientIds } }, _count: { _all: true } }) : Promise.resolve([]),
    appointmentIds.length ? prisma.appointment.groupBy({ by: ["clinicId"], where: { tenantId: actor.tenantId, clinicId: { in: appointmentIds }, slotStart: { gte: range.start, lt: range.end }, status: { not: "RESCHEDULED" } }, _count: { _all: true } }) : Promise.resolve([]),
    doctorIds.length ? prisma.doctor.groupBy({ by: ["clinicId"], where: { clinicId: { in: doctorIds }, clinic: { tenantId: actor.tenantId } }, _count: { _all: true } }) : Promise.resolve([]),
    revenueIds.length ? prisma.registration.groupBy({ by: ["clinicId"], where: { clinicId: { in: revenueIds }, clinic: { tenantId: actor.tenantId }, visitDate: { gte: range.start, lt: range.end } }, _sum: { amount: true } }) : Promise.resolve([]),
  ]);
  const patientMap = new Map(patients.map((row) => [row.clinicId, row._count._all]));
  const appointmentMap = new Map(appointments.map((row) => [row.clinicId, row._count._all]));
  const doctorMap = new Map(doctors.map((row) => [row.clinicId, row._count._all]));
  const revenueMap = new Map(revenue.map((row) => [row.clinicId, toNumber(row._sum.amount)]));
  return clinics.map((clinic) => ({
    clinicId: clinic.id,
    clinicName: clinic.name,
    ...(patientMap.has(clinic.id) ? { patients: patientMap.get(clinic.id) } : {}),
    ...(appointmentMap.has(clinic.id) ? { appointments: appointmentMap.get(clinic.id) } : {}),
    ...(doctorMap.has(clinic.id) ? { doctors: doctorMap.get(clinic.id) } : {}),
    ...(revenueMap.has(clinic.id) ? { revenue: revenueMap.get(clinic.id) } : {}),
  }));
}

export async function getAdminDashboardData(
  actor: ActorContext,
  selectedClinicId: string | null,
  period: DashboardPreset,
  now: Date = new Date(),
  visibleWidgetIds?: ReadonlySet<DashboardWidgetId>,
): Promise<AdminDashboardData> {
  const [user, clinics, modules, scopes] = await Promise.all([
    prisma.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId }, select: { name: true } }),
    prisma.clinic.findMany({ where: { tenantId: actor.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    resolveModulesForActor(actor),
    accessibleClinicScopes(actor, [...ACTION_PERMISSIONS, ...DATA_PERMISSIONS]),
  ]);
  const access = resolveAdminDashboardClinicAccess(scopes, clinics, selectedClinicId);
  const dashboardIdsFor = (permission: AdminDashboardDataPermission) => access.dashboard[permission];
  const actionIdsFor = (permission: AdminDashboardActionPermission) => access.actions[permission];
  const enabled = (permission: AdminDashboardDataPermission, feature: string) => moduleAllowed(modules, feature) && dashboardIdsFor(permission).length > 0;

  const capabilities: DashboardCapabilities = {
    dashboard: {
      view: dashboardIdsFor("dashboard:view").length > 0,
      patients: enabled("dashboard:patients:view", MODULE_FEATURES.registrations),
      appointments: enabled("dashboard:appointments:view", MODULE_FEATURES.appointments),
      revenue: enabled("dashboard:revenue:view", MODULE_FEATURES.reports),
      doctors: enabled("dashboard:doctors:view", MODULE_FEATURES.doctors),
      messages: enabled("dashboard:messages:view", MODULE_FEATURES.whatsapp),
      tasks: enabled("dashboard:tasks:view", MODULE_FEATURES.tasks),
      schedule: enabled("dashboard:schedule:view", MODULE_FEATURES.appointments),
      activity: enabled("dashboard:activity:view", MODULE_FEATURES.registrations),
      team: enabled("dashboard:team:view", MODULE_FEATURES.team),
      clinics: enabled("dashboard:clinics:view", MODULE_FEATURES.clinics),
    },
    actions: {
      canBookAppointment: moduleAllowed(modules, MODULE_FEATURES.appointments) && actionIdsFor("appointment:create").length > 0,
      canCreateRegistration: moduleAllowed(modules, MODULE_FEATURES.registrations) && actionIdsFor("registration:create").length > 0,
      canAddDoctor: moduleAllowed(modules, MODULE_FEATURES.doctors) && actionIdsFor("doctor:create").length > 0,
      canManageTeam: moduleAllowed(modules, MODULE_FEATURES.team) && actionIdsFor("team:manage").length > 0,
      canManageRoles: actionIdsFor("role:manage").length > 0,
      canCreateTask: moduleAllowed(modules, MODULE_FEATURES.tasks) && actionIdsFor("task:create").length > 0,
    },
  };

  const range = presetRange(period, now);
  const previous = previousPeriod(range);
  const interval = trendInterval(period);
  const patientIds = dashboardIdsFor("dashboard:patients:view");
  const appointmentIds = dashboardIdsFor("dashboard:appointments:view");
  const revenueIds = dashboardIdsFor("dashboard:revenue:view");
  const doctorIds = dashboardIdsFor("dashboard:doctors:view");
  const messageIds = dashboardIdsFor("dashboard:messages:view");
  const taskIds = dashboardIdsFor("dashboard:tasks:view");
  const scheduleIds = dashboardIdsFor("dashboard:schedule:view");
  const activityIds = dashboardIdsFor("dashboard:activity:view");
  const clinicIds = dashboardIdsFor("dashboard:clinics:view");
  const teamTaskIds = capabilities.dashboard.team
    ? taskIds.filter((id) => actionIdsFor("task:manage").includes(id))
    : [];
  const requestedGroups = visibleWidgetIds
    ? dashboardDataGroupsForWidgetIds(visibleWidgetIds)
    : null;

  // Authorization and module gates above are authoritative. Layout can only
  // narrow already-authorized work; it never causes a query to run on its own.
  const wants = (group: DashboardWidgetDataGroup) =>
    requestedGroups === null || requestedGroups.has(group);

  const [patients, appointments, schedule, revenue, messages, tasks, recentActivity] = await Promise.all([
    capabilities.dashboard.patients && wants("patients") ? loadPatientDashboardStats(actor, patientIds, range, previous, interval) : Promise.resolve(undefined),
    capabilities.dashboard.appointments && wants("appointments") ? loadAppointmentDashboardStats(actor, appointmentIds, range, previous, interval, now) : Promise.resolve(undefined),
    capabilities.dashboard.schedule && wants("schedule") ? loadTodaySchedule(actor, scheduleIds, now) : Promise.resolve(undefined),
    capabilities.dashboard.revenue && wants("revenue") ? loadRevenueDashboardStats(actor, revenueIds, range, previous, interval, now) : Promise.resolve(undefined),
    capabilities.dashboard.messages && wants("messages") ? loadMessageDashboardStats(actor, messageIds, now) : Promise.resolve(undefined),
    capabilities.dashboard.tasks && wants("tasks") ? loadTaskDashboardStats(actor, taskIds, teamTaskIds, now) : Promise.resolve(undefined),
    capabilities.dashboard.activity && wants("activity") ? loadRecentPatientActivity(actor, activityIds) : Promise.resolve(undefined),
  ]);

  const revenueByDoctor = new Map(revenue?.byDoctor.map((row) => [row.doctorId, row.revenue]) ?? []);
  const [doctors, clinicPerformance] = await Promise.all([
    capabilities.dashboard.doctors && wants("doctors") ? loadDoctorDashboardStats(actor, doctorIds, range, now, revenueByDoctor) : Promise.resolve(undefined),
    capabilities.dashboard.clinics && wants("clinics") && clinicIds.length > 1 ? loadClinicPerformance(
      actor,
      clinics.filter((clinic) => clinicIds.includes(clinic.id)),
      range,
      { patients: patientIds, appointments: appointmentIds, doctors: doctorIds, revenue: revenueIds },
    ) : Promise.resolve(undefined),
  ]);

  const visibleClinicIds = dashboardIdsFor("dashboard:view");
  const visibleClinics = clinics.filter((clinic) => visibleClinicIds.includes(clinic.id));
  const selectedClinic = selectedClinicId ? visibleClinics.find((clinic) => clinic.id === selectedClinicId) ?? null : null;

  return {
    userName: user?.name?.trim() || "there",
    period,
    rangeLabel: dateRangeLabel(range),
    comparisonLabel: period === "today" ? "vs yesterday" : period === "last7" ? "vs previous 7 days" : period === "last30" ? "vs previous 30 days" : period === "thisMonth" ? "vs previous month" : period === "lastMonth" ? "vs month before" : "vs previous year",
    scope: {
      selectedClinicId: selectedClinic?.id ?? null,
      clinicIds: visibleClinicIds,
      clinicName: selectedClinic?.name ?? (visibleClinics.length === 1 ? visibleClinics[0].name : null),
      clinicCount: visibleClinics.length,
    },
    capabilities,
    summary: {
      ...(patients ? { totalPatients: patients.total, patientChange: patients.change } : {}),
      ...(appointments ? { todaysAppointments: appointments.today, appointmentChange: appointments.change } : {}),
      ...(revenue ? { todaysCollection: revenue.today, monthRevenue: revenue.thisMonth, revenueChange: revenue.change } : {}),
      ...(doctors ? { activeDoctors: doctors.active } : {}),
      ...(tasks ? { pendingTasks: tasks.myPending, overdueTasks: tasks.overdue } : {}),
      ...(messages ? { messageHealth: messages.acceptanceRate } : {}),
    },
    ...(patients ? { patients } : {}),
    ...(appointments ? { appointments } : {}),
    ...(schedule ? { schedule } : {}),
    ...(revenue ? { revenue } : {}),
    ...(doctors ? { doctors } : {}),
    ...(messages ? { messages } : {}),
    ...(tasks ? { tasks } : {}),
    ...(clinicPerformance ? { clinicPerformance } : {}),
    ...(recentActivity ? { recentActivity } : {}),
  };
}
