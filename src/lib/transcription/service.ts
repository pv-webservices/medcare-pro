import { randomUUID } from "node:crypto";
import { Prisma, type TranscriptionRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordingForActor } from "@/lib/clinical-audio/recordingService";
import { getRecordingStorageProvider } from "@/lib/clinical-audio/storage";
import { writeAuditLog } from "@/lib/audit";
import { ConflictError } from "@/lib/apiHandler";
import { getSarvamBatchConfig } from "./batchConfig";
import { TranscriptionFailure } from "./errors";
import { ACTIVE_TRANSCRIPTION_STATUSES } from "./types";
export { ACTIVE_TRANSCRIPTION_STATUSES } from "./types";
import type { ActorContext } from "@/lib/rbac";

export async function requestTranscription(actor: ActorContext, recordingId: string) {
  const visible = await retainedRecording(actor, recordingId);
  getSarvamBatchConfig();
  let head;
  try { head = await getRecordingStorageProvider().headObject({ key: visible.storageKey! }); } catch { throw new TranscriptionFailure("SOURCE_MISSING"); }
  if (BigInt(head.size) !== visible.byteSize) throw new TranscriptionFailure("SOURCE_MISSING");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.registrationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${recordingId} FOR UPDATE`;
    const recording = await retainedRecording(actor, recordingId, tx);
    const existing = await tx.transcriptionRun.findUnique({ where: { activeKey: recordingId } });
    if (existing) {
      if (existing.provider !== "SARVAM" || existing.model !== "saaras:v4") throw new TranscriptionFailure("CONFIGURATION");
      return { run: publicRun(existing), created: false };
    }
    const run = await tx.transcriptionRun.create({ data: { tenantId: actor.tenantId, clinicId: recording.clinicId, registrationId: recording.registrationId, recordingId, requestedByUserId: actor.userId, activeKey: recordingId, provider: "SARVAM", model: "saaras:v4", mode: "VERBATIM", requestedSpeakerCount: 2, audioDurationMs: recording.durationMs, audioBytes: recording.byteSize } });
    await transcriptionAudit(tx, actor, run, "requested");
    return { run: publicRun(run), created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function claimNextTranscriptionRun(workerId: string, tenantId?: string) {
  if (!workerId || workerId.length > 128) throw new TranscriptionFailure("CONFIGURATION");
  const now = new Date();
  const scope = tenantId ?? null;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM transcription_runs
      WHERE provider = 'SARVAM' AND status IN ('QUEUED','PREPARING','SUBMITTED','PROCESSING')
      AND (${scope} IS NULL OR tenant_id = ${scope})
      AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
      ORDER BY queued_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    const run = await tx.transcriptionRun.findUniqueOrThrow({ where: { id: rows[0].id } });
    return tx.transcriptionRun.update({ where: { id: run.id }, data: { ...(run.status === "QUEUED" ? { status: "PREPARING", startedAt: run.startedAt ?? now } : {}), lockedBy: workerId, leaseToken: randomUUID(), lockedAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export const LEASE_MS = 120_000;
export function publicRun(run: TranscriptionRun, transcriptId?: string | null) {
  return { id: run.id, recordingId: run.recordingId, provider: run.provider, model: run.model, status: run.status, failureCode: run.failureCode, queuedAt: run.queuedAt, completedAt: run.completedAt, transcriptId: transcriptId ?? null };
}
export async function transcriptionAudit(tx: Prisma.TransactionClient, actor: ActorContext, run: TranscriptionRun, event: string, metadata: Record<string, string | number | boolean | null> = {}) {
  await writeAuditLog(tx, { action: `clinical-transcription.${event}`, targetType: "TranscriptionRun", targetId: run.id, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { runId: run.id, recordingId: run.recordingId, provider: run.provider, status: run.status, ...metadata } });
}
export async function retainedRecording(actor: ActorContext, recordingId: string, tx: Prisma.TransactionClient = prisma) {
  const recording = await recordingForActor(actor, recordingId, "clinical-ai:transcription", tx, false);
  if (recording.consent.withdrawnAt) throw new TranscriptionFailure("CONSENT_INVALID");
  if (recording.status !== "READY" || recording.audioDeletedAt || !recording.storageKey || !recording.durationMs || !recording.byteSize || (recording.audioDeleteAfter && recording.audioDeleteAfter <= new Date())) throw new TranscriptionFailure("SOURCE_MISSING");
  return recording;
}
export async function latestTranscription(actor: ActorContext, recordingId: string) {
  await recordingForActor(actor, recordingId, "clinical-ai:transcript-read", prisma, false);
  const run = await prisma.transcriptionRun.findFirst({ where: { recordingId, tenantId: actor.tenantId }, orderBy: [{ queuedAt: "desc" }, { id: "desc" }], include: { transcript: { select: { id: true } } } });
  return run ? publicRun(run, run.transcript?.id) : null;
}
export async function fencedRunUpdate(run: TranscriptionRun, data: Prisma.TranscriptionRunUpdateManyMutationInput) {
  const changed = await prisma.transcriptionRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, lockedBy: run.lockedBy, leaseExpiresAt: { gt: new Date() }, status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] } }, data });
  if (changed.count !== 1) throw new ConflictError("Transcription lease lost.");
}
