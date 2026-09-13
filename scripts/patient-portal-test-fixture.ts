import {
  createPrescriptionFixture,
  assertPrescriptionTestDatabase,
} from "./prescription-test-fixture";
import { prisma } from "@/lib/prisma";
import {
  consultationSchema,
  medicationSchema,
} from "@/lib/prescriptionValidation";
import {
  saveConsultationDraft,
  issuePrescription,
  createCorrectedPrescription,
  cancelPrescription,
} from "@/lib/prescriptions";
export function assertPatientPortalTestDatabase() {
  assertPrescriptionTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.startsWith("/medcare_ep_portal_"))
    throw new Error(
      "Patient Portal tests require a dedicated disposable local medcare_ep_portal_ database.",
    );
}
export async function createPatientPortalFixture() {
  assertPatientPortalTestDatabase();
  const f = await createPrescriptionFixture(prisma);
  await prisma.userRole.updateMany({
    where: { userId: f.otherDoctorUser.id },
    data: { clinicId: f.otherClinic.id },
  });
  const number = `9${String(Date.now()).slice(-9)}`;
  await prisma.patient.update({
    where: { id: f.patient.id },
    data: { mobileNumber: number },
  });
  await prisma.patient.update({
    where: { id: f.patientB.id },
    data: { mobileNumber: number },
  });
  await prisma.userRole.updateMany({
    where: { userId: f.receptionist.id },
    data: { clinicId: f.clinic.id },
  });
  const managerRole = await prisma.role.create({
    data: {
      tenantId: f.tenant.id,
      name: `Portal manager ${f.patient.id}`,
      permissions: ["patient_portal:manage"],
    },
  });
  await prisma.userRole.create({
    data: {
      userId: f.receptionist.id,
      roleId: managerRole.id,
      clinicId: f.clinic.id,
    },
  });
  const content = {
    consultation: consultationSchema.parse({
      diagnosis: "Synthetic portal diagnosis",
      advice: "Synthetic advice",
      followUpInstructions: "Synthetic follow-up",
      investigationNotes: "Synthetic investigations",
    }),
    medications: [
      medicationSchema.parse({
        medicineGenericName: "Synthetic medicine",
        dosageForm: "Tablet",
        dose: "1",
        route: "Oral",
        frequency: "Once daily",
        durationValue: 3,
        durationUnit: "days",
      }),
    ],
    expectedRevision: 0,
  };
  async function rx(visit: { id: string }, actor = f.doctorUser.actor) {
    const d = await saveConsultationDraft(actor, visit.id, content);
    return issuePrescription(actor, d.id, { expectedRevision: d.revision });
  }
  const visit = await f.visit();
  const issued = await rx(visit);
  const draftVisit = await f.visit();
  const draft = await saveConsultationDraft(
    f.doctorUser.actor,
    draftVisit.id,
    content,
  );
  const supersededVisit = await f.visit();
  const superseded = await rx(supersededVisit);
  const correction = await createCorrectedPrescription(
    f.doctorUser.actor,
    superseded.id,
  );
  const latest = await issuePrescription(f.doctorUser.actor, correction.id, {
    expectedRevision: 0,
  });
  const cancelledVisit = await f.visit();
  const cancelled = await rx(cancelledVisit);
  await cancelPrescription(f.admin.actor, cancelled.id, {
    reason: "Synthetic test cancellation",
  });
  const visitB = await f.visitB();
  const rxB = await rx(visitB, f.otherDoctorUser.actor);
  const visitC = await f.visitC();
  const rxC = await rx(visitC, f.foreignDoctorUser.actor);
  async function appointment(
    patient: typeof f.patient,
    doctor: typeof f.doctor,
    clinic: typeof f.clinic,
    tenantId: string,
    patientId: string | null = patient.id,
  ) {
    const type = await prisma.appointmentType.create({
      data: {
        tenantId,
        clinicId: clinic.id,
        name: `Synthetic ${patientId ?? "unlinked"}`,
        defaultAmount: 100,
        durationMinutes: 20,
      },
    });
    return prisma.appointment.create({
      data: {
        tenantId,
        clinicId: clinic.id,
        patientId,
        doctorId: doctor.id,
        appointmentTypeId: type.id,
        name: patient.name,
        mobileNumber: number,
        amount: 100,
        slotStart: new Date("2026-10-01T10:00:00Z"),
        slotEnd: new Date("2026-10-01T10:20:00Z"),
        activeSlotStart: null,
      },
    });
  }
  const appointmentA = await appointment(
    f.patient,
    f.doctor,
    f.clinic,
    f.tenant.id,
  );
  const appointmentB = await appointment(
    f.patientB,
    f.otherDoctor,
    f.otherClinic,
    f.tenant.id,
  );
  const appointmentC = await appointment(
    f.patientC,
    f.foreignDoctor,
    f.foreignClinic,
    f.foreignTenant.id,
  );
  const unlinked = await appointment(
    f.patient,
    f.doctor,
    f.clinic,
    f.tenant.id,
    null,
  );
  return {
    ...f,
    number,
    visitA: visit,
    visitBRow: visitB,
    visitCRow: visitC,
    issued,
    draft,
    superseded,
    latest,
    cancelled,
    rxB,
    rxC,
    appointmentA,
    appointmentB,
    appointmentC,
    unlinked,
  };
}
