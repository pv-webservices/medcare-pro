import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getRecordingStorageProvider, type RecordingStorageProvider } from "./storage";
import { ACTIVE_TRANSCRIPTION_STATUSES, LEASE_MS } from "@/lib/transcription/service";
import { GeminiTranscriptionProvider } from "@/lib/transcription/providers/gemini";
export const RETENTION_PROCESSING_GRACE_MS = 24 * 60 * 60_000;
export async function cleanupAudioOnce(storage: RecordingStorageProvider = getRecordingStorageProvider(), tenantId?: string) {
  const now = new Date();
  const scope = tenantId ?? null;
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM consultation_recordings WHERE status = 'READY' AND (${scope} IS NULL OR tenant_id = ${scope}) AND audio_deleted_at IS NULL AND audio_delete_after <= ${now} AND (audio_cleanup_lease_expires_at IS NULL OR audio_cleanup_lease_expires_at <= ${now}) AND (audio_cleanup_next_attempt_at IS NULL OR audio_cleanup_next_attempt_at <= ${now}) ORDER BY audio_delete_after LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    const recording = await tx.consultationRecording.findUniqueOrThrow({ where: { id: rows[0].id } });
    const active = await tx.transcriptionRun.count({ where: { recordingId: recording.id, tenantId: recording.tenantId, status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] } } });
    if (active) {
      if (now.getTime() < recording.audioDeleteAfter!.getTime() + RETENTION_PROCESSING_GRACE_MS) {
        await tx.consultationRecording.update({ where: { id: recording.id }, data: { audioCleanupNextAttemptAt: new Date(Date.now() + 60_000) } });
        return null;
      }
      // Fence stuck jobs, then wait one full lease interval before touching bytes.
      await tx.transcriptionRun.updateMany({ where: { recordingId: recording.id, tenantId: recording.tenantId, status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] } }, data: { status: "TIMED_OUT", failureCode: "TIMEOUT", activeKey: null, completedAt: now, leaseToken: null, leaseExpiresAt: null, lockedBy: null, lockedAt: null } });
      await tx.consultationRecording.update({ where: { id: recording.id }, data: { audioCleanupNextAttemptAt: new Date(Date.now() + LEASE_MS) } });
      return null;
    }
    return tx.consultationRecording.update({ where: { id: recording.id }, data: { audioCleanupToken: randomUUID(), audioCleanupLeaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  });
  if (!claimed) return 0;
  try {
    if (!claimed.storageKey) throw new Error("SOURCE_METADATA_MISSING");
    try { await storage.deleteObject({ key: claimed.storageKey }); } catch (error) { if (!(error instanceof Error) || !["NoSuchKey", "NotFound", "OBJECT_NOT_FOUND"].includes(error.name) && error.message !== "OBJECT_NOT_FOUND") throw error; }
    await prisma.$transaction(async tx => {
      const changed = await tx.consultationRecording.updateMany({ where: { id: claimed.id, tenantId: claimed.tenantId, audioCleanupToken: claimed.audioCleanupToken, audioCleanupLeaseExpiresAt: { gt: new Date() }, audioDeletedAt: null }, data: { audioDeletedAt: new Date(), audioCleanupToken: null, audioCleanupLeaseExpiresAt: null, audioCleanupNextAttemptAt: null } });
      if (changed.count) await writeAuditLog(tx, { action: "CLINICAL_AUDIO_RETENTION_DELETED", targetType: "ConsultationRecording", targetId: claimed.id, actorUserId: claimed.createdByUserId, actorTenantId: claimed.tenantId, afterValue: { recordingId: claimed.id } });
    });
  } catch {
    await prisma.$transaction(async tx => {
      const changed = await tx.consultationRecording.updateMany({ where: { id: claimed.id, tenantId: claimed.tenantId, audioCleanupToken: claimed.audioCleanupToken }, data: { audioCleanupLeaseExpiresAt: null, audioCleanupNextAttemptAt: new Date(Date.now() + 60_000) } });
      if (changed.count) await writeAuditLog(tx, { action: "CLINICAL_AUDIO_RETENTION_DELETE_FAILED", targetType: "ConsultationRecording", targetId: claimed.id, actorUserId: claimed.createdByUserId, actorTenantId: claimed.tenantId, afterValue: { recordingId: claimed.id, retryScheduled: true } });
    });
  }
  return 1;
}
export async function cleanupProviderArtifactOnce(provider?: Pick<GeminiTranscriptionProvider, "deleteFile">, tenantId?: string) {
  const now = new Date();
  const scope = tenantId ?? null;
  // Reuse the existing fenced run lease; active jobs cannot be claimed for cleanup.
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM transcription_runs WHERE provider = 'GEMINI' AND (${scope} IS NULL OR tenant_id = ${scope}) AND status NOT IN ('QUEUED','PREPARING','SUBMITTED','PROCESSING') AND provider_artifact_delete_pending_at IS NOT NULL AND provider_artifact_deleted_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ${now}) ORDER BY provider_artifact_delete_pending_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    return tx.transcriptionRun.update({ where: { id: rows[0].id }, data: { leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  });
  if (!claimed) return 0;
  try {
    if (!claimed.providerArtifactName) throw new Error("ARTIFACT_METADATA_MISSING");
    await (provider ?? new GeminiTranscriptionProvider()).deleteFile(claimed.providerArtifactName);
    await prisma.transcriptionRun.updateMany({ where: { id: claimed.id, leaseToken: claimed.leaseToken }, data: { providerArtifactDeletedAt: new Date(), providerArtifactDeletePendingAt: null, leaseToken: null, leaseExpiresAt: null } });
  } catch { await prisma.transcriptionRun.updateMany({ where: { id: claimed.id, leaseToken: claimed.leaseToken }, data: { leaseToken: null, leaseExpiresAt: new Date(Date.now() + 60_000) } }); }
  return 1;
}
