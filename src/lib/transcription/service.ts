import { Prisma, TranscriptionProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeClinicalAudio } from "@/lib/clinical-audio/authorization";
import { getTranscriptionConfig } from "./config";
import type { ActorContext } from "@/lib/rbac";

export async function requestTranscription(actor: ActorContext, recordingId: string) {
  const recording = await prisma.consultationRecording.findFirst({ where: { id: recordingId, tenantId: actor.tenantId }, select: { id: true, registrationId: true, clinicId: true, status: true, storageKey: true, durationMs: true, byteSize: true } });
  if (!recording || recording.status !== "READY" || !recording.storageKey) throw new Error("RECORDING_NOT_READY");
  const visit = await authorizeClinicalAudio(actor, recording.registrationId, "clinical-ai:transcription");
  const config = getTranscriptionConfig(); if (!config) throw new Error("TRANSCRIPTION_NOT_CONFIGURED");
  const provider = config.primary === "sarvam" ? TranscriptionProvider.SARVAM : TranscriptionProvider.GEMINI;
  const existing = await prisma.transcriptionRun.findFirst({ where: { recordingId, status: { in: ["QUEUED", "PREPARING", "SUBMITTED", "PROCESSING"] } }, select: { id: true } });
  if (existing) return existing;
  return prisma.transcriptionRun.create({ data: { tenantId: actor.tenantId, clinicId: visit.clinicId, registrationId: recording.registrationId, recordingId, requestedByUserId: actor.userId, provider, model: provider === "SARVAM" ? config.sarvamModel : config.geminiModel, mode: "VERBATIM", requestedSpeakerCount: 2, audioDurationMs: recording.durationMs, audioBytes: recording.byteSize }, select: { id: true, provider: true, model: true, status: true } });
}

export async function claimNextTranscriptionRun(workerId: string) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.transcriptionRun.findFirst({ where: { status: "QUEUED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, orderBy: { queuedAt: "asc" } });
    if (!run) return null;
    const updated = await tx.transcriptionRun.updateMany({ where: { id: run.id, status: "QUEUED" }, data: { status: "PREPARING", lockedBy: workerId, lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 10 * 60_000), startedAt: new Date() } });
    return updated.count === 1 ? tx.transcriptionRun.findUnique({ where: { id: run.id } }) : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
