import { ConflictError } from "@/lib/apiHandler";
import {
  displayAppointmentTypeName,
  normaliseAppointmentTypeName,
  type AppointmentTypeFilters,
  type CreateAppointmentTypeInput,
  type UpdateAppointmentTypeInput,
} from "@/lib/appointmentInput";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { can, requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";

/**
 * Appointment types — AP-3. The bookable services a clinic offers, and the
 * durations and prices they are booked at.
 *
 * SEPARATE FROM lib/appointments.ts ON PURPOSE. This file is the price list;
 * that one is the diary. They are edited by different people under different
 * permissions — `appointment:type:manage` is Admin's, `appointment:create` is
 * the front desk's — and keeping them apart is what stops a booking route
 * accidentally inheriting the ability to re-price a consultation.
 *
 * Nothing here is ever deleted. A type that is no longer offered is retired
 * with `isActive`, because appointments point at it under a Restrict foreign
 * key and their history must stay readable.
 *
 * The input schemas and the name normaliser live in lib/appointmentInput.ts,
 * which is pure, and are re-exported here so routes import them from the domain
 * module they already use.
 */

export {
  appointmentTypeFilterSchema,
  createAppointmentTypeSchema,
  displayAppointmentTypeName,
  normaliseAppointmentTypeName,
  updateAppointmentTypeSchema,
  type AppointmentTypeFilters,
  type CreateAppointmentTypeInput,
  type UpdateAppointmentTypeInput,
} from "@/lib/appointmentInput";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface AppointmentTypeRecord {
  id: string;
  /** NULL = offered at every clinic in this organisation. */
  clinicId: string | null;
  clinicName: string | null;
  name: string;
  durationMinutes: number;
  /** 2-decimal string, matching the Decimal(10,2) column and lib/registrations.ts. */
  defaultAmount: string;
  isActive: boolean;
}

type TypeRow = {
  id: string;
  clinicId: string | null;
  name: string;
  durationMinutes: number;
  defaultAmount: { toFixed: (digits: number) => string };
  isActive: boolean;
  clinic: { name: string } | null;
};

function toRecord(row: TypeRow): AppointmentTypeRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinic?.name ?? null,
    name: row.name,
    durationMinutes: row.durationMinutes,
    defaultAmount: row.defaultAmount.toFixed(2),
    isActive: row.isActive,
  };
}

const ROW_SELECT = {
  id: true,
  clinicId: true,
  name: true,
  durationMinutes: true,
  defaultAmount: true,
  isActive: true,
  clinic: { select: { name: true } },
} as const;

// ---------------------------------------------------------------------------
// Shared scope resolution
// ---------------------------------------------------------------------------

/**
 * Proves a requested clinic is one this actor may act in, for this permission.
 *
 * Returns null for "no clinic requested", which means tenant-wide — a scope only
 * reachable by someone who already holds the permission somewhere, since
 * `requirePermission` has already run against the tenant.
 */
async function resolveTypeClinic(
  actor: ActorContext,
  permission: string,
  clinicId: string | null | undefined,
): Promise<string | null> {
  if (clinicId === undefined || clinicId === null || clinicId.trim() === "") {
    return null;
  }

  const requested = clinicId.trim();
  const where = await clinicWhereForActor(actor, permission, requested);

  if (!where) {
    throw new ScopeError();
  }

  // The `where` above is intersected with the actor's scope, so a clinic they
  // cannot reach matches nothing here — a 404, never another tenant's site.
  const clinic = await prisma.clinic.findFirst({
    where: { ...where, id: requested },
    select: { id: true },
  });

  if (!clinic) {
    throw new ScopeError();
  }

  return clinic.id;
}

/**
 * The duplicate check MySQL cannot do.
 *
 * `@@unique([tenantId, clinicId, name])` does not stop two tenant-wide types
 * sharing a name, because MySQL treats NULLs as DISTINCT in a unique index — so
 * (t1, NULL, "Consultation") and (t1, NULL, "Consultation") are two different
 * index entries as far as the database is concerned. The schema comment on
 * AppointmentType says so explicitly. This is the check that closes it, and it
 * compares NORMALISED names so "consultation" cannot be added beside
 * "Consultation" either — which the database index would happily allow, being a
 * byte comparison.
 *
 * Scoped exactly: a tenant-wide name collides only with tenant-wide names, and
 * a clinic's name collides only within that clinic. The same service offered at
 * two sites is two rows by design.
 */
async function assertNameIsFree(
  tenantId: string,
  clinicId: string | null,
  name: string,
  excludeTypeId?: string,
): Promise<void> {
  const siblings = await prisma.appointmentType.findMany({
    where: {
      tenantId,
      // `null` here becomes `IS NULL` in Prisma, which is what scopes the check
      // to tenant-wide rows rather than matching every clinic's rows.
      clinicId,
      ...(excludeTypeId ? { id: { not: excludeTypeId } } : {}),
    },
    select: { id: true, name: true },
  });

  const wanted = normaliseAppointmentTypeName(name);
  const clash = siblings.find(
    (sibling) => normaliseAppointmentTypeName(sibling.name) === wanted,
  );

  if (clash) {
    throw new ConflictError(
      clinicId
        ? "This clinic already has an appointment type with that name."
        : "Your organisation already has an appointment type with that name.",
    );
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * The types bookable at a clinic — tenant-wide ones plus that clinic's own.
 *
 * Gated on `appointment:read`, not `appointment:type:manage`: the booking form
 * needs this list, and the front desk must be able to see the price list it
 * books against without being able to edit it.
 */
export async function listAppointmentTypes(
  actor: ActorContext,
  input: AppointmentTypeFilters = {},
): Promise<AppointmentTypeRecord[]> {
  await requireModule(actor, MODULE_FEATURES.appointments);
  await requirePermission(actor, "appointment:read", input.clinicId);

  const clinicId = await resolveTypeClinic(
    actor,
    "appointment:read",
    input.clinicId,
  );

  // Retired types are hidden from anyone who cannot manage them: to the front
  // desk a type that cannot be booked is noise, and showing it invites a call
  // asking why the button does nothing.
  const mayManage = await can(actor, "appointment:type:manage", input.clinicId);
  const includeInactive = Boolean(input.includeInactive) && mayManage;

  const rows = await prisma.appointmentType.findMany({
    where: {
      // Always the session's tenant. Never a client-supplied one.
      tenantId: actor.tenantId,
      ...(clinicId ? { OR: [{ clinicId: null }, { clinicId }] } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    // Tenant-wide first, then by name — a stable order for a dropdown, and one
    // that does not depend on insertion order.
    orderBy: [{ clinicId: "asc" }, { name: "asc" }, { id: "asc" }],
    select: ROW_SELECT,
  });

  return rows.map(toRecord);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createAppointmentType(
  actor: ActorContext,
  input: CreateAppointmentTypeInput,
): Promise<AppointmentTypeRecord> {
  await requireModule(actor, MODULE_FEATURES.appointments);
  // A tenant-wide type (no clinic) requires the permission TENANT-WIDE: an
  // admin scoped to one site must not be able to add a service to every site.
  await requirePermission(
    actor,
    "appointment:type:manage",
    input.clinicId ?? undefined,
  );

  const clinicId = await resolveTypeClinic(
    actor,
    "appointment:type:manage",
    input.clinicId,
  );

  const name = displayAppointmentTypeName(input.name);
  await assertNameIsFree(actor.tenantId, clinicId, name);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.appointmentType.create({
      data: {
        // From the session, never the request.
        tenantId: actor.tenantId,
        clinicId,
        name,
        durationMinutes: input.durationMinutes,
        defaultAmount: input.defaultAmount.toFixed(2),
      },
      select: ROW_SELECT,
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.APPOINTMENT_TYPE_CREATED,
      targetType: "AppointmentType",
      targetId: row.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: auditShape(row),
    });

    return row;
  });

  return toRecord(created);
}

export async function updateAppointmentType(
  actor: ActorContext,
  typeId: string,
  input: UpdateAppointmentTypeInput,
): Promise<AppointmentTypeRecord> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  // Loaded first, and tenant-scoped in the query itself, so another
  // organisation's type is never even read before being judged.
  const existing = await prisma.appointmentType.findFirst({
    where: { id: typeId, tenantId: actor.tenantId },
    select: ROW_SELECT,
  });

  if (!existing) {
    throw new ScopeError();
  }

  // Checked against the type's CURRENT clinic, so someone scoped to one site
  // cannot edit another site's price list — nor a tenant-wide type, which
  // requires the permission tenant-wide.
  await requirePermission(
    actor,
    "appointment:type:manage",
    existing.clinicId ?? undefined,
  );

  const movingScope = input.clinicId !== undefined;
  const nextClinicId = movingScope
    ? await resolveTypeClinic(actor, "appointment:type:manage", input.clinicId)
    : existing.clinicId;

  if (movingScope && nextClinicId !== existing.clinicId) {
    // The permission must be held in the DESTINATION too, or narrowing a
    // tenant-wide type onto a clinic would be a way to write into a site the
    // actor cannot otherwise manage.
    await requirePermission(
      actor,
      "appointment:type:manage",
      nextClinicId ?? undefined,
    );
    await assertScopeChangeIsSafe(existing.id, nextClinicId);
  }

  const nextName =
    input.name === undefined ? existing.name : displayAppointmentTypeName(input.name);

  if (
    normaliseAppointmentTypeName(nextName) !==
      normaliseAppointmentTypeName(existing.name) ||
    nextClinicId !== existing.clinicId
  ) {
    await assertNameIsFree(actor.tenantId, nextClinicId, nextName, existing.id);
  }

  const nextActive = input.isActive ?? existing.isActive;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointmentType.update({
      where: { id: existing.id },
      data: {
        // tenantId is absent: a type cannot change organisation.
        clinicId: nextClinicId,
        name: nextName,
        durationMinutes: input.durationMinutes ?? existing.durationMinutes,
        defaultAmount:
          input.defaultAmount === undefined
            ? undefined
            : input.defaultAmount.toFixed(2),
        isActive: nextActive,
      },
      select: ROW_SELECT,
    });

    // Two separate facts, two separate rows. "Renamed" and "retired" are
    // different questions a reader asks of the trail, and folding a
    // deactivation into a generic update would hide the one that stops
    // bookings.
    const fieldsChanged =
      row.name !== existing.name ||
      row.clinicId !== existing.clinicId ||
      row.durationMinutes !== existing.durationMinutes ||
      row.defaultAmount.toFixed(2) !== existing.defaultAmount.toFixed(2);

    if (fieldsChanged) {
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.APPOINTMENT_TYPE_UPDATED,
        targetType: "AppointmentType",
        targetId: row.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        beforeValue: auditShape(existing),
        afterValue: auditShape(row),
      });
    }

    if (row.isActive !== existing.isActive) {
      await writeAuditLog(tx, {
        action: row.isActive
          ? AUDIT_ACTIONS.APPOINTMENT_TYPE_ACTIVATED
          : AUDIT_ACTIONS.APPOINTMENT_TYPE_DEACTIVATED,
        targetType: "AppointmentType",
        targetId: row.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        beforeValue: { isActive: existing.isActive },
        afterValue: { isActive: row.isActive },
      });
    }

    return row;
  });

  return toRecord(updated);
}

/**
 * Refuses a scope change that would strand appointments already booked.
 *
 * Narrowing a tenant-wide type onto one clinic, or moving a clinic's type to a
 * different site, leaves any appointment booked at the OTHER clinics pointing at
 * a type that is not usable where it was booked. The row survives — the foreign
 * key is Restrict — but the history stops making sense, and AP-5 would later
 * convert a registration against a type that was never offered there.
 *
 * Retire the old type and create a new one instead; that is what `isActive` is
 * for, and it keeps both histories intact.
 */
async function assertScopeChangeIsSafe(
  typeId: string,
  nextClinicId: string | null,
): Promise<void> {
  const stranded = await prisma.appointment.findFirst({
    where: {
      appointmentTypeId: typeId,
      ...(nextClinicId ? { clinicId: { not: nextClinicId } } : {}),
    },
    select: { id: true },
  });

  // A move to tenant-wide widens the scope, so nothing can be stranded by it.
  if (nextClinicId && stranded) {
    throw new ConflictError(
      "Appointments have already been booked with this type at another clinic. Retire it and create a new one instead.",
    );
  }
}

/**
 * What a type looks like in the audit trail.
 *
 * Configuration only — a price list is not patient data, and there is no
 * appointment, patient or booking information here by construction. The amount
 * is the type's LIST price, not any patient's bill.
 */
function auditShape(row: TypeRow): Record<string, string | number | boolean | null> {
  return {
    name: row.name,
    scope: row.clinicId ? "clinic" : "tenant",
    clinicId: row.clinicId,
    durationMinutes: row.durationMinutes,
    defaultAmount: row.defaultAmount.toFixed(2),
    isActive: row.isActive,
  };
}
