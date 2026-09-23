import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import {
  PermissionError,
  ScopeError,
  requirePermission,
  type ActorContext,
} from "@/lib/rbac";
import { getClinicalAudioConfig } from "./config";
import { ClinicalAudioDisabledError } from "./errors";

export type AudioPermission =
  | "clinical-ai:recording"
  | "clinical-ai:transcription"
  | "clinical-ai:transcript-read"
  | "clinical-ai:facts-extract"
  | "clinical-ai:facts-review";
export async function authorizeClinicalAudio(
  actor: ActorContext,
  registrationId: string,
  permission: AudioPermission,
  tx: Prisma.TransactionClient = prisma,
  editable = permission !== "clinical-ai:transcript-read",
) {
  if (process.env.AI_ENABLED !== "true" || !getClinicalAudioConfig())
    throw new ClinicalAudioDisabledError();
  const user = await tx.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      tenant: { status: "ACTIVE", isPlatform: false },
    },
    select: { id: true },
  });
  if (!user) throw new PermissionError("active clinical actor");
  const visit = await tx.registration.findFirst({
    where: { id: registrationId, clinic: { tenantId: actor.tenantId } },
    include: {
      patient: { select: { tenantId: true, clinicId: true } },
      doctor: { select: { id: true, userId: true, clinicId: true } },
      clinicalConsultation: {
        select: {
          status: true,
          consultationMode: true,
          doctorId: true,
          patientId: true,
          clinicId: true,
        },
      },
    },
  });
  if (
    !visit ||
    visit.patient.tenantId !== actor.tenantId ||
    visit.patient.clinicId !== visit.clinicId
  )
    throw new ScopeError();
  await requirePermission(actor, permission, visit.clinicId, tx);
  await requirePermission(
    actor,
    editable ? "prescription:draft" : "prescription:read",
    visit.clinicId,
    tx,
  );
  await requireModule(actor, MODULE_FEATURES.clinical_ai, tx);
  await requireModule(actor, MODULE_FEATURES.prescriptions, tx);
  if (
    !visit.doctor ||
    visit.doctor.userId !== actor.userId ||
    visit.doctor.clinicId !== visit.clinicId
  )
    throw new PermissionError("linked assigned Doctor identity");
  if (editable) {
    const current = await tx.prescription.findFirst({
      where: { registrationId, tenantId: actor.tenantId },
      orderBy: { version: "desc" },
      select: { status: true, doctorId: true, clinicId: true, patientId: true },
    });
    if (
      (visit.clinicalConsultation &&
        (visit.clinicalConsultation.status !== "DRAFT" ||
          visit.clinicalConsultation.consultationMode !== "IN_PERSON" ||
          visit.clinicalConsultation.doctorId !== visit.doctorId ||
          visit.clinicalConsultation.patientId !== visit.patientId ||
          visit.clinicalConsultation.clinicId !== visit.clinicId)) ||
      (current &&
        (current.status !== "DRAFT" ||
          current.doctorId !== visit.doctorId ||
          current.clinicId !== visit.clinicId ||
          current.patientId !== visit.patientId))
    )
      throw new ScopeError();
  }
  return visit;
}
export async function mayUseClinicalAudio(
  actor: ActorContext,
  registrationId: string,
) {
  try {
    await authorizeClinicalAudio(
      actor,
      registrationId,
      "clinical-ai:recording",
    );
    return true;
  } catch (error) {
    if (
      error instanceof ClinicalAudioDisabledError ||
      error instanceof ScopeError ||
      error instanceof PermissionError ||
      (error instanceof Error && error.name === "FeatureError")
    )
      return false;
    throw error;
  }
}
