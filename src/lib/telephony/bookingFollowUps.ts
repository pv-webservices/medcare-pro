import {
  TelephonyBookingRequestReason,
  TelephonyBookingRequestStatus,
} from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { ConflictError } from "@/lib/apiHandler";
import { clinicIdsForDashboardScope } from "@/lib/adminDashboardScope";
import { MODULE_FEATURES, moduleLock, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScopes,
  assertClinicInTenant,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import { normalizePlivoCallerNumber } from "@/lib/telephony/phoneNumber";

export const DASHBOARD_BOOKING_FOLLOW_UP_LIMIT = 20;

const REASON_LABELS: Readonly<Record<TelephonyBookingRequestReason, string>> = {
  NO_PATIENT_MATCH: "No matching patient found",
  AMBIGUOUS_PATIENT_MATCH: "Multiple possible patient matches",
  USER_REQUESTED: "Caller requested booking follow-up",
};

export interface DashboardBookingFollowUp {
  readonly id: string;
  readonly clinicId: string;
  readonly clinicName: string;
  readonly callerNumber: string | null;
  readonly reason: TelephonyBookingRequestReason;
  readonly reasonLabel: string;
  readonly status: "PENDING";
  readonly createdAt: string;
}

export interface DashboardBookingFollowUpsModel {
  readonly items: readonly DashboardBookingFollowUp[];
}

/**
 * Operational dashboard read model. Full numbers require both dashboard reach
 * and the existing front-desk authority to create bookings.
 */
export async function getDashboardBookingFollowUpsForActor(
  actor: ActorContext,
  selectedClinicId: string | null,
): Promise<DashboardBookingFollowUpsModel | null> {
  const [ivrLock, appointmentsLock] = await Promise.all([
    moduleLock(actor, MODULE_FEATURES.ivr),
    moduleLock(actor, MODULE_FEATURES.appointments),
  ]);
  if (ivrLock || appointmentsLock) return null;

  const [clinics, scopes] = await Promise.all([
    prisma.clinic.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    accessibleClinicScopes(actor, ["dashboard:view", "appointment:create"]),
  ]);
  const dashboardIds = clinicIdsForDashboardScope(
    scopes.get("dashboard:view"),
    clinics,
    selectedClinicId,
  );
  const bookingIds = new Set(
    clinicIdsForDashboardScope(
      scopes.get("appointment:create"),
      clinics,
      selectedClinicId,
    ),
  );
  const clinicIds = dashboardIds.filter((id) => bookingIds.has(id));
  if (clinicIds.length === 0) return null;

  const rows = await prisma.telephonyBookingRequest.findMany({
    where: {
      tenantId: actor.tenantId,
      clinicId: { in: clinicIds },
      status: TelephonyBookingRequestStatus.PENDING,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: DASHBOARD_BOOKING_FOLLOW_UP_LIMIT,
    select: {
      id: true,
      clinicId: true,
      callerNumber: true,
      reason: true,
      status: true,
      createdAt: true,
      clinic: { select: { name: true } },
    },
  });

  return Object.freeze({
    items: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          clinicId: row.clinicId,
          clinicName: row.clinic.name,
          callerNumber: normalizePlivoCallerNumber(row.callerNumber),
          reason: row.reason,
          reasonLabel: REASON_LABELS[row.reason],
          status: "PENDING" as const,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
    ),
  });
}

export interface ResolvedBookingFollowUp {
  readonly id: string;
  readonly status: "RESOLVED";
}

/** PENDING -> RESOLVED, idempotent for an already-resolved in-scope request. */
export async function resolveTelephonyBookingFollowUpForActor(
  actor: ActorContext,
  clinicId: string,
  requestId: string,
): Promise<ResolvedBookingFollowUp> {
  await Promise.all([
    requireModule(actor, MODULE_FEATURES.ivr),
    requireModule(actor, MODULE_FEATURES.appointments),
    assertClinicInTenant(actor.tenantId, clinicId),
  ]);
  await requirePermission(actor, "appointment:create", clinicId);

  return prisma.$transaction(async (tx) => {
    const current = await tx.telephonyBookingRequest.findFirst({
      where: { id: requestId, tenantId: actor.tenantId, clinicId },
      select: { id: true, status: true },
    });
    if (!current) throw new ScopeError();
    if (current.status === TelephonyBookingRequestStatus.CANCELLED) {
      throw new ConflictError("This booking follow-up was cancelled.");
    }
    if (current.status === TelephonyBookingRequestStatus.RESOLVED) {
      return Object.freeze({ id: current.id, status: "RESOLVED" as const });
    }

    const changed = await tx.telephonyBookingRequest.updateMany({
      where: {
        id: requestId,
        tenantId: actor.tenantId,
        clinicId,
        status: TelephonyBookingRequestStatus.PENDING,
      },
      data: { status: TelephonyBookingRequestStatus.RESOLVED },
    });
    if (changed.count === 0) {
      const concurrent = await tx.telephonyBookingRequest.findFirst({
        where: { id: requestId, tenantId: actor.tenantId, clinicId },
        select: { id: true, status: true },
      });
      if (concurrent?.status === TelephonyBookingRequestStatus.RESOLVED) {
        return Object.freeze({ id: concurrent.id, status: "RESOLVED" as const });
      }
      throw new ConflictError("This booking follow-up could not be resolved.");
    }

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TELEPHONY_BOOKING_FOLLOW_UP_RESOLVED,
      targetType: "TelephonyBookingRequest",
      targetId: requestId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { status: TelephonyBookingRequestStatus.PENDING, clinicId },
      afterValue: { status: TelephonyBookingRequestStatus.RESOLVED, clinicId },
    });

    return Object.freeze({ id: requestId, status: "RESOLVED" as const });
  });
}
