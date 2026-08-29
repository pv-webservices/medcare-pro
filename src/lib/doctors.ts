import { z } from "zod";
import { ConflictError } from "@/lib/apiHandler";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { notifyDoctorCreated, notifyDoctorUpdated } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  assertClinicInTenant,
  can,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  formatDateOnly,
  isBefore,
  isClockTime,
  isDateOnly,
  parseDateOnly,
  todayDateOnly,
} from "@/lib/dates";

/**
 * Doctor data access — PRD §6.4 (FR-4.1 … FR-4.4).
 *
 * Doctors hang off a clinic, so every read and write here resolves through the
 * actor's clinic scope exactly as src/lib/clinics.ts does: a doctor in a clinic
 * you cannot see is a 404, not a 403.
 *
 * The PRD describes adding, listing and viewing doctors plus managing their
 * availability and leave. There is deliberately no delete — `registrations`
 * references `doctors` with onDelete: Restrict precisely so a doctor cannot be
 * removed out from under the revenue history FR-6.4 breaks down by doctor.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91)?[0-9]{10}$/, "Enter a valid 10-digit Indian phone number.")
  .max(13);

export const createDoctorSchema = z.object({
  // FR-4.2 — "Clinic Location (which clinic they belong to)".
  clinicId: z.string().min(1, "Choose a clinic."),
  name: z.string().trim().min(1, "Enter the doctor's name.").max(255),
  department: z.string().trim().min(1, "Enter a department.").max(255),
  // Free text in the database; the UI offers a short list but the column does
  // not constrain it, so adding an option later needs no migration.
  gender: z.string().trim().max(50).optional().or(z.literal("")),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  phone: phoneSchema.optional().or(z.literal("")),
});

/** Clinic is omitted: moving a doctor between clinics would re-home their
 *  registrations and availability, which the PRD does not describe. */
export const updateDoctorSchema = createDoctorSchema
  .omit({ clinicId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

export const availabilitySchema = z
  .object({
    date: z.string().refine(isDateOnly, "Choose a valid date."),
    startTime: z.string().refine(isClockTime, "Use a 24-hour time like 09:00."),
    endTime: z.string().refine(isClockTime, "Use a 24-hour time like 17:30."),
  })
  .refine((value) => isBefore(value.startTime, value.endTime), {
    message: "The end time must be after the start time.",
    path: ["endTime"],
  });

export const leaveSchema = z
  .object({
    startDate: z.string().refine(isDateOnly, "Choose a valid start date."),
    endDate: z.string().refine(isDateOnly, "Choose a valid end date."),
    reason: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "The end date cannot be before the start date.",
    path: ["endDate"],
  });

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type LeaveInput = z.infer<typeof leaveSchema>;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface DoctorSummary {
  id: string;
  clinicId: string;
  clinicName: string;
  name: string;
  department: string;
  gender: string | null;
  age: number | null;
  phone: string | null;
  /** FR-4.4 — true when today falls inside a leave period. */
  isOnLeaveToday: boolean;
}

export interface AvailabilityEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface LeaveEntry {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export interface DoctorDetail extends DoctorSummary {
  availability: AvailabilityEntry[];
  leave: LeaveEntry[];
}

function emptyToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a doctor the actor is allowed to see, or throws ScopeError (→ 404).
 *
 * Returns the owning clinic id so callers can run permission checks against the
 * right clinic without a second query.
 */
async function assertDoctorVisible(
  actor: ActorContext,
  doctorId: string,
): Promise<{ clinicId: string }> {
  const doctor = await prisma.doctor.findFirst({
    // Reached through the clinic, so a doctor in another tenant is simply not found.
    where: { id: doctorId, clinic: { tenantId: actor.tenantId } },
    select: { clinicId: true },
  });

  if (!doctor) {
    throw new ScopeError();
  }

  if (!(await can(actor, "doctor:read", doctor.clinicId))) {
    throw new ScopeError();
  }

  return doctor;
}

/** Visible plus editable. 404 if unseen, 403 if seen but not editable. */
async function assertDoctorEditable(
  actor: ActorContext,
  doctorId: string,
): Promise<{ clinicId: string }> {
  const doctor = await assertDoctorVisible(actor, doctorId);
  await requirePermission(actor, "doctor:edit", doctor.clinicId);
  return doctor;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * FR-4.1 — doctors the actor may read, optionally narrowed to one clinic.
 *
 * `clinicId` here is the clinic *filter* (the switcher's selection). It is
 * intersected with the actor's own scope rather than trusted: asking for a
 * clinic outside that scope yields nothing instead of widening the result.
 */
export async function listDoctorsForActor(
  actor: ActorContext,
  options: { clinicId?: string | null } = {},
): Promise<DoctorSummary[]> {
  const clinicWhere = await clinicWhereForActor(
    actor,
    "doctor:read",
    options.clinicId,
  );

  if (!clinicWhere) {
    return [];
  }

  const today = parseDateOnly(todayDateOnly());

  const doctors = await prisma.doctor.findMany({
    where: { clinic: clinicWhere },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      clinicId: true,
      name: true,
      department: true,
      gender: true,
      age: true,
      phone: true,
      clinic: { select: { name: true } },
      // Only need to know whether at least one leave period covers today.
      leave: {
        where: { startDate: { lte: today }, endDate: { gte: today } },
        select: { id: true },
        take: 1,
      },
    },
  });

  return doctors.map(({ clinic, leave, ...doctor }) => ({
    ...doctor,
    clinicName: clinic.name,
    isOnLeaveToday: leave.length > 0,
  }));
}

/** FR-4.3 / FR-4.4 — a doctor with their availability and leave. */
export async function getDoctorForActor(
  actor: ActorContext,
  doctorId: string,
): Promise<DoctorDetail> {
  await assertDoctorVisible(actor, doctorId);

  const doctor = await prisma.doctor.findFirstOrThrow({
    where: { id: doctorId, clinic: { tenantId: actor.tenantId } },
    select: {
      id: true,
      clinicId: true,
      name: true,
      department: true,
      gender: true,
      age: true,
      phone: true,
      clinic: { select: { name: true } },
      availability: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        select: { id: true, date: true, startTime: true, endTime: true },
      },
      leave: {
        orderBy: [{ startDate: "asc" }],
        select: { id: true, startDate: true, endDate: true, reason: true },
      },
    },
  });

  const today = todayDateOnly();

  return {
    id: doctor.id,
    clinicId: doctor.clinicId,
    clinicName: doctor.clinic.name,
    name: doctor.name,
    department: doctor.department,
    gender: doctor.gender,
    age: doctor.age,
    phone: doctor.phone,
    isOnLeaveToday: doctor.leave.some(
      (entry) =>
        formatDateOnly(entry.startDate) <= today &&
        formatDateOnly(entry.endDate) >= today,
    ),
    availability: doctor.availability.map((entry) => ({
      id: entry.id,
      date: formatDateOnly(entry.date),
      startTime: entry.startTime,
      endTime: entry.endTime,
    })),
    leave: doctor.leave.map((entry) => ({
      id: entry.id,
      startDate: formatDateOnly(entry.startDate),
      endDate: formatDateOnly(entry.endDate),
      reason: entry.reason,
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** FR-4.2 — adds a doctor to one of the actor's clinics. */
export async function createDoctor(
  actor: ActorContext,
  input: CreateDoctorInput,
): Promise<DoctorSummary> {
  // Confirms the clinic is this tenant's *before* the permission check, so a
  // guessed id from another tenant cannot even reach it.
  await assertClinicInTenant(actor.tenantId, input.clinicId);
  await requirePermission(actor, "doctor:create", input.clinicId);

  const doctor = await prisma.doctor.create({
    data: {
      clinicId: input.clinicId,
      name: input.name,
      department: input.department,
      gender: emptyToNull(input.gender) ?? null,
      age: input.age ?? null,
      phone: emptyToNull(input.phone) ?? null,
    },
    select: {
      id: true,
      clinicId: true,
      name: true,
      department: true,
      gender: true,
      age: true,
      phone: true,
      clinic: { select: { name: true } },
    },
  });

  const { clinic, ...rest } = doctor;

  // FR-7.1 — after the write, and never allowed to fail it.
  await notifyDoctorCreated(actor, {
    doctorId: doctor.id,
    doctorName: doctor.name,
    clinicId: doctor.clinicId,
    clinicName: clinic.name,
  });

  return { ...rest, clinicName: clinic.name, isOnLeaveToday: false };
}

export async function updateDoctor(
  actor: ActorContext,
  doctorId: string,
  input: UpdateDoctorInput,
): Promise<DoctorDetail> {
  await assertDoctorEditable(actor, doctorId);

  await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.department === undefined ? {} : { department: input.department }),
      ...(input.gender === undefined ? {} : { gender: emptyToNull(input.gender) }),
      ...(input.age === undefined ? {} : { age: input.age }),
      ...(input.phone === undefined ? {} : { phone: emptyToNull(input.phone) }),
    },
  });

  const updated = await getDoctorForActor(actor, doctorId);

  // FR-7.1. Availability and leave writes deliberately raise nothing: they are
  // day-to-day scheduling entries, not modifications to the doctor's record,
  // and notifying on each one would bury the record changes this feed exists
  // to surface.
  await notifyDoctorUpdated(actor, {
    doctorId,
    doctorName: updated.name,
    clinicId: updated.clinicId,
    clinicName: updated.clinicName,
  });

  return updated;
}

/**
 * FR-4.3 — adds one availability window.
 *
 * Overlapping windows on the same date are rejected. The PRD does not spell
 * this out, but two overlapping slots for one doctor is a data-entry mistake
 * with no meaningful reading, and it would show up as duplicated capacity on
 * every screen that lists availability.
 */
export async function addAvailability(
  actor: ActorContext,
  doctorId: string,
  input: AvailabilityInput,
): Promise<AvailabilityEntry> {
  await assertDoctorEditable(actor, doctorId);

  const date = parseDateOnly(input.date);

  const sameDay = await prisma.doctorAvailability.findMany({
    where: { doctorId, date },
    select: { startTime: true, endTime: true },
  });

  // Half-open comparison: 09:00-12:00 and 12:00-15:00 are adjacent, not overlapping.
  const overlaps = sameDay.some(
    (slot) => input.startTime < slot.endTime && slot.startTime < input.endTime,
  );

  if (overlaps) {
    throw new ConflictError(
      "That overlaps an availability window already set for this date.",
    );
  }

  const created = await prisma.doctorAvailability.create({
    data: { doctorId, date, startTime: input.startTime, endTime: input.endTime },
    select: { id: true, date: true, startTime: true, endTime: true },
  });

  return {
    id: created.id,
    date: formatDateOnly(created.date),
    startTime: created.startTime,
    endTime: created.endTime,
  };
}

export async function removeAvailability(
  actor: ActorContext,
  doctorId: string,
  entryId: string,
): Promise<void> {
  await assertDoctorEditable(actor, doctorId);

  // Scoped by doctorId as well as id, so an entry belonging to another doctor
  // cannot be deleted by passing its id here.
  const deleted = await prisma.doctorAvailability.deleteMany({
    where: { id: entryId, doctorId },
  });

  if (deleted.count === 0) {
    throw new ScopeError();
  }
}

/** FR-4.4 — records a leave period. */
export async function addLeave(
  actor: ActorContext,
  doctorId: string,
  input: LeaveInput,
): Promise<LeaveEntry> {
  await assertDoctorEditable(actor, doctorId);

  const created = await prisma.doctorLeave.create({
    data: {
      doctorId,
      startDate: parseDateOnly(input.startDate),
      endDate: parseDateOnly(input.endDate),
      reason: emptyToNull(input.reason) ?? null,
    },
    select: { id: true, startDate: true, endDate: true, reason: true },
  });

  return {
    id: created.id,
    startDate: formatDateOnly(created.startDate),
    endDate: formatDateOnly(created.endDate),
    reason: created.reason,
  };
}

export async function removeLeave(
  actor: ActorContext,
  doctorId: string,
  entryId: string,
): Promise<void> {
  await assertDoctorEditable(actor, doctorId);

  const deleted = await prisma.doctorLeave.deleteMany({
    where: { id: entryId, doctorId },
  });

  if (deleted.count === 0) {
    throw new ScopeError();
  }
}
