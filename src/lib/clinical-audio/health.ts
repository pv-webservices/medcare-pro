import { prisma } from "@/lib/prisma";
import { ACTIVE_TRANSCRIPTION_STATUSES } from "@/lib/transcription/types";
import { getSarvamBatchConfig } from "@/lib/transcription/batchConfig";
import { GEMINI_PROCESSING_TIMEOUT_MS } from "@/lib/transcription/providers/gemini";

export async function getClinicalAudioHealth() {
  const now = new Date();
  const sarvamDeadline = new Date(
    now.getTime() - getSarvamBatchConfig().jobTimeoutMinutes * 60_000,
  );
  const [oldest, stale, pastDeadline, cleanup, overdue, derived] =
    await Promise.all([
      prisma.transcriptionRun.findFirst({
        where: { status: "QUEUED" },
        orderBy: { queuedAt: "asc" },
        select: { queuedAt: true },
      }),
      prisma.transcriptionRun.count({
        where: {
          status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] },
          leaseExpiresAt: { lt: now },
        },
      }),
      prisma.transcriptionRun.count({
        where: {
          status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] },
          OR: [
            { provider: "SARVAM", submittedAt: { lt: sarvamDeadline } },
            {
              provider: "GEMINI",
              startedAt: {
                lt: new Date(
                  now.getTime() - GEMINI_PROCESSING_TIMEOUT_MS - 30_000,
                ),
              },
            },
          ],
        },
      }),
      prisma.transcriptionRun.count({
        where: {
          providerArtifactDeletePendingAt: { not: null },
          providerArtifactDeletedAt: null,
        },
      }),
      prisma.consultationRecording.count({
        where: { audioDeleteAfter: { lte: now }, audioDeletedAt: null },
      }),
      prisma.transcriptDerivedView.count({
        where: { status: { in: ["QUEUED", "PROCESSING"] } },
      }),
    ]);

  return {
    oldestQueuedAt: oldest?.queuedAt ?? null,
    staleLeases: stale,
    processingPastDeadline: pastDeadline,
    providerCleanupBacklog: cleanup,
    retentionOverdue: overdue,
    romanizationBacklog: derived,
  };
}
