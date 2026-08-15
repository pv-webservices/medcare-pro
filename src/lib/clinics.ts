import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  assertClinicInTenant,
  can,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";

/**
 * Clinic data access — PRD §6.2 (FR-2.1 … FR-2.3).
 *
 * Both the API routes and the dashboard's server components go through here, so
 * the tenant/clinic scoping rules are written once. Nothing in this module
 * accepts a tenant id as an argument: it always comes from `actor`, which
 * `requireActor()` derives from the signed session.
 *
 * The PRD defines create, list, edit and detail for clinics (§6.5) — there is
 * deliberately no delete. Removing a clinic would cascade through its doctors,
 * patients and registrations, destroying the revenue history FR-6.4 reports on.
 */

/** #RGB is rejected: the column is VarChar(9), and the UI writes 6- or 8-digit hex. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const themeColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR, "Use a hex colour like #1D4ED8.")
  .max(9);

export const createClinicSchema = z.object({
  name: z.string().trim().min(1, "Clinic name is required.").max(255),
  address: z.string().trim().max(1000).optional().or(z.literal("")),
  city: z.string().trim().max(255).optional().or(z.literal("")),
  logoUrl: z.url("Enter a valid URL.").max(2000).optional().or(z.literal("")),
  themeColor: themeColorSchema.optional().or(z.literal("")),
});

/** Every field optional, but at least one must be present — a no-op PATCH is a client bug. */
export const updateClinicSchema = createClinicSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

export type CreateClinicInput = z.infer<typeof createClinicSchema>;
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;

export interface ClinicSummary {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  logoUrl: string | null;
  themeColor: string | null;
  createdAt: Date;
  /** FR-2.2 — the key stats shown on the list. */
  doctorCount: number;
  patientCount: number;
}

/** Empty strings from an HTML form mean "not set", which is null in the database. */
function emptyToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}

/**
 * FR-2.2 — every clinic the actor may read, with its doctor and patient counts.
 *
 * A user holding a tenant-wide role sees all of the tenant's clinics; one whose
 * roles are clinic-scoped sees only those. Both cases are still filtered by
 * `tenantId`, so a stale clinic-scoped assignment pointing at another tenant's
 * clinic cannot widen the result.
 */
export async function listClinicsForActor(
  actor: ActorContext,
): Promise<ClinicSummary[]> {
  const access = await accessibleClinicScope(actor, "clinic:read");

  if (access.scope === "none") {
    return [];
  }

  const clinics = await prisma.clinic.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(access.scope === "clinics" ? { id: { in: [...access.clinicIds] } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      logoUrl: true,
      themeColor: true,
      createdAt: true,
      _count: { select: { doctors: true, patients: true } },
    },
  });

  return clinics.map(({ _count, ...clinic }) => ({
    ...clinic,
    doctorCount: _count.doctors,
    patientCount: _count.patients,
  }));
}

/**
 * Asserts the clinic is *visible* to the actor, throwing ScopeError (→ 404) if
 * not.
 *
 * Three cases collapse into that one 404 on purpose: another tenant's clinic,
 * an id that does not exist, and a clinic inside this tenant that the actor's
 * roles do not reach. Answering 403 for the last one would confirm to a
 * clinic-scoped Staff user that a sibling clinic exists — PRD §9 requires that
 * they cannot learn about Clinic B by guessing its id.
 *
 * Visibility is distinct from permission to act: a user who can see a clinic
 * but not edit it still gets a 403 from the edit path below.
 */
async function assertClinicVisible(
  actor: ActorContext,
  clinicId: string,
): Promise<void> {
  await assertClinicInTenant(actor.tenantId, clinicId);

  if (!(await can(actor, "clinic:read", clinicId))) {
    throw new ScopeError();
  }
}

/** A single clinic the actor may read. See assertClinicVisible for the 404 rule. */
export async function getClinicForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<ClinicSummary> {
  await assertClinicVisible(actor, clinicId);

  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, tenantId: actor.tenantId },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      logoUrl: true,
      themeColor: true,
      createdAt: true,
      _count: { select: { doctors: true, patients: true } },
    },
  });

  if (!clinic) {
    throw new ScopeError();
  }

  const { _count, ...rest } = clinic;
  return { ...rest, doctorCount: _count.doctors, patientCount: _count.patients };
}

/**
 * FR-2.1 — creates a clinic under the actor's tenant.
 *
 * Requires `clinic:create` tenant-wide: a clinic-scoped role cannot mint new
 * clinics, since there is no existing clinic for the new one to be scoped by.
 */
export async function createClinic(
  actor: ActorContext,
  input: CreateClinicInput,
): Promise<ClinicSummary> {
  await requirePermission(actor, "clinic:create");

  const clinic = await prisma.clinic.create({
    data: {
      // From the session, never from the request body.
      tenantId: actor.tenantId,
      name: input.name,
      address: emptyToNull(input.address) ?? null,
      city: emptyToNull(input.city) ?? null,
      logoUrl: emptyToNull(input.logoUrl) ?? null,
      themeColor: emptyToNull(input.themeColor) ?? null,
    },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      logoUrl: true,
      themeColor: true,
      createdAt: true,
    },
  });

  return { ...clinic, doctorCount: 0, patientCount: 0 };
}

/**
 * FR-2.1 — edits a clinic.
 *
 * Two checks, in this order and not collapsible: a clinic the actor cannot see
 * must 404 (never 403, which would reveal it exists), while one they can see
 * but lack `clinic:edit` for must 403.
 */
export async function updateClinic(
  actor: ActorContext,
  clinicId: string,
  input: UpdateClinicInput,
): Promise<ClinicSummary> {
  await assertClinicVisible(actor, clinicId);
  await requirePermission(actor, "clinic:edit", clinicId);

  await prisma.clinic.update({
    where: { id: clinicId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.address === undefined ? {} : { address: emptyToNull(input.address) }),
      ...(input.city === undefined ? {} : { city: emptyToNull(input.city) }),
      ...(input.logoUrl === undefined ? {} : { logoUrl: emptyToNull(input.logoUrl) }),
      ...(input.themeColor === undefined
        ? {}
        : { themeColor: emptyToNull(input.themeColor) }),
    },
  });

  // Re-read through the scoped getter so the response is built the same way as
  // every other read, counts included.
  return getClinicForActor(actor, clinicId);
}
