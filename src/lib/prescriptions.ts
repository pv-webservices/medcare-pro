import { prescriptionIssuedDateBounds } from "@/lib/prescriptionDates";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  can,
  ScopeError,
  PermissionError,
  requirePermission,
  type ActorContext,
} from "@/lib/rbac";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { writeAuditLog } from "@/lib/audit";
import { generatePrescriptionNumber } from "@/lib/prescriptionNumber";
import {
  consultationSchema,
  medicationSchema,
  prescriptionDraftSchema,
  issuedContentSchema,
  issuePrescriptionSchema,
  cancelPrescriptionSchema,
  prescriptionFiltersSchema,
  prescriptionSnapshotSchema,
  type PrescriptionDraftInput,
  type PrescriptionSnapshot,
} from "@/lib/prescriptionValidation";

const visitInclude = {
  patient: true,
  doctor: true,
  clinic: {
    include: { telephonyConfig: { select: { publicPhoneNumber: true } } },
  },
} satisfies Prisma.RegistrationInclude;
const rxInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  supersedes: { select: { id: true, prescriptionNumber: true } },
  supersededBy: {
    select: { id: true, prescriptionNumber: true, status: true },
  },
} satisfies Prisma.PrescriptionInclude;
type Visit = Prisma.RegistrationGetPayload<{ include: typeof visitInclude }>;
type Rx = Prisma.PrescriptionGetPayload<{ include: typeof rxInclude }>;

async function visitForActor(
  actor: ActorContext,
  registrationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Visit> {
  const clinic = await clinicWhereForActor(
    actor,
    "prescription:read",
    undefined,
    tx,
  );
  if (!clinic) throw new ScopeError();
  const visit = await tx.registration.findFirst({
    where: { id: registrationId, clinic },
    include: visitInclude,
  });
  if (!visit || visit.patient.tenantId !== actor.tenantId)
    throw new ScopeError();
  return visit;
}

async function rxForActor(
  actor: ActorContext,
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Rx> {
  const clinic = await clinicWhereForActor(
    actor,
    "prescription:read",
    undefined,
    tx,
  );
  if (!clinic) throw new ScopeError();
  const rx = await tx.prescription.findFirst({
    where: { id, tenantId: actor.tenantId, clinic },
    include: rxInclude,
  });
  if (!rx) throw new ScopeError();
  return rx;
}

function assertVisitOwnership(rx: Rx, visit: Visit) {
  if (
    rx.registrationId !== visit.id ||
    rx.clinicId !== visit.clinicId ||
    rx.patientId !== visit.patientId ||
    rx.doctorId !== visit.doctorId ||
    visit.doctor?.clinicId !== visit.clinicId
  ) {
    throw new ConflictError(
      "The visit's clinical assignment changed. Restore the original assigned doctor before continuing this consultation.",
    );
  }
}

async function assertPrescribingDoctor(
  actor: ActorContext,
  visit: Visit,
  tx: Prisma.TransactionClient,
) {
  // Administrative wildcard privileges NEVER substitute for clinician identity.
  if (
    !visit.doctor ||
    visit.doctor.userId !== actor.userId ||
    visit.doctor.clinicId !== visit.clinicId
  )
    throw new PermissionError("linked assigned Doctor identity");
  await requirePermission(actor, "prescription:issue", visit.clinicId, tx);
}

function assertDraft(rx: Rx, expectedRevision?: number) {
  if (rx.status !== "DRAFT")
    throw new ConflictError(
      "This prescription is immutable. Create a corrected version instead.",
    );
  if (expectedRevision !== undefined && rx.revision !== expectedRevision)
    throw new ConflictError(
      "This draft changed in another session. Reload and review the latest version.",
    );
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  action: string,
  rx: Pick<
    Rx,
    | "id"
    | "registrationId"
    | "patientId"
    | "doctorId"
    | "clinicId"
    | "prescriptionNumber"
    | "status"
  >,
) {
  await writeAuditLog(tx, {
    action,
    targetType: "Prescription",
    targetId: rx.id,
    actorUserId: actor.userId,
    actorTenantId: actor.tenantId,
    afterValue: {
      prescriptionId: rx.id,
      prescriptionNumber: rx.prescriptionNumber,
      registrationId: rx.registrationId,
      patientId: rx.patientId,
      doctorId: rx.doctorId,
      clinicId: rx.clinicId,
      status: rx.status,
    },
  });
}

/** Every clinical write locks the visit FIRST, including corrections/cancel.
 * Serializes lifecycle transitions; revision additionally protects stale tabs.
 */
async function withVisitLock<T>(
  actor: ActorContext,
  registrationId: string,
  work: (tx: Prisma.TransactionClient, visit: Visit) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await requireModule(actor, MODULE_FEATURES.prescriptions, tx);
      const visible = await visitForActor(actor, registrationId, tx);
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.id} FOR UPDATE`;
      const visit = await visitForActor(actor, registrationId, tx);
      return work(tx, visit);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15000,
    },
  );
}

function medicationInputs(rx: Rx) {
  return rx.items.map((item) =>
    medicationSchema.parse({
      medicineGenericName: item.medicineGenericName,
      brandName: item.brandName,
      dosageForm: item.dosageForm,
      strength: item.strength,
      dose: item.dose,
      route: item.route,
      frequency: item.frequency,
      timing: item.timing,
      durationValue: item.durationValue,
      durationUnit: item.durationUnit,
      quantity: item.quantity,
      instructions: item.instructions,
    }),
  );
}

export async function getConsultationForRegistration(
  actor: ActorContext,
  registrationId: string,
) {
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const visit = await visitForActor(actor, registrationId);
  const rx = await prisma.prescription.findFirst({
    where: { registrationId, tenantId: actor.tenantId },
    orderBy: { version: "desc" },
    include: rxInclude,
  });
  const mayDraft = await can(actor, "prescription:draft", visit.clinicId);
  return {
    context: {
      patient: {
        id: visit.patient.id,
        patientCode: visit.patient.patientCode,
        name: visit.patient.name,
        age: visit.patient.age,
        gender: visit.patient.gender,
        mobileNumber: visit.patient.mobileNumber,
        address: visit.patient.address,
        city: visit.patient.city,
      },
      doctor: visit.doctor
        ? {
            id: visit.doctor.id,
            name: visit.doctor.name,
            department: visit.doctor.department,
            qualification: visit.doctor.qualification,
            medicalRegistrationNumber: visit.doctor.medicalRegistrationNumber,
            registrationCouncil: visit.doctor.registrationCouncil,
            phone: visit.doctor.phone,
          }
        : null,
      clinic: {
        id: visit.clinic.id,
        name: visit.clinic.name,
        address: visit.clinic.address,
        city: visit.clinic.city,
        logoUrl: visit.clinic.logoUrl,
        phone: visit.clinic.telephonyConfig?.publicPhoneNumber ?? null,
      },
      visit: {
        registrationId: visit.id,
        visitDate: visit.visitDate.toISOString(),
        department: visit.department,
        visitType: visit.visitType,
      },
    },
    prescription: rx
      ? {
          id: rx.id,
          status: rx.status,
          version: rx.version,
          revision: rx.revision,
          consultation: consultationSchema.parse(rx.clinicalJson),
          medications: medicationInputs(rx),
        }
      : null,
    mayDraft,
    mayIssue:
      visit.doctor?.userId === actor.userId &&
      (await can(actor, "prescription:issue", visit.clinicId)),
  };
}

export type ConsultationWorkspaceData = Awaited<
  ReturnType<typeof getConsultationForRegistration>
>;

export async function saveConsultationDraft(
  actor: ActorContext,
  registrationId: string,
  raw: PrescriptionDraftInput,
) {
  const input = prescriptionDraftSchema.parse(raw);
  return withVisitLock(actor, registrationId, async (tx, visit) => {
    await requirePermission(actor, "prescription:draft", visit.clinicId, tx);
    if (!visit.doctor || visit.doctor.clinicId !== visit.clinicId)
      throw new BadRequestError(
        "Assign a doctor from this clinic to the visit before starting a consultation.",
      );
    const consultation = await tx.clinicalConsultation.findUnique({
      where: { registrationId },
    });
    const current = await tx.prescription.findFirst({
      where: { registrationId, tenantId: actor.tenantId },
      orderBy: { version: "desc" },
      include: rxInclude,
    });
    if (current) {
      assertVisitOwnership(current, visit);
      assertDraft(current, input.expectedRevision);
    } else if (input.expectedRevision !== 0)
      throw new ConflictError("The draft changed. Reload this visit.");
    if (
      consultation &&
      (consultation.patientId !== visit.patientId ||
        consultation.doctorId !== visit.doctorId ||
        consultation.clinicId !== visit.clinicId ||
        consultation.tenantId !== actor.tenantId)
    )
      throw new ConflictError(
        "Consultation ownership does not match this visit.",
      );
    const owner = {
      tenantId: actor.tenantId,
      clinicId: visit.clinicId,
      patientId: visit.patientId,
      doctorId: visit.doctor.id,
      registrationId,
    };
    const encounter =
      consultation ??
      (await tx.clinicalConsultation.create({
        data: { ...owner, ...input.consultation, createdById: actor.userId },
      }));
    // Only the original encounter draft is mutable. Revised notes live on Rx.
    if (encounter.status === "DRAFT")
      await tx.clinicalConsultation.update({
        where: { id: encounter.id },
        data: input.consultation,
      });
    const rx = current
      ? await tx.prescription.update({
          where: { id: current.id },
          data: {
            clinicalJson: input.consultation,
            revision: { increment: 1 },
          },
        })
      : await tx.prescription.create({
          data: {
            ...owner,
            consultationId: encounter.id,
            activeDraftKey: registrationId,
            clinicalJson: input.consultation,
            revision: 1,
          },
        });
    await tx.prescriptionItem.deleteMany({ where: { prescriptionId: rx.id } });
    if (input.medications.length)
      await tx.prescriptionItem.createMany({
        data: input.medications.map((item, sortOrder) => ({
          ...item,
          sortOrder,
          prescriptionId: rx.id,
        })),
      });
    if (!consultation) await audit(tx, actor, "CONSULTATION_CREATED", rx);
    await audit(
      tx,
      actor,
      current ? "CONSULTATION_UPDATED" : "PRESCRIPTION_DRAFT_CREATED",
      rx,
    );
    return { id: rx.id, revision: rx.revision };
  });
}

export function buildPrescriptionSnapshot(
  visit: Visit,
  rx: Rx,
  number: string,
  issuedAt: Date,
): PrescriptionSnapshot {
  const doctor = visit.doctor;
  if (
    !doctor?.qualification?.trim() ||
    !doctor.medicalRegistrationNumber?.trim() ||
    !doctor.registrationCouncil?.trim()
  )
    throw new BadRequestError(
      "Complete the doctor's professional profile before issuing prescriptions.",
    );
  const content = issuedContentSchema.parse({
    consultation: consultationSchema.parse(rx.clinicalJson),
    medications: medicationInputs(rx),
    expectedRevision: rx.revision,
  });
  return prescriptionSnapshotSchema.parse({
    schemaVersion: 1,
    prescriptionNumber: number,
    issuedAt: issuedAt.toISOString(),
    patient: {
      id: visit.patient.id,
      patientCode: visit.patient.patientCode,
      name: visit.patient.name,
      age: visit.patient.age,
      gender: visit.patient.gender,
      mobileNumber: visit.patient.mobileNumber,
      address: visit.patient.address,
      city: visit.patient.city,
    },
    doctor: {
      id: doctor.id,
      name: doctor.name,
      department: doctor.department,
      qualification: doctor.qualification,
      medicalRegistrationNumber: doctor.medicalRegistrationNumber,
      registrationCouncil: doctor.registrationCouncil,
      phone: doctor.phone,
    },
    clinic: {
      id: visit.clinic.id,
      name: visit.clinic.name,
      address: visit.clinic.address,
      city: visit.clinic.city,
      logoUrl: visit.clinic.logoUrl,
      phone: visit.clinic.telephonyConfig?.publicPhoneNumber ?? null,
    },
    visit: {
      registrationId: visit.id,
      visitDate: visit.visitDate.toISOString(),
      department: visit.department,
      visitType: visit.visitType,
    },
    consultation: content.consultation,
    medications: content.medications,
  });
}

export async function issuePrescription(
  actor: ActorContext,
  id: string,
  raw: unknown,
) {
  const input = issuePrescriptionSchema.parse(raw);
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const visible = await rxForActor(actor, id);
  // Unique-number collisions and deadlocks retry the WHOLE transaction.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withVisitLock(
        actor,
        visible.registrationId,
        async (tx, visit) => {
          const rx = await rxForActor(actor, id, tx);
          assertVisitOwnership(rx, visit);
          await assertPrescribingDoctor(actor, visit, tx);
          assertDraft(rx, input.expectedRevision);
          const consultation = await tx.clinicalConsultation.findFirst({
            where: {
              id: rx.consultationId,
              tenantId: actor.tenantId,
              registrationId: visit.id,
              clinicId: visit.clinicId,
              patientId: visit.patientId,
              doctorId: visit.doctorId!,
            },
          });
          if (!consultation) throw new ScopeError();
          const issuedAt = new Date();
          const number = generatePrescriptionNumber(issuedAt);
          const snapshot = buildPrescriptionSnapshot(
            visit,
            rx,
            number,
            issuedAt,
          );
          if (rx.supersedesPrescriptionId) {
            const old = await rxForActor(
              actor,
              rx.supersedesPrescriptionId,
              tx,
            );
            if (
              old.status !== "ISSUED" ||
              old.consultationId !== rx.consultationId
            )
              throw new ConflictError(
                "The original prescription is no longer eligible for correction.",
              );
            const oldResult = await tx.prescription.updateMany({
              where: { id: old.id, status: "ISSUED" },
              data: { status: "SUPERSEDED" },
            });
            if (oldResult.count !== 1)
              throw new ConflictError("The original prescription changed.");
            await audit(tx, actor, "PRESCRIPTION_SUPERSEDED", {
              ...old,
              status: "SUPERSEDED",
            });
          }
          const result = await tx.prescription.updateMany({
            where: {
              id: rx.id,
              status: "DRAFT",
              revision: input.expectedRevision,
            },
            data: {
              status: "ISSUED",
              prescriptionNumber: number,
              issuedAt,
              issuedByUserId: actor.userId,
              snapshotJson: snapshot,
              activeDraftKey: null,
              revision: { increment: 1 },
            },
          });
          if (result.count !== 1)
            throw new ConflictError(
              "This draft was already changed or issued.",
            );
          await tx.clinicalConsultation.updateMany({
            where: { id: rx.consultationId, status: "DRAFT" },
            data: { status: "FINALIZED" },
          });
          await audit(tx, actor, "PRESCRIPTION_ISSUED", {
            ...rx,
            prescriptionNumber: number,
            status: "ISSUED",
          });
          return { id: rx.id, prescriptionNumber: number };
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code) &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new ConflictError(
    "Could not allocate a prescription number. Try again.",
  );
}

export async function createCorrectedPrescription(
  actor: ActorContext,
  id: string,
) {
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const visible = await rxForActor(actor, id);
  return withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const old = await rxForActor(actor, id, tx);
    assertVisitOwnership(old, visit);
    await requirePermission(actor, "prescription:draft", visit.clinicId, tx);
    await assertPrescribingDoctor(actor, visit, tx);
    if (old.status !== "ISSUED")
      throw new ConflictError(
        "Only the current issued prescription can be corrected.",
      );
    if (old.supersededBy)
      throw new ConflictError(
        "A corrected version already exists. Open that version instead.",
      );
    const frozen = prescriptionSnapshotSchema.parse(old.snapshotJson);
    const rx = await tx.prescription.create({
      data: {
        tenantId: actor.tenantId,
        clinicId: old.clinicId,
        registrationId: old.registrationId,
        consultationId: old.consultationId,
        patientId: old.patientId,
        doctorId: old.doctorId,
        version: old.version + 1,
        activeDraftKey: old.registrationId,
        supersedesPrescriptionId: old.id,
        clinicalJson: frozen.consultation,
        items: {
          create: frozen.medications.map((item, sortOrder) => ({
            ...item,
            sortOrder,
          })),
        },
      },
    });
    await audit(tx, actor, "PRESCRIPTION_CORRECTION_CREATED", rx);
    return { id: rx.id, registrationId: rx.registrationId };
  });
}

export async function cancelPrescription(
  actor: ActorContext,
  id: string,
  raw: unknown,
) {
  const input = cancelPrescriptionSchema.parse(raw);
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const visible = await rxForActor(actor, id);
  return withVisitLock(actor, visible.registrationId, async (tx, visit) => {
    const rx = await rxForActor(actor, id, tx);
    await requirePermission(actor, "prescription:cancel", visit.clinicId, tx);
    if (rx.status !== "ISSUED" || rx.supersededBy?.status === "DRAFT")
      throw new ConflictError(
        "Only a current issued prescription without a pending correction can be cancelled.",
      );
    await tx.prescription.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actor.userId,
        cancellationReason: input.reason,
      },
    });
    // Cancellation reason is clinical record data, never copied to broad audit.
    await audit(tx, actor, "PRESCRIPTION_CANCELLED", {
      ...rx,
      status: "CANCELLED",
    });
    return { id };
  });
}

export async function getPrescriptionForActor(actor: ActorContext, id: string) {
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const rx = await rxForActor(actor, id);
  return {
    id: rx.id,
    status: rx.status,
    registrationId: rx.registrationId,
    version: rx.version,
    prescriptionNumber: rx.prescriptionNumber,
    issuedAt: rx.issuedAt?.toISOString() ?? null,
    cancelledAt: rx.cancelledAt?.toISOString() ?? null,
    cancellationReason: rx.cancellationReason,
    supersedes: rx.supersedes,
    supersededBy: rx.supersededBy,
    snapshot:
      rx.status === "DRAFT"
        ? null
        : prescriptionSnapshotSchema.parse(rx.snapshotJson),
    mayCorrect:
      rx.status === "ISSUED" &&
      !rx.supersededBy &&
      (await can(actor, "prescription:draft", rx.clinicId)) &&
      (await can(actor, "prescription:issue", rx.clinicId)) &&
      Boolean(
        await prisma.doctor.findFirst({
          where: {
            id: rx.doctorId,
            userId: actor.userId,
            clinicId: rx.clinicId,
            clinic: { tenantId: actor.tenantId },
          },
          select: { id: true },
        }),
      ),
    mayCancel:
      rx.status === "ISSUED" &&
      !rx.supersededBy &&
      (await can(actor, "prescription:cancel", rx.clinicId)),
  };
}
export type PrescriptionDetailData = Awaited<
  ReturnType<typeof getPrescriptionForActor>
>;

export async function listPrescriptionsForActor(
  actor: ActorContext,
  raw: unknown = {},
) {
  const filters = prescriptionFiltersSchema.parse(raw);
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const clinic = await clinicWhereForActor(
    actor,
    "prescription:read",
    filters.clinicId,
  );
  if (!clinic)
    return {
      rows: [],
      total: 0,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  // Reads are clinic-wide by explicit permission, matching Registration reads.
  // Role names do not grant implicit clinical read or issuance authority.
  const where: Prisma.PrescriptionWhereInput = {
    tenantId: actor.tenantId,
    clinic,
    ...(filters.patientId ? { patientId: filters.patientId } : {}),
    ...(filters.registrationId
      ? { registrationId: filters.registrationId }
      : {}),
    ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? { issuedAt: prescriptionIssuedDateBounds(filters.from, filters.to) }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { prescriptionNumber: { contains: filters.q } },
            { patient: { name: { contains: filters.q } } },
            { patient: { patientCode: { contains: filters.q } } },
            { doctor: { name: { contains: filters.q } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.prescription.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        registrationId: true,
        prescriptionNumber: true,
        status: true,
        version: true,
        issuedAt: true,
        updatedAt: true,
        patient: { select: { name: true, patientCode: true } },
        doctor: { select: { name: true } },
        clinic: { select: { name: true } },
      },
    }),
    prisma.prescription.count({ where }),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function listPatientPrescriptions(
  actor: ActorContext,
  patientId: string,
  page = 1,
) {
  return listPrescriptionsForActor(actor, { patientId, page });
}

export async function getPrescriptionFilterOptions(actor: ActorContext) {
  await requireModule(actor, MODULE_FEATURES.prescriptions);
  const clinic = await clinicWhereForActor(actor, "prescription:read");
  if (!clinic) return { clinics: [], doctors: [] };
  const [clinics, doctors] = await Promise.all([
    prisma.clinic.findMany({
      where: clinic,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.doctor.findMany({
      where: { clinic },
      select: { id: true, name: true, clinicId: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  return { clinics, doctors };
}
