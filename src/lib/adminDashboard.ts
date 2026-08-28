import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clinicIdsForDashboardScope } from "@/lib/adminDashboardScope";
import { resolveModulesForActor } from "@/lib/features";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";
import { formatClockTime, parseDateOnly, parseDateTime } from "@/lib/dates";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  accessibleClinicScopes,
  type ActorContext,
  type ClinicScope,
} from "@/lib/rbac";
import { parseChangedFields } from "@/lib/registrationAudit";
import { getDailyRevenueSnapshot } from "@/lib/reports";
import {
  listNotificationsForActor,
  type NotificationRecord,
} from "@/lib/notifications";

/**
 * Real-data aggregation for the operational (non-owner) dashboard.
 *
 * Each module has three independent gates before it can issue a data query:
 * the actor must hold its read permission somewhere, the module must be enabled
 * for the tenant and role, and the selected clinic (when any) must intersect
 * that permission's own clinic scope. Tenant ids always come from `actor`.
 */

const PERMISSIONS = [
  "clinic:read",
  "appointment:read",
  "appointment:create",
  "registration:read",
  "registration:create",
  "registration:history:read",
  "report:read",
  "doctor:read",
  "doctor:create",
  "notification:read",
  "audit:read",
] as const;

export interface AdminDashboardCapabilities {
  appointments: boolean;
  registrations: boolean;
  revenue: boolean;
  doctors: boolean;
  activity: boolean;
  notifications: boolean;
  canBookAppointment: boolean;
  canCreateRegistration: boolean;
  canAddDoctor: boolean;
}

export interface AdminAppointmentSummary {
  active: number;
  total: number;
  byStatus: Record<AppointmentStatus, number>;
}

export interface AdminScheduleRow {
  id: string;
  clinicName: string;
  patientName: string;
  doctorName: string;
  serviceName: string;
  startTime: string;
  status: AppointmentStatus;
}

export interface AdminRegistrationSummary {
  total: number;
  newPatients: number;
  followUps: number;
}

export interface AdminRegistrationRow {
  id: string;
  clinicName: string;
  patientName: string;
  doctorName: string | null;
  visitType: string;
  visitTime: string;
  createdByName: string;
}

export type DoctorDayStatus = "AVAILABLE" | "ON_LEAVE" | "NOT_SCHEDULED";

export interface AdminDoctorRow {
  id: string;
  clinicName: string;
  name: string;
  department: string;
  status: DoctorDayStatus;
  availability: string | null;
}

export interface AdminDoctorSummary {
  total: number;
  available: number;
  onLeave: number;
  notScheduled: number;
  rows: AdminDoctorRow[];
}

export interface AdminActivityRow {
  id: string;
  actorName: string;
  action: "created" | "updated";
  patientName: string;
  changedFields: string[];
  timestamp: Date;
}

export interface AdminDashboardData {
  userName: string;
  date: string;
  scope: {
    type: "ACCOUNT" | "CLINIC";
    clinicId: string | null;
    clinicName: string | null;
    clinicCount: number;
  };
  capabilities: AdminDashboardCapabilities;
  appointments: AdminAppointmentSummary | null;
  schedule: AdminScheduleRow[];
  registrations: AdminRegistrationSummary | null;
  registrationActivity: AdminRegistrationRow[];
  revenueToday: string | null;
  doctors: AdminDoctorSummary | null;
  recentActivity: AdminActivityRow[];
  notifications: {
    unreadCount: number;
    items: NotificationRecord[];
  } | null;
}

function moduleAllowed(
  modules: Awaited<ReturnType<typeof resolveModulesForActor>>,
  key: string,
): boolean {
  return modules.get(key)?.allowed === true;
}

function hasPermission(scope: ClinicScope | undefined): boolean {
  return scope !== undefined && scope.scope !== "none";
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  const rightIds = new Set(right);
  return left.filter((id) => rightIds.has(id));
}

function emptyStatusCounts(): Record<AppointmentStatus, number> {
  return Object.fromEntries(
    APPOINTMENT_STATUSES.map((status) => [status, 0]),
  ) as Record<AppointmentStatus, number>;
}

async function loadAppointments(
  actor: ActorContext,
  clinicIds: readonly string[],
  start: Date,
  end: Date,
): Promise<{
  summary: AdminAppointmentSummary;
  schedule: AdminScheduleRow[];
}> {
  if (clinicIds.length === 0) {
    return {
      summary: { active: 0, total: 0, byStatus: emptyStatusCounts() },
      schedule: [],
    };
  }

  const where: Prisma.AppointmentWhereInput = {
    tenantId: actor.tenantId,
    clinicId: { in: [...clinicIds] },
    slotStart: { gte: start, lt: end },
  };

  const [grouped, rows] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.appointment.findMany({
      where: { ...where, status: { not: "RESCHEDULED" } },
      orderBy: [{ slotStart: "asc" }, { id: "asc" }],
      take: 12,
      select: {
        id: true,
        name: true,
        slotStart: true,
        status: true,
        clinic: { select: { name: true } },
        doctor: { select: { name: true } },
        appointmentType: { select: { name: true } },
      },
    }),
  ]);

  const byStatus = emptyStatusCounts();
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
  }

  return {
    summary: {
      active: OCCUPYING_STATUSES.reduce(
        (total, status) => total + byStatus[status],
        0,
      ),
      // A moved row is historical, not another appointment in today's board.
      total: APPOINTMENT_STATUSES.filter((status) => status !== "RESCHEDULED").reduce(
        (total, status) => total + byStatus[status],
        0,
      ),
      byStatus,
    },
    schedule: rows.map((row) => ({
      id: row.id,
      clinicName: row.clinic.name,
      patientName: row.name,
      doctorName: row.doctor.name,
      serviceName: row.appointmentType.name,
      startTime: formatClockTime(row.slotStart),
      status: row.status,
    })),
  };
}

async function loadRegistrations(
  clinicIds: readonly string[],
  start: Date,
  end: Date,
): Promise<{
  summary: AdminRegistrationSummary;
  rows: AdminRegistrationRow[];
}> {
  if (clinicIds.length === 0) {
    return {
      summary: { total: 0, newPatients: 0, followUps: 0 },
      rows: [],
    };
  }

  const where: Prisma.RegistrationWhereInput = {
    clinicId: { in: [...clinicIds] },
    visitDate: { gte: start, lt: end },
  };

  const [grouped, rows] = await Promise.all([
    prisma.registration.groupBy({
      by: ["visitType"],
      where,
      _count: { _all: true },
    }),
    prisma.registration.findMany({
      where,
      orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        visitDate: true,
        visitType: true,
        clinic: { select: { name: true } },
        patient: { select: { name: true } },
        doctor: { select: { name: true } },
        creator: { select: { name: true, email: true } },
      },
    }),
  ]);

  const counts = new Map(grouped.map((row) => [row.visitType, row._count._all]));

  return {
    summary: {
      total: grouped.reduce((total, row) => total + row._count._all, 0),
      newPatients: counts.get("NEW") ?? 0,
      followUps: counts.get("FOLLOW_UP") ?? 0,
    },
    rows: rows.map((row) => ({
      id: row.id,
      clinicName: row.clinic.name,
      patientName: row.patient.name,
      doctorName: row.doctor?.name ?? null,
      // The column is intentionally extensible. Unknown values stay visible as
      // stored instead of being silently reclassified as NEW.
      visitType: row.visitType,
      visitTime: formatClockTime(row.visitDate),
      createdByName: row.creator.name ?? row.creator.email,
    })),
  };
}

async function loadDoctors(
  clinicIds: readonly string[],
  date: Date,
): Promise<AdminDoctorSummary> {
  if (clinicIds.length === 0) {
    return { total: 0, available: 0, onLeave: 0, notScheduled: 0, rows: [] };
  }

  const doctorWhere: Prisma.DoctorWhereInput = {
    clinicId: { in: [...clinicIds] },
  };
  const [total, availableRows, leaveRows, doctors] = await Promise.all([
    prisma.doctor.count({ where: doctorWhere }),
    prisma.doctorAvailability.findMany({
      where: { date, doctor: doctorWhere },
      distinct: ["doctorId"],
      select: { doctorId: true },
    }),
    prisma.doctorLeave.findMany({
      where: {
        startDate: { lte: date },
        endDate: { gte: date },
        doctor: doctorWhere,
      },
      distinct: ["doctorId"],
      select: { doctorId: true },
    }),
    prisma.doctor.findMany({
      where: doctorWhere,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 8,
      select: {
        id: true,
        name: true,
        department: true,
        clinic: { select: { name: true } },
        availability: {
          where: { date },
          orderBy: { startTime: "asc" },
          select: { startTime: true, endTime: true },
        },
        leave: {
          where: { startDate: { lte: date }, endDate: { gte: date } },
          take: 1,
          select: { id: true },
        },
      },
    }),
  ]);

  const scheduled = new Set(availableRows.map((row) => row.doctorId));
  const onLeave = new Set(leaveRows.map((row) => row.doctorId));
  const available = [...scheduled].filter((doctorId) => !onLeave.has(doctorId)).length;
  const notScheduled = Math.max(0, total - onLeave.size - available);

  return {
    total,
    available,
    onLeave: onLeave.size,
    notScheduled,
    rows: doctors.map((doctor) => {
      const status: DoctorDayStatus =
        doctor.leave.length > 0
          ? "ON_LEAVE"
          : doctor.availability.length > 0
            ? "AVAILABLE"
            : "NOT_SCHEDULED";

      return {
        id: doctor.id,
        clinicName: doctor.clinic.name,
        name: doctor.name,
        department: doctor.department,
        status,
        availability:
          doctor.availability.length > 0
            ? doctor.availability
                .map((slot) => `${slot.startTime}–${slot.endTime}`)
                .join(", ")
            : null,
      };
    }),
  };
}

async function loadRecentActivity(
  actor: ActorContext,
  clinicIds: readonly string[],
): Promise<AdminActivityRow[]> {
  if (clinicIds.length === 0) return [];

  const rows = await prisma.registrationEditLog.findMany({
    where: {
      registration: {
        clinicId: { in: [...clinicIds] },
        clinic: { tenantId: actor.tenantId },
      },
    },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: 8,
    select: {
      id: true,
      changedFields: true,
      timestamp: true,
      editedBy: { select: { name: true, email: true } },
      registration: { select: { patient: { select: { name: true } } } },
    },
  });

  return rows.map((row) => {
    const changes = parseChangedFields(row.changedFields);
    const isCreation = changes.length > 0 && changes.every((change) => change.from === null);

    return {
      id: row.id,
      actorName: row.editedBy.name ?? row.editedBy.email,
      action: isCreation ? "created" : "updated",
      patientName: row.registration.patient.name,
      changedFields: changes.map((change) => change.label),
      timestamp: row.timestamp,
    };
  });
}

export async function getAdminDashboardData(
  actor: ActorContext,
  selectedClinicId: string | null,
  dateValue: string,
): Promise<AdminDashboardData> {
  const [user, clinics, modules, scopes] = await Promise.all([
    prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    }),
    prisma.clinic.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    resolveModulesForActor(actor),
    accessibleClinicScopes(actor, PERMISSIONS),
  ]);

  const scopeFor = (permission: (typeof PERMISSIONS)[number]) =>
    scopes.get(permission);
  const idsFor = (permission: (typeof PERMISSIONS)[number]) =>
    clinicIdsForDashboardScope(scopeFor(permission), clinics, selectedClinicId);

  const appointmentsEnabled =
    moduleAllowed(modules, MODULE_FEATURES.appointments) &&
    hasPermission(scopeFor("appointment:read"));
  const registrationsEnabled =
    moduleAllowed(modules, MODULE_FEATURES.registrations) &&
    hasPermission(scopeFor("registration:read"));
  const revenueEnabled =
    moduleAllowed(modules, MODULE_FEATURES.reports) &&
    hasPermission(scopeFor("report:read"));
  const doctorsEnabled =
    moduleAllowed(modules, MODULE_FEATURES.doctors) &&
    hasPermission(scopeFor("doctor:read"));
  const notificationsEnabled =
    moduleAllowed(modules, MODULE_FEATURES.notifications) &&
    hasPermission(scopeFor("notification:read"));
  const activityEnabled =
    moduleAllowed(modules, MODULE_FEATURES.registrations) &&
    hasPermission(scopeFor("registration:read")) &&
    hasPermission(scopeFor("audit:read")) &&
    hasPermission(scopeFor("registration:history:read"));

  const dayStart = parseDateOnly(dateValue);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const appointmentIds = idsFor("appointment:read");
  const registrationIds = idsFor("registration:read");
  const doctorIds = idsFor("doctor:read");
  const activityIds = intersect(
    registrationIds,
    intersect(idsFor("audit:read"), idsFor("registration:history:read")),
  );

  const [appointmentData, registrationData, revenue, doctors, activity, notifications] =
    await Promise.all([
      appointmentsEnabled
        ? loadAppointments(actor, appointmentIds, dayStart, dayEnd)
        : Promise.resolve(null),
      registrationsEnabled
        ? loadRegistrations(registrationIds, dayStart, dayEnd)
        : Promise.resolve(null),
      revenueEnabled
        ? getDailyRevenueSnapshot(
            actor,
            selectedClinicId,
            // Reports uses UTC date buckets. Midday keeps this exact selected
            // wall-clock day even if a host changes its local timezone.
            parseDateTime(dateValue, "12:00"),
          )
        : Promise.resolve(null),
      doctorsEnabled ? loadDoctors(doctorIds, dayStart) : Promise.resolve(null),
      activityEnabled
        ? loadRecentActivity(actor, activityIds)
        : Promise.resolve([]),
      notificationsEnabled
        ? listNotificationsForActor(actor, {
            clinicId: selectedClinicId ?? undefined,
            limit: 5,
          })
        : Promise.resolve(null),
    ]);

  const selectedClinic = selectedClinicId
    ? clinics.find((clinic) => clinic.id === selectedClinicId) ?? null
    : null;
  const visibleIds = new Set(
    [
      idsFor("clinic:read"),
      appointmentIds,
      registrationIds,
      doctorIds,
      idsFor("report:read"),
      idsFor("notification:read"),
    ].flat(),
  );
  const visibleClinics = clinics.filter((clinic) => visibleIds.has(clinic.id));
  const hasAccountWideScope = [
    scopeFor("clinic:read"),
    scopeFor("appointment:read"),
    scopeFor("registration:read"),
    scopeFor("report:read"),
    scopeFor("doctor:read"),
    scopeFor("notification:read"),
  ].some((scope) => scope?.scope === "all");
  const soleAssignedClinic =
    !hasAccountWideScope && visibleClinics.length === 1 ? visibleClinics[0] : null;
  const scopedClinic = selectedClinic ?? soleAssignedClinic;

  const capabilities: AdminDashboardCapabilities = {
    appointments: appointmentsEnabled,
    registrations: registrationsEnabled,
    revenue: revenueEnabled,
    doctors: doctorsEnabled,
    activity: activityEnabled,
    notifications: notificationsEnabled,
    canBookAppointment:
      moduleAllowed(modules, MODULE_FEATURES.appointments) &&
      idsFor("appointment:create").length > 0,
    canCreateRegistration:
      moduleAllowed(modules, MODULE_FEATURES.registrations) &&
      idsFor("registration:create").length > 0,
    canAddDoctor:
      moduleAllowed(modules, MODULE_FEATURES.doctors) &&
      idsFor("doctor:create").length > 0,
  };

  return {
    userName: user?.name?.trim() || "there",
    date: dateValue,
    scope: {
      type: scopedClinic ? "CLINIC" : "ACCOUNT",
      clinicId: scopedClinic?.id ?? null,
      clinicName: scopedClinic?.name ?? null,
      clinicCount: visibleClinics.length,
    },
    capabilities,
    appointments: appointmentData?.summary ?? null,
    schedule: appointmentData?.schedule ?? [],
    registrations: registrationData?.summary ?? null,
    registrationActivity: registrationData?.rows ?? [],
    revenueToday: revenue?.totalRevenue ?? null,
    doctors,
    recentActivity: activity,
    notifications: notifications
      ? { unreadCount: notifications.unreadCount, items: notifications.items }
      : null,
  };
}
