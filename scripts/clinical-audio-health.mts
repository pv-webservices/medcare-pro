import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ACTIVE_TRANSCRIPTION_STATUSES } from "../src/lib/transcription/types";
import { getSarvamBatchConfig } from "../src/lib/transcription/batchConfig";
import { GEMINI_PROCESSING_TIMEOUT_MS } from "../src/lib/transcription/providers/gemini";
try {
  const now = new Date();
  const sarvamDeadline = new Date(Date.now() - getSarvamBatchConfig().jobTimeoutMinutes * 60_000);
  const [oldest, stale, pastDeadline, cleanup, overdue, derived] = await Promise.all([
    prisma.transcriptionRun.findFirst({ where: { status: "QUEUED" }, orderBy: { queuedAt: "asc" }, select: { queuedAt: true } }),
    prisma.transcriptionRun.count({ where: { status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] }, leaseExpiresAt: { lt: now } } }),
    prisma.transcriptionRun.count({ where: { status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] }, OR: [{ provider: "SARVAM", submittedAt: { lt: sarvamDeadline } }, { provider: "GEMINI", startedAt: { lt: new Date(Date.now() - GEMINI_PROCESSING_TIMEOUT_MS - 30_000) } }] } }),
    prisma.transcriptionRun.count({ where: { providerArtifactDeletePendingAt: { not: null }, providerArtifactDeletedAt: null } }),
    prisma.consultationRecording.count({ where: { audioDeleteAfter: { lte: now }, audioDeletedAt: null } }),
    prisma.transcriptDerivedView.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } }),
  ]);
  console.log(JSON.stringify({ oldestQueuedAt: oldest?.queuedAt ?? null, staleLeases: stale, processingPastDeadline: pastDeadline, providerCleanupBacklog: cleanup, retentionOverdue: overdue, romanizationBacklog: derived }));
} catch { console.error("Clinical audio health check unavailable."); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
