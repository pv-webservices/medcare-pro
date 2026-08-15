import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { formatDateOnly, isDateOnly, parseDateOnly } from "@/lib/dates";
import { generatePatientCode } from "@/lib/generatePatientCode";
import { prisma } from "@/lib/prisma";
import {
  assertClinicInTenant,
  can,
  requirePermission,
  resolveRoleNameAtTime,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  diffSnapshots,
  parseChangedFields,
  type ChangedFields,
  type RegistrationSnapshot,
  type RenderedChange,
} from "@/lib/registrationAudit";

/**
 * Registration data access — PRD §6.3 (FR-3.1 … FR-3.6).
 *
 * A Registration is one visit and one revenue line; the Patient is the person.
 * FR-3.1's form fills both in one submission, so a registration created here
 * creates its Patient too, with the `PT-YYYY-####` code minted server-side.
 *
 * Two rules run through every function below and must not be relaxed:
 *
 *   - Scope comes from the session. `tenantId` is never an argument, and a
 *     client-supplied `clinicId` is intersected with the actor's own scope
 *     rather than trusted (see src/lib/clinicScope.ts).
 *   - No write without a log. Creates and edits both append a
 *     `registration_edit_log` row inside the same transaction as the write
 *     itself, so there is no code path that changes a record silently.
 */

/** One screen of results. Not in the PRD; a list with no ceiling is a problem. */
const PAGE_SIZE = 25;

/** FR-3.4 export cap — a download, not an unbounded table scan. */
const EXPORT_ROW_LIMIT = 5000;

/**
 * Two registrations taken at the same moment can read the same highest patient
 * code before either has written it. The unique index on
 * `patients(tenant_id, patient_code)` is what actually guarantees uniqueness;
 * this is how many times we re-pick a candidate before giving up.
 */
const MAX_PATIENT_CODE_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Loose on purpose: international formats vary and the PRD does not fix one. */
const mobileSchema = z
  .string()
  .trim()
  .regex(/^[+()\d][\d\s()-]{4,24}$/, "Enter a valid mobile number.")
  .max(25);

/** Bounded by the `Decimal(10, 2)` column — a larger number would be truncated. */
const amountSchema = z.coerce
  .number()
  .min(0, "The amount cannot be negative.")
  .max(99_999_999.99, "That amount is too large.");

export const createRegistrationSchema = z.object({
  clinicId: z.string().min(1, "Choose a clinic."),

  // Patient details — FR-3.1. The Patient ID is deliberately absent: it is
  // generated server-side and accepting one from the client would let a caller
  // choose their own.
  name: z.string().trim().min(1, "Enter the patient's name.").max(255),
  age: z.coerce.number().int().min(0).max(150).optional().nullable(),
  gender: z.string().trim().max(50).optional().or(z.literal("")),
  mobileNumber: mobileSchema,
  address: z.string().trim().max(1000).optional().or(z.literal("")),
  city: z.string().trim().max(255).optional().or(z.literal("")),

  // Visit details — FR-3.1. Department is required; the doctor is not, so a
  // walk-in can be logged before it is known who will see them.
  doctorId: z.string().min(1).optional().nullable(),
  department: z.string().trim().min(1, "Department is required.").max(255),
  amount: amountSchema,
  visitDate: z.string().refine(isDateOnly, "Choose a valid visit date."),
});

/**
 * Clinic is omitted: moving a registration between clinics would move its
 * revenue between clinics too, which FR-6.4 reports on and the PRD does not
 * describe.
 */
export const updateRegistrationSchema = createRegistrationSchema
  .omit({ clinicId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

/** Blank is how an HTML form says "no filter", so "" is accepted throughout. */
const dateFilterSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isDateOnly(value), "Choose a valid date.")
  .optional();

export const registrationFilterSchema = z.object({
  // FR-3.3 — clinic, doctor, department, date range.
  clinicId: z.string().trim().max(64).optional(),
  doctorId: z.string().trim().max(64).optional(),
  department: z.string().trim().max(255).optional(),
  from: dateFilterSchema,
  to: dateFilterSchema,
  // FR-3.2 — patient name or phone number.
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
export type RegistrationFilters = z.infer<typeof registrationFilterSchema>;

type RawFilterInput = Record<string, string | string[] | undefined>;

/**
 * Validates filters coming off a query string or a page's `searchParams`.
 *
 * A repeated parameter (`?doctorId=a&doctorId=b`) takes the first value rather
 * than erroring — a filter is a convenience, and a malformed one should narrow
 * the list, never break the page.
 */
export function parseRegistrationFilters(
  input: RawFilterInput,
): RegistrationFilters {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return registrationFilterSchema.parse({
    clinicId: single(input.clinicId),
    doctorId: single(input.doctorId),
    department: single(input.department),
    from: single(input.from),
    to: single(input.to),
    search: single(input.search),
    page: single(input.page),
  });
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * One registration as every consumer sees it — list, detail, CSV export.
 *
 * `amount` and the dates are strings: a Prisma `Decimal` and a `Date` do not
 * survive the server/client component boundary, and the audit log compares
 * formatted text anyway.
 */
export interface RegistrationRecord {
  id: string;
  clinicId: string;
  clinicName: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  age: number | null;
  gender: string | null;
  mobileNumber: string;
  address: string | null;
  city: string | null;
  doctorId: string | null;
  doctorName: string | null;
  department: string;
  amount: string;
  visitDate: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  createdByEmail: string;
}

export interface RegistrationPage {
  rows: RegistrationRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EditLogEntry {
  id: string;
  editedByName: string | null;
  editedByEmail: string;
  /** Captured when the edit happened; not re-resolved from today's roles. */
  roleAtTime: string;
  timestamp: string;
  /** True for the first entry — the record as it was originally entered. */
  isCreation: boolean;
  changes: RenderedChange[];
}

const REGISTRATION_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  doctorId: true,
  department: true,
  amount: true,
  visitDate: true,
  createdAt: true,
  updatedAt: true,
  clinic: { select: { name: true } },
  doctor: { select: { name: true } },
  patient: {
    select: {
      patientCode: true,
      name: true,
      age: true,
      gender: true,
      mobileNumber: true,
      address: true,
      city: true,
    },
  },
  creator: { select: { name: true, email: true } },
} satisfies Prisma.RegistrationSelect;

type RegistrationRow = Prisma.RegistrationGetPayload<{
  select: typeof REGISTRATION_SELECT;
}>;

function toRecord(row: RegistrationRow): RegistrationRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinic.name,
    patientId: row.patientId,
    patientCode: row.patient.patientCode,
    patientName: row.patient.name,
    age: row.patient.age,
    gender: row.patient.gender,
    mobileNumber: row.patient.mobileNumber,
    address: row.patient.address,
    city: row.patient.city,
    doctorId: row.doctorId,
    doctorName: row.doctor?.name ?? null,
    department: row.department,
    amount: row.amount.toFixed(2),
    visitDate: formatDateOnly(row.visitDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.creator.name,
    createdByEmail: row.creator.email,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Empty strings from an HTML form mean "not set", which is null in the database. */
function blankToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value;
}

/** Matches the `Decimal(10, 2)` column, so stored and logged values agree. */
function toAmountString(amount: number): string {
  return amount.toFixed(2);
}

/** The day after `date`, so a `to` filter includes the whole of that day. */
function dayAfter(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/** Prisma's code for a unique-constraint violation. */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** `ChangedFields` is JSON-shaped, but the Json column's type needs telling. */
function toJsonValue(changed: ChangedFields): Prisma.InputJsonValue {
  return changed as unknown as Prisma.InputJsonValue;
}

function snapshotOf(record: RegistrationRecord): RegistrationSnapshot {
  return {
    patientName: record.patientName,
    age: record.age,
    gender: record.gender,
    mobileNumber: record.mobileNumber,
    address: record.address,
    city: record.city,
    doctor: record.doctorName,
    department: record.department,
    amount: record.amount,
    visitDate: record.visitDate,
  };
}

/**
 * The record as it will be *after* an update, used to diff against the current
 * one. An absent input field means "unchanged", which is why every branch tests
 * for `undefined` rather than falsiness — clearing a field sends "", not
 * nothing.
 */
function nextSnapshot(
  current: RegistrationSnapshot,
  input: UpdateRegistrationInput,
  /** undefined = the doctor was not part of this edit. */
  doctorName: string | null | undefined,
): RegistrationSnapshot {
  return {
    patientName: input.name ?? current.patientName,
    age: input.age === undefined ? current.age : (input.age ?? null),
    gender: input.gender === undefined ? current.gender : blankToNull(input.gender),
    mobileNumber: input.mobileNumber ?? current.mobileNumber,
    address: input.address === undefined ? current.address : blankToNull(input.address),
    city: input.city === undefined ? current.city : blankToNull(input.city),
    doctor: doctorName === undefined ? current.doctor : doctorName,
    department: input.department ?? current.department,
    amount: input.amount === undefined ? current.amount : toAmountString(input.amount),
    visitDate: input.visitDate ?? current.visitDate,
  };
}

/**
 * Resolves a doctor id against the clinic the registration belongs to.
 *
 * A doctor from another clinic is a 400, not a silent detach: the caller asked
 * for something that cannot be true, and the registration's revenue is
 * attributed by doctor (FR-6.4).
 */
async function resolveDoctor(
  clinicId: string,
  doctorId: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!doctorId) {
    return null;
  }

  const doctor = await prisma.doctor.findFirst({
    where: { id: doctorId, clinicId },
    select: { id: true, name: true },
  });

  if (!doctor) {
    throw new BadRequestError("That doctor is not at this clinic.");
  }

  return doctor;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a registration the actor may see, or throws ScopeError (→ 404).
 *
 * Another tenant's registration, an unknown id, and one in a clinic outside
 * this actor's roles all collapse to the same 404 — answering 403 for the last
 * case would confirm to a clinic-scoped Staff user that the record exists.
 */
async function assertRegistrationVisible(
  actor: ActorContext,
  registrationId: string,
): Promise<{ clinicId: string }> {
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, clinic: { tenantId: actor.tenantId } },
    select: { clinicId: true },
  });

  if (!registration) {
    throw new ScopeError();
  }

  if (!(await can(actor, "registration:read", registration.clinicId))) {
    throw new ScopeError();
  }

  return registration;
}

async function buildWhere(
  actor: ActorContext,
  filters: RegistrationFilters,
): Promise<Prisma.RegistrationWhereInput | null> {
  const clinicWhere = await clinicWhereForActor(
    actor,
    "registration:read",
    filters.clinicId,
  );

  if (!clinicWhere) {
    return null;
  }

  const where: Prisma.RegistrationWhereInput = { clinic: clinicWhere };

  // Both are plain filters — a doctor or department from outside the actor's
  // clinics simply matches nothing, because the clinic filter still applies.
  if (filters.doctorId) {
    where.doctorId = filters.doctorId;
  }

  if (filters.department) {
    where.department = filters.department;
  }

  if (filters.from || filters.to) {
    where.visitDate = {
      ...(filters.from ? { gte: parseDateOnly(filters.from) } : {}),
      // Exclusive upper bound on the next day, so the `to` day is included
      // whole even if a visit ever carries a time component.
      ...(filters.to ? { lt: dayAfter(parseDateOnly(filters.to)) } : {}),
    };
  }

  if (filters.search) {
    // FR-3.2. No `mode: "insensitive"` — that is Postgres-only; MySQL's default
    // collation already compares case-insensitively.
    where.patient = {
      OR: [
        { name: { contains: filters.search } },
        { mobileNumber: { contains: filters.search } },
      ],
    };
  }

  return where;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** FR-3.2 / FR-3.3 — one page of registrations the actor may read. */
export async function listRegistrationsForActor(
  actor: ActorContext,
  filters: RegistrationFilters,
): Promise<RegistrationPage> {
  const page = filters.page ?? 1;
  const where = await buildWhere(actor, filters);

  if (!where) {
    return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  const [total, rows] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      // Most recent visit first: the front desk works from today backwards.
      orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: REGISTRATION_SELECT,
    }),
  ]);

  return { rows: rows.map(toRecord), total, page, pageSize: PAGE_SIZE };
}

/** FR-3.4 — the same filtered set as the list, unpaginated up to the cap. */
export async function listRegistrationsForExport(
  actor: ActorContext,
  filters: RegistrationFilters,
): Promise<RegistrationRecord[]> {
  const where = await buildWhere(actor, filters);

  if (!where) {
    return [];
  }

  const rows = await prisma.registration.findMany({
    where,
    orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
    take: EXPORT_ROW_LIMIT,
    select: REGISTRATION_SELECT,
  });

  return rows.map(toRecord);
}

/** FR-3.3 — the departments actually in use, for the filter control. */
export async function listDepartmentsForActor(
  actor: ActorContext,
  clinicId?: string | null,
): Promise<string[]> {
  const clinicWhere = await clinicWhereForActor(
    actor,
    "registration:read",
    clinicId,
  );

  if (!clinicWhere) {
    return [];
  }

  const rows = await prisma.registration.findMany({
    where: { clinic: clinicWhere },
    distinct: ["department"],
    orderBy: { department: "asc" },
    // A filter dropdown past this length is unusable anyway.
    take: 200,
    select: { department: true },
  });

  return rows.map((row) => row.department);
}

export async function getRegistrationForActor(
  actor: ActorContext,
  registrationId: string,
): Promise<RegistrationRecord> {
  await assertRegistrationVisible(actor, registrationId);

  const row = await prisma.registration.findFirst({
    where: { id: registrationId, clinic: { tenantId: actor.tenantId } },
    select: REGISTRATION_SELECT,
  });

  if (!row) {
    throw new ScopeError();
  }

  return toRecord(row);
}

/**
 * FR-3.6 — the edit trail, newest first.
 *
 * Requires `registration:history:read`, which Staff deliberately do not hold:
 * they may edit a record (the edit is still logged) but not read the log back.
 * The 403 has to come from here, not from a hidden UI tab.
 */
export async function listEditHistoryForActor(
  actor: ActorContext,
  registrationId: string,
): Promise<EditLogEntry[]> {
  const { clinicId } = await assertRegistrationVisible(actor, registrationId);
  await requirePermission(actor, "registration:history:read", clinicId);

  const rows = await prisma.registrationEditLog.findMany({
    where: { registrationId },
    // Oldest first so the first row — the creation — can be marked as such;
    // reversed below for display. `id` breaks ties between entries written in
    // the same millisecond.
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    select: {
      id: true,
      roleAtTime: true,
      changedFields: true,
      timestamp: true,
      editedBy: { select: { name: true, email: true } },
    },
  });

  return rows
    .map((row, index) => ({
      id: row.id,
      editedByName: row.editedBy.name,
      editedByEmail: row.editedBy.email,
      roleAtTime: row.roleAtTime,
      timestamp: row.timestamp.toISOString(),
      isCreation: index === 0,
      changes: parseChangedFields(row.changedFields),
    }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * FR-3.1 — records a visit, creating the patient and their `PT-YYYY-####` code.
 *
 * NOTE (open question, flagged rather than guessed): the PRD's registration
 * form mints a Patient ID on every submission, so a repeat visit by the same
 * person currently creates a second patient record. Reusing an existing patient
 * for a return visit is not described in the PRD; if that is wanted, it belongs
 * here and in the form, not spread across call sites.
 */
export async function createRegistration(
  actor: ActorContext,
  input: CreateRegistrationInput,
): Promise<RegistrationRecord> {
  // Confirms the clinic is this tenant's *before* the permission check, so a
  // guessed id from another tenant cannot even reach it.
  await assertClinicInTenant(actor.tenantId, input.clinicId);
  await requirePermission(actor, "registration:create", input.clinicId);

  const doctor = await resolveDoctor(input.clinicId, input.doctorId);
  const roleAtTime = await resolveRoleNameAtTime(actor, input.clinicId);

  const created: RegistrationSnapshot = {
    patientName: input.name,
    age: input.age ?? null,
    gender: blankToNull(input.gender),
    mobileNumber: input.mobileNumber,
    address: blankToNull(input.address),
    city: blankToNull(input.city),
    doctor: doctor?.name ?? null,
    department: input.department,
    amount: toAmountString(input.amount),
    visitDate: input.visitDate,
  };

  const registrationId = await insertRegistration(actor, input, {
    doctorId: doctor?.id ?? null,
    roleAtTime,
    snapshot: created,
  });

  return getRegistrationForActor(actor, registrationId);
}

interface InsertOptions {
  doctorId: string | null;
  roleAtTime: string;
  snapshot: RegistrationSnapshot;
}

/**
 * The patient, the registration and the first log row, in one transaction.
 *
 * Retried on a unique-constraint violation: `generatePatientCode` only picks the
 * next candidate code, and two concurrent registrations can pick the same one.
 * The database index is the thing that guarantees uniqueness.
 */
async function insertRegistration(
  actor: ActorContext,
  input: CreateRegistrationInput,
  options: InsertOptions,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_PATIENT_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const patientCode = await generatePatientCode(tx, actor.tenantId);

        const patient = await tx.patient.create({
          data: {
            // Denormalised from the clinic so the tenant-wide uniqueness of
            // patient_code is enforceable by the database.
            tenantId: actor.tenantId,
            clinicId: input.clinicId,
            patientCode,
            name: input.name,
            age: input.age ?? null,
            gender: blankToNull(input.gender),
            mobileNumber: input.mobileNumber,
            address: blankToNull(input.address),
            city: blankToNull(input.city),
          },
          select: { id: true },
        });

        const registration = await tx.registration.create({
          data: {
            clinicId: input.clinicId,
            patientId: patient.id,
            doctorId: options.doctorId,
            department: input.department,
            amount: toAmountString(input.amount),
            visitDate: parseDateOnly(input.visitDate),
            createdBy: actor.userId,
          },
          select: { id: true },
        });

        await tx.registrationEditLog.create({
          data: {
            registrationId: registration.id,
            editedByUserId: actor.userId,
            roleAtTime: options.roleAtTime,
            changedFields: toJsonValue(diffSnapshots(null, options.snapshot)),
          },
        });

        return registration.id;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error) && attempt < MAX_PATIENT_CODE_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  throw new ConflictError(
    "Could not allocate a Patient ID just now. Try saving again.",
  );
}

/**
 * FR-3.5 / FR-3.6 — edits a registration and logs what changed.
 *
 * The update and its log row share one transaction, so a record can never be
 * changed without the trail recording it (PRD §9). An edit that changes nothing
 * is rejected rather than written, which keeps empty entries out of the log.
 */
export async function updateRegistration(
  actor: ActorContext,
  registrationId: string,
  input: UpdateRegistrationInput,
): Promise<RegistrationRecord> {
  const current = await getRegistrationForActor(actor, registrationId);
  await requirePermission(actor, "registration:edit", current.clinicId);

  const doctor =
    input.doctorId === undefined
      ? undefined
      : await resolveDoctor(current.clinicId, input.doctorId);

  const before = snapshotOf(current);
  const after = nextSnapshot(
    before,
    input,
    doctor === undefined ? undefined : (doctor?.name ?? null),
  );
  const changed = diffSnapshots(before, after);

  if (Object.keys(changed).length === 0) {
    throw new BadRequestError("Nothing was changed.");
  }

  const roleAtTime = await resolveRoleNameAtTime(actor, current.clinicId);

  await prisma.$transaction(async (tx) => {
    await tx.patient.update({
      where: { id: current.patientId },
      data: {
        name: after.patientName,
        age: after.age,
        gender: after.gender,
        mobileNumber: after.mobileNumber,
        address: after.address,
        city: after.city,
      },
    });

    await tx.registration.update({
      where: { id: registrationId },
      data: {
        ...(doctor === undefined ? {} : { doctorId: doctor?.id ?? null }),
        department: after.department,
        amount: after.amount,
        visitDate: parseDateOnly(after.visitDate),
      },
    });

    await tx.registrationEditLog.create({
      data: {
        registrationId,
        editedByUserId: actor.userId,
        // Denormalised on purpose: revoking the role later must not rewrite
        // what this person held when they made the edit.
        roleAtTime,
        changedFields: toJsonValue(changed),
      },
    });
  });

  return getRegistrationForActor(actor, registrationId);
}
