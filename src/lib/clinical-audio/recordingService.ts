import {
  Prisma,
  type ConsultationRecording,
  type ConsultationRecordingEventType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/apiHandler";
import { ScopeError, type ActorContext } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { authorizeClinicalAudio, type AudioPermission } from "./authorization";
import { getClinicalAudioConfig } from "./config";
import { RecordingStateError } from "./errors";
import { getRecordingStorageProvider } from "./storage";

export const consentSchema = z.strictObject({
  attested: z.literal(true),
  method: z.enum(["VERBAL", "WRITTEN", "DIGITAL"]),
  consenterType: z.enum(["PATIENT", "GUARDIAN", "AUTHORIZED_REPRESENTATIVE"]),
});
export const eventSchema = z.strictObject({
  clientElapsedMs: z.number().int().min(0).max(86_400_000),
  mimeType: z.string().max(128).optional(),
});
export function publicRecording(r: ConsultationRecording) {
  return {
    id: r.id,
    registrationId: r.registrationId,
    status: r.status,
    mimeType: r.mimeType,
    durationMs: r.durationMs,
    byteSize: r.byteSize === null ? null : Number(r.byteSize),
    audioDeletedAt: r.audioDeletedAt,
    audioDeleteAfter: r.audioDeleteAfter,
    createdAt: r.createdAt,
    version: r.version,
  };
}
export async function audioAudit(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  r: ConsultationRecording,
  event: string,
) {
  await writeAuditLog(tx, {
    action: "clinical-audio." + event,
    targetType: "ConsultationRecording",
    targetId: r.id,
    actorUserId: actor.userId,
    actorTenantId: actor.tenantId,
    afterValue: {
      recordingId: r.id,
      registrationId: r.registrationId,
      status: r.status,
      event,
    },
  });
}
export async function recordingForActor(
  actor: ActorContext,
  recordingId: string,
  permission: AudioPermission,
  tx: Prisma.TransactionClient = prisma,
  editable?: boolean,
) {
  const recording = await tx.consultationRecording.findFirst({
    where: { id: recordingId, tenantId: actor.tenantId },
    include: { consent: true },
  });
  if (!recording) throw new ScopeError();
  const visit = await authorizeClinicalAudio(
    actor,
    recording.registrationId,
    permission,
    tx,
    editable,
  );
  if (
    recording.clinicId !== visit.clinicId ||
    recording.patientId !== visit.patientId ||
    recording.doctorId !== visit.doctorId ||
    recording.consent.tenantId !== actor.tenantId ||
    recording.consent.registrationId !== visit.id ||
    recording.consent.doctorId !== recording.doctorId ||
    recording.consent.patientId !== recording.patientId ||
    recording.consent.clinicId !== recording.clinicId
  )
    throw new ScopeError();
  return recording;
}
export async function withRecordingLock<T>(
  actor: ActorContext,
  id: string,
  work: (
    tx: Prisma.TransactionClient,
    r: Awaited<ReturnType<typeof recordingForActor>>,
  ) => Promise<T>,
  editable = true,
) {
  return prisma.$transaction(
    async (tx) => {
      const visible = await recordingForActor(
        actor,
        id,
        "clinical-ai:recording",
        tx,
        editable,
      );
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.registrationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${id} FOR UPDATE`;
      const r = await recordingForActor(
        actor,
        id,
        "clinical-ai:recording",
        tx,
        editable,
      );
      return work(tx, r);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30000,
    },
  );
}
export async function createRecording(
  actor: ActorContext,
  registrationId: string,
  raw: unknown,
) {
  const input = consentSchema.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      await authorizeClinicalAudio(
        actor,
        registrationId,
        "clinical-ai:recording",
        tx,
      );
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registrationId} FOR UPDATE`;
      const visit = await authorizeClinicalAudio(
        actor,
        registrationId,
        "clinical-ai:recording",
        tx,
      );
      if (
        await tx.consultationRecording.findUnique({
          where: { activeKey: registrationId },
          select: { id: true },
        })
      )
        throw new ConflictError(
          "This visit already has an unfinished recording. Recover or discard it first.",
        );
      const ownership = {
        tenantId: actor.tenantId,
        clinicId: visit.clinicId,
        registrationId,
        patientId: visit.patientId,
        doctorId: visit.doctorId!,
      };
      const consent = await tx.consultationRecordingConsent.create({
        data: {
          ...ownership,
          capturedByUserId: actor.userId,
          method: input.method,
          consenterType: input.consenterType,
          consentedAt: new Date(),
        },
      });
      const r = await tx.consultationRecording.create({
        data: {
          ...ownership,
          createdByUserId: actor.userId,
          consentId: consent.id,
          activeKey: registrationId,
        },
      });
      await audioAudit(tx, actor, r, "consent-attested");
      return {
        ...publicRecording(r),
        maxMinutes: getClinicalAudioConfig()!.maxMinutes,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30000,
    },
  );
}
export async function transitionRecording(
  actor: ActorContext,
  id: string,
  action: "start" | "pause" | "resume" | "stop",
  raw: unknown,
) {
  const input = eventSchema.parse(raw);
  return withRecordingLock(actor, id, async (tx, r) => {
    if (r.consent.withdrawnAt)
      throw new RecordingStateError("Consent has been withdrawn.");
    const type: ConsultationRecordingEventType = {
      start: "START",
      pause: "PAUSE",
      resume: "RESUME",
      stop: "STOP",
    }[action] as ConsultationRecordingEventType;
    const last = await tx.consultationRecordingEvent.findFirst({
      where: { recordingId: id },
      orderBy: { createdAt: "desc" },
    });
    if (
      (action === "stop" &&
        ["STOPPED", "UPLOADING", "READY"].includes(r.status)) ||
      last?.type === type
    )
      return publicRecording(r);
    const allowed = {
      start: ["CREATED"],
      pause: ["RECORDING"],
      resume: ["PAUSED"],
      stop: ["RECORDING", "PAUSED"],
    };
    if (!allowed[action].includes(r.status))
      throw new RecordingStateError(
        "Recording state changed. Reload or recover the captured audio.",
      );
    if (
      action === "start" &&
      (!input.mimeType || !ALLOWED_AUDIO_MIME.includes(input.mimeType))
    )
      throw new RecordingStateError("Unsupported recording audio format.");
    const limit = getClinicalAudioConfig()!.maxMinutes * 60_000;
    if (input.clientElapsedMs > limit)
      throw new RecordingStateError(
        "The recording exceeds the configured duration limit.",
      );
    const result = await tx.consultationRecording.update({
      where: { id },
      data: {
        status:
          action === "pause"
            ? "PAUSED"
            : action === "stop"
              ? "STOPPED"
              : "RECORDING",
        version: { increment: 1 },
        ...(action === "start"
          ? { startedAt: new Date(), mimeType: input.mimeType }
          : {}),
        ...(action === "stop"
          ? { stoppedAt: new Date(), durationMs: input.clientElapsedMs }
          : {}),
        events: { create: { type, clientElapsedMs: input.clientElapsedMs } },
      },
    });
    await audioAudit(tx, actor, result, action);
    return publicRecording(result);
  });
}
export const ALLOWED_AUDIO_MIME = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];
export async function withdrawRecordingConsent(
  actor: ActorContext,
  id: string,
  raw: unknown,
) {
  const input = eventSchema.parse(raw);
  const cleanup: { uploadId?: string; key?: string } = {};
  const result = await withRecordingLock(
    actor,
    id,
    async (tx, r) => {
      if (r.uploadId && r.storageKey) {
        cleanup.uploadId = r.uploadId;
        cleanup.key = r.storageKey;
      }
      if (r.status === "ABORTED" && r.consent.withdrawnAt)
        return publicRecording(r);
      if (["READY", "FAILED", "ABORTED"].includes(r.status))
        throw new RecordingStateError("This recording is no longer active.");
      await tx.consultationRecordingConsent.update({
        where: { id: r.consentId },
        data: { withdrawnAt: new Date(), withdrawnByUserId: actor.userId },
      });
      const result = await tx.consultationRecording.update({
        where: { id },
        data: {
          status: "ABORTED",
          activeKey: null,
          stoppedAt: new Date(),
          version: { increment: 1 },
          events: {
            create: {
              type: "CONSENT_WITHDRAWN",
              clientElapsedMs: input.clientElapsedMs,
            },
          },
        },
      });
      await audioAudit(tx, actor, result, "consent-withdrawn");
      return publicRecording(result);
    },
    false,
  );
  // Withdrawal is durable before provider I/O: storage downtime must never
  // roll consent back or permit finalization. Repeated withdrawal retries cleanup.
  if (cleanup.uploadId && cleanup.key) {
    const storage = getRecordingStorageProvider();
    await storage.abortMultipartUpload({
      key: cleanup.key,
      uploadId: cleanup.uploadId,
    });
    await storage.deleteObject({ key: cleanup.key });
  }
  return result;
}
export async function listRecordings(
  actor: ActorContext,
  registrationId: string,
) {
  await authorizeClinicalAudio(
    actor,
    registrationId,
    "clinical-ai:recording",
    prisma,
    false,
  );
  return (
    await prisma.consultationRecording.findMany({
      where: { registrationId, tenantId: actor.tenantId },
      orderBy: { createdAt: "desc" },
    })
  ).map(publicRecording);
}
