import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScopes,
  type ActorContext,
  type ClinicScope,
} from "@/lib/rbac";

export const APPOINTMENT_BROAD_READ = "appointment:read" as const;
export const APPOINTMENT_SELF_READ = "appointment:self:read" as const;

export type AppointmentScopeKind =
  | "clinic-wide"
  | "doctor-self"
  | "mixed"
  | "unavailable";

export interface LinkedDoctorProfile {
  id: string;
  clinicId: string;
}

export interface AppointmentReadScope {
  kind: AppointmentScopeKind;
  broadClinicIds: string[];
  selfClinicIds: string[];
  linkedDoctorIds: string[];
  unlinkedSelfClinicIds: string[];
  /** Null deliberately means that no appointment row is readable. */
  where: Prisma.AppointmentWhereInput | null;
}

function idsForScope(scope: ClinicScope, tenantClinicIds: readonly string[]): string[] {
  if (scope.scope === "none") return [];
  if (scope.scope === "all") return [...tenantClinicIds];
  const allowed = new Set(scope.clinicIds);
  return tenantClinicIds.filter((id) => allowed.has(id));
}

/**
 * Pure composition used by the server resolver and its security tests.
 *
 * Broad and self grants are resolved per clinic. Broad always wins in a clinic
 * where both apply; self grants remain constrained to Doctor rows explicitly
 * linked to this user. A client-selected clinic can only reduce candidates.
 */
export function buildAppointmentReadScope(input: {
  tenantId: string;
  tenantClinicIds: readonly string[];
  candidateClinicIds?: readonly string[];
  requestedClinicId?: string | null;
  broadScope: ClinicScope;
  selfScope: ClinicScope;
  linkedDoctors: readonly LinkedDoctorProfile[];
}): AppointmentReadScope {
  const tenantIds = new Set(input.tenantClinicIds);
  const candidates = new Set(
    (input.candidateClinicIds ?? input.tenantClinicIds).filter((id) =>
      tenantIds.has(id),
    ),
  );
  const requested = input.requestedClinicId?.trim() || null;
  if (requested) {
    for (const id of [...candidates]) {
      if (id !== requested) candidates.delete(id);
    }
  }

  const broadClinicIds = idsForScope(input.broadScope, input.tenantClinicIds)
    .filter((id) => candidates.has(id));
  const broad = new Set(broadClinicIds);
  const selfClinicIds = idsForScope(input.selfScope, input.tenantClinicIds)
    .filter((id) => candidates.has(id) && !broad.has(id));
  const self = new Set(selfClinicIds);
  const linked = input.linkedDoctors.filter((doctor) => self.has(doctor.clinicId));
  const linkedDoctorIds = linked.map((doctor) => doctor.id);
  const linkedClinicIds = new Set(linked.map((doctor) => doctor.clinicId));
  const unlinkedSelfClinicIds = selfClinicIds.filter(
    (clinicId) => !linkedClinicIds.has(clinicId),
  );

  const clauses: Prisma.AppointmentWhereInput[] = [];
  if (broadClinicIds.length > 0) {
    clauses.push({ clinicId: { in: broadClinicIds } });
  }
  if (linkedDoctorIds.length > 0) {
    clauses.push({
      clinicId: { in: selfClinicIds },
      doctorId: { in: linkedDoctorIds },
    });
  }

  const hasBroad = broadClinicIds.length > 0;
  const hasSelf = selfClinicIds.length > 0;
  const kind: AppointmentScopeKind = hasBroad
    ? hasSelf
      ? "mixed"
      : "clinic-wide"
    : hasSelf
      ? "doctor-self"
      : "unavailable";

  return {
    kind,
    broadClinicIds,
    selfClinicIds,
    linkedDoctorIds,
    unlinkedSelfClinicIds,
    where:
      clauses.length === 0
        ? null
        : {
            tenantId: input.tenantId,
            OR: clauses,
          },
  };
}

/**
 * Central server-side appointment visibility resolver.
 *
 * `candidateClinicIds` is used by dashboard data permissions; a dashboard
 * layout or clinic picker can only narrow the appointment permission union.
 * No role name or client-supplied doctor id participates in authorization.
 */
export async function resolveAppointmentReadScope(
  actor: ActorContext,
  options: {
    candidateClinicIds?: readonly string[];
    requestedClinicId?: string | null;
  } = {},
): Promise<AppointmentReadScope> {
  const [clinics, scopes, linkedDoctors] = await Promise.all([
    prisma.clinic.findMany({
      where: { tenantId: actor.tenantId },
      select: { id: true },
    }),
    accessibleClinicScopes(actor, [APPOINTMENT_BROAD_READ, APPOINTMENT_SELF_READ]),
    prisma.doctor.findMany({
      where: {
        userId: actor.userId,
        clinic: { tenantId: actor.tenantId },
      },
      select: { id: true, clinicId: true },
    }),
  ]);

  return buildAppointmentReadScope({
    tenantId: actor.tenantId,
    tenantClinicIds: clinics.map((clinic) => clinic.id),
    candidateClinicIds: options.candidateClinicIds,
    requestedClinicId: options.requestedClinicId,
    broadScope: scopes.get(APPOINTMENT_BROAD_READ) ?? { scope: "none" },
    selfScope: scopes.get(APPOINTMENT_SELF_READ) ?? { scope: "none" },
    linkedDoctors,
  });
}

/** Adds query-specific predicates without weakening the central scope. */
export function withinAppointmentReadScope(
  scope: AppointmentReadScope,
  where: Prisma.AppointmentWhereInput = {},
): Prisma.AppointmentWhereInput | null {
  return scope.where ? { AND: [scope.where, where] } : null;
}
