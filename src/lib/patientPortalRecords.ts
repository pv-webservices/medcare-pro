import { prisma } from "@/lib/prisma";
import type { PatientActorContext } from "@/lib/patientPortalSession";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
import { prescriptionSnapshotSchema } from "@/lib/prescriptionValidation";

export const PATIENT_RX_STATUSES = [
  "ISSUED",
  "SUPERSEDED",
  "CANCELLED",
] as const;
/** Every service read rechecks live session authority. Callers cannot turn a
 * previously resolved actor into a durable authorization grant after revocation.
 */
async function recordActor(actor: PatientActorContext) {
  const live = await prisma.patientPortalSession.findFirst({
    where: {
      id: actor.sessionId,
      portalAccountId: actor.portalAccountId,
      linkId: actor.linkId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      portalAccount: { status: "ACTIVE" },
      link: {
        revokedAt: null,
        accessType: "SELF",
        patientId: actor.patientId,
        tenantId: actor.tenantId,
        activePatientId: actor.patientId,
        activeAccountId: actor.portalAccountId,
        patient: { tenantId: actor.tenantId },
      },
    },
    select: { id: true },
  });
  if (!live)
    throw new PatientPortalError(401, "Please sign in to your Patient Portal.");
  await requirePatientPortalEntitlement(actor.tenantId);
}
export async function patientPortalProfile(actor: PatientActorContext) {
  await recordActor(actor);
  const row = await prisma.patient.findFirst({
    where: { id: actor.patientId, tenantId: actor.tenantId },
    select: {
      patientCode: true,
      name: true,
      age: true,
      gender: true,
      mobileNumber: true,
      city: true,
      address: true,
    },
  });
  if (!row) throw new PatientPortalError(404, "Not found.");
  return row;
}
const visitSelect = {
  id: true,
  visitDate: true,
  visitType: true,
  department: true,
  clinic: { select: { name: true } },
  doctor: { select: { name: true } },
  patient: { select: { patientCode: true } },
} as const;
const appointmentSelect = {
  id: true,
  slotStart: true,
  slotEnd: true,
  status: true,
  clinic: { select: { name: true } },
  doctor: { select: { name: true } },
  appointmentType: { select: { name: true } },
} as const;
const rxSelect = { id: true, status: true, snapshotJson: true } as const;
export function patientPrescriptionDto(row: {
  id: string;
  status: string;
  snapshotJson: unknown;
}) {
  if (!PATIENT_RX_STATUSES.some((status) => status === row.status))
    throw new PatientPortalError(404, "Not found.");
  const parsed = prescriptionSnapshotSchema.safeParse(row.snapshotJson);
  if (!parsed.success) throw new PatientPortalError(404, "Not found.");
  const s = parsed.data;
  // Explicit allowlist. Private clinician fields added later are not inherited.
  return {
    id: row.id,
    status: row.status,
    prescriptionNumber: s.prescriptionNumber,
    issuedAt: s.issuedAt,
    clinic: {
      name: s.clinic.name,
      address: s.clinic.address,
      city: s.clinic.city,
      phone: s.clinic.phone,
    },
    doctor: {
      name: s.doctor.name,
      department: s.doctor.department,
      qualification: s.doctor.qualification,
      medicalRegistrationNumber: s.doctor.medicalRegistrationNumber,
      registrationCouncil: s.doctor.registrationCouncil,
    },
    patient: {
      patientCode: s.patient.patientCode,
      name: s.patient.name,
      age: s.patient.age,
      gender: s.patient.gender,
      mobileNumber: s.patient.mobileNumber,
      address: s.patient.address,
      city: s.patient.city,
    },
    visit: {
      visitDate: s.visit.visitDate,
      department: s.visit.department,
      visitType: s.visit.visitType,
    },
    diagnosis: s.consultation.diagnosis,
    investigations: s.consultation.investigationNotes,
    advice: s.consultation.advice,
    followUp: s.consultation.followUpInstructions,
    medications: s.medications.map((m) => ({
      medicineGenericName: m.medicineGenericName,
      brandName: m.brandName,
      dosageForm: m.dosageForm,
      strength: m.strength,
      dose: m.dose,
      route: m.route,
      frequency: m.frequency,
      timing: m.timing,
      durationValue: m.durationValue,
      durationUnit: m.durationUnit,
      quantity: m.quantity,
      instructions: m.instructions,
    })),
  };
}
const visitWhere = (actor: PatientActorContext) => ({
  patientId: actor.patientId,
  patient: { tenantId: actor.tenantId },
  clinic: { tenantId: actor.tenantId },
});
const appointmentWhere = (actor: PatientActorContext) => ({
  patientId: actor.patientId,
  tenantId: actor.tenantId,
  patient: { tenantId: actor.tenantId },
  clinic: { tenantId: actor.tenantId },
});
const rxWhere = (actor: PatientActorContext) => ({
  patientId: actor.patientId,
  tenantId: actor.tenantId,
  patient: { tenantId: actor.tenantId },
  clinic: { tenantId: actor.tenantId },
  status: { in: [...PATIENT_RX_STATUSES] },
});
export async function patientOwnedRegistration(
  actor: PatientActorContext,
  id: string,
) {
  await recordActor(actor);
  const row = await prisma.registration.findFirst({
    where: { ...visitWhere(actor), id },
    select: visitSelect,
  });
  if (!row) throw new PatientPortalError(404, "Not found.");
  return {
    id: row.id,
    date: row.visitDate.toISOString(),
    type: row.visitType,
    department: row.department,
    clinic: row.clinic.name,
    doctor: row.doctor?.name ?? null,
    patientCode: row.patient.patientCode,
  };
}
export async function patientOwnedAppointment(
  actor: PatientActorContext,
  id: string,
) {
  await recordActor(actor);
  const row = await prisma.appointment.findFirst({
    where: { ...appointmentWhere(actor), id },
    select: appointmentSelect,
  });
  if (!row) throw new PatientPortalError(404, "Not found.");
  return {
    id: row.id,
    date: row.slotStart.toISOString(),
    end: row.slotEnd.toISOString(),
    status: row.status,
    clinic: row.clinic.name,
    doctor: row.doctor.name,
    type: row.appointmentType.name,
  };
}
export async function patientOwnedPrescription(
  actor: PatientActorContext,
  id: string,
  event: "PRESCRIPTION_VIEWED" | "PRESCRIPTION_PRINTED" = "PRESCRIPTION_VIEWED",
) {
  await recordActor(actor);
  const row = await prisma.prescription.findFirst({
    where: { ...rxWhere(actor), id },
    select: rxSelect,
  });
  if (!row) throw new PatientPortalError(404, "Not found.");
  const dto = patientPrescriptionDto(row);
  const latest =
    row.status === "SUPERSEDED"
      ? await prisma.prescription.findFirst({
          where: { ...rxWhere(actor), supersedesPrescriptionId: id },
          select: { id: true },
        })
      : null;
  await prisma.patientPortalAuditEvent.create({
    data: {
      portalAccountId: actor.portalAccountId,
      tenantId: actor.tenantId,
      event,
      resourceId: id,
      status: row.status,
    },
  });
  return { ...dto, latestId: latest?.id ?? null };
}
/** Twenty records per page; only summaries leave this history loader. */
export async function patientPortalHistory(
  actor: PatientActorContext,
  kind: "visits" | "appointments" | "prescriptions",
  page = 1,
) {
  await recordActor(actor);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new PatientPortalError(400, "Invalid page.");
  const pagination = { take: 21, skip: (page - 1) * 20 };
  if (kind === "visits") {
    const rows = await prisma.registration.findMany({
      where: visitWhere(actor),
      select: visitSelect,
      orderBy: [{ visitDate: "desc" }, { id: "desc" }],
      ...pagination,
    });
    return {
      page,
      hasMore: rows.length > 20,
      items: rows
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          date: r.visitDate.toISOString(),
          clinic: r.clinic.name,
          doctor: r.doctor?.name ?? "Clinic team",
          type: r.visitType,
          department: r.department,
        })),
    };
  }
  if (kind === "appointments") {
    const rows = await prisma.appointment.findMany({
      where: appointmentWhere(actor),
      select: appointmentSelect,
      orderBy: [{ slotStart: "desc" }, { id: "desc" }],
      ...pagination,
    });
    return {
      page,
      hasMore: rows.length > 20,
      items: rows
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          date: r.slotStart.toISOString(),
          clinic: r.clinic.name,
          doctor: r.doctor.name,
          type: r.appointmentType.name,
          status: r.status,
        })),
    };
  }
  const rows = await prisma.prescription.findMany({
    where: rxWhere(actor),
    select: rxSelect,
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    ...pagination,
  });
  return {
    page,
    hasMore: rows.length > 20,
    items: rows.slice(0, 20).flatMap((r) => {
      try {
        const dto = patientPrescriptionDto(r);
        return [
          {
            id: dto.id,
            date: dto.issuedAt,
            clinic: dto.clinic.name,
            doctor: dto.doctor.name,
            type: dto.prescriptionNumber,
            status: dto.status,
          },
        ];
      } catch {
        return [];
      }
    }),
  };
}
