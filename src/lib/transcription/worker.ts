import type { TranscriptionRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/domainErrors";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import { getRecordingStorageProvider, type RecordingStorageProvider } from "@/lib/clinical-audio/storage";
import { getSarvamBatchConfig, type SarvamBatchConfig } from "./batchConfig";
import { SarvamBatchClient } from "./providers/sarvam";
import { GeminiTranscriptionProvider } from "./providers/gemini";
import type { NormalizedTranscript } from "./types";
import { TranscriptionFailure } from "./errors";
import { normalizeSarvamResult, transcriptSourceHash } from "./normalize";
import { ACTIVE_TRANSCRIPTION_STATUSES, LEASE_MS, claimNextTranscriptionRun, fencedRunUpdate, retainedRecording, transcriptionAudit } from "./service";

type BatchTransport = Pick<SarvamBatchClient, "createJob" | "upload" | "start" | "status" | "result">;
type Dependencies = { config: SarvamBatchConfig; provider: BatchTransport; storage: RecordingStorageProvider; tenantId?: string; gemini?: Pick<GeminiTranscriptionProvider, "transcribe"> };
const released = { lockedBy: null, lockedAt: null, leaseToken: null, leaseExpiresAt: null };
const actorFor = (run: TranscriptionRun) => ({ userId: run.requestedByUserId, tenantId: run.tenantId });

/** Bounded single pass; fake transport is injected explicitly in tests. */
export async function workTranscriptionOnce(workerId: string, dependencies?: Dependencies, maximum = 4) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) throw new TranscriptionFailure("CONFIGURATION");
  const config = dependencies?.config ?? getSarvamBatchConfig();
  const provider = dependencies?.provider ?? new SarvamBatchClient(config);
  const storage = dependencies?.storage ?? getRecordingStorageProvider();
  let count = 0;
  while (count < maximum) {
    const run = await claimNextTranscriptionRun(workerId, dependencies?.tenantId);
    if (!run) break;
    count++;
    await processRun(run, { config, provider, storage, gemini: dependencies?.gemini });
  }
  return count;
}

async function processRun(claim: TranscriptionRun, { config, provider, storage, gemini }: Dependencies) {
  const controller = new AbortController();
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void fencedRunUpdate(claim, { leaseExpiresAt: new Date(Date.now() + LEASE_MS) }).catch(() => controller.abort()).finally(() => { renewing = false; });
  }, LEASE_MS / 3);
  try {
    const actor = actorFor(claim);
    let run = claim;
    const recording = await retainedRecording(actor, run.recordingId);
    const mime = recording.mimeType?.split(";")[0];
    const extension = mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "mp4" : mime === "audio/webm" ? "webm" : null;
    if (!extension) throw new TranscriptionFailure("UNSUPPORTED_AUDIO");
    const filename = `${recording.id}.${extension}`;
    const since = run.submittedAt ?? run.startedAt ?? run.queuedAt;
    let source: NormalizedTranscript;
    if (run.provider === "GEMINI") {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: run.tenantId } });
      if (!tenant.allowGeminiTranscriptionFallback || !run.fallbackFromRunId) throw new TranscriptionFailure("CONFIGURATION");
      if (run.submissionIntentAt) throw new TranscriptionFailure("PROVIDER_FAILURE");
      const primary = await prisma.transcriptionRun.findUnique({ where: { id: run.fallbackFromRunId } });
      if (!primary || primary.recordingId !== run.recordingId || primary.tenantId !== run.tenantId || primary.provider !== "SARVAM" || !["FAILED", "TIMED_OUT"].includes(primary.status)) throw new TranscriptionFailure("CONFIGURATION");
      const head = await storage.headObject({ key: recording.storageKey! });
      if (BigInt(head.size) !== recording.byteSize) throw new TranscriptionFailure("SOURCE_MISSING");
      const stream = await storage.getObjectStream({ key: recording.storageKey! });
      await fencedRunUpdate(run, { submissionIntentAt: new Date(), submittedAt: new Date(), status: "PROCESSING" });
      await prisma.$transaction(async tx => { await transcriptionAudit(tx, actor, { ...run, status: "PROCESSING" }, "FALLBACK_STARTED"); });
      source = await (gemini ?? new GeminiTranscriptionProvider()).transcribe({ stream, bytes: Number(recording.byteSize), mime: mime!, durationMs: recording.durationMs!, signal: controller.signal, artifact: async (name, deleted) => {
        await prisma.transcriptionRun.update({ where: { id: run.id }, data: deleted ? { providerArtifactDeletedAt: new Date(), providerArtifactDeletePendingAt: null } : { providerArtifactName: name, providerArtifactDeletePendingAt: new Date() } });
      } });
    } else {
    if (!run.providerJobId) {
      // No documented provider idempotency key: ambiguous creates cannot auto-resubmit.
      if (run.submissionIntentAt) throw new TranscriptionFailure("PROVIDER_FAILURE");
      await fencedRunUpdate(run, { submissionIntentAt: new Date() });
      const jobId = await provider.createJob(controller.signal);
      await fencedRunUpdate(run, { providerJobId: jobId });
      run = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    const jobId = run.providerJobId!;
    let status = await provider.status(jobId, controller.signal);
    if (status.job_state === "Accepted" && !run.submittedAt) {
      await retainedRecording(actor, run.recordingId);
      if (!run.uploadCompletedAt) {
        let stream: ReadableStream<Uint8Array>;
        try {
          const head = await storage.headObject({ key: recording.storageKey! });
          if (BigInt(head.size) !== recording.byteSize) throw new Error("SOURCE_MISSING");
          stream = await storage.getObjectStream({ key: recording.storageKey! });
        } catch { throw new TranscriptionFailure("SOURCE_MISSING"); }
        await provider.upload(jobId, filename, stream, Number(recording.byteSize), mime!, controller.signal);
        await fencedRunUpdate(run, { uploadCompletedAt: new Date() });
      }
      await retainedRecording(actor, run.recordingId);
      status = await provider.start(jobId, controller.signal);
    }
    if (!run.submittedAt) {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.transcriptionRun.updateMany({ where: { id: run.id, leaseToken: claim.leaseToken, leaseExpiresAt: { gt: new Date() } }, data: { submittedAt: new Date(), status: "SUBMITTED" } });
        if (changed.count !== 1) throw new ConflictError("Lease lost.");
        await transcriptionAudit(tx, actor, { ...run, status: "SUBMITTED" }, "submitted");
      });
    }
    if (status.job_state === "Failed") throw new TranscriptionFailure("PROVIDER_FAILURE");
    if (status.job_state !== "Completed") {
      if (Date.now() - since.getTime() >= config.jobTimeoutMinutes * 60_000) throw new TranscriptionFailure("TIMEOUT");
      await fencedRunUpdate(run, { status: status.job_state === "Running" ? "PROCESSING" : "SUBMITTED", lastPollAt: new Date(), nextAttemptAt: new Date(Date.now() + (run.lastPollAt ? config.pollIntervalSeconds : config.pollAfterSeconds) * 1000), ...released });
      return;
    }
    source = normalizeSarvamResult(await provider.result(status, filename, controller.signal), recording.durationMs!);
    }
    const sourceHash = transcriptSourceHash(source);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${run.registrationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${run.recordingId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM transcription_runs WHERE id = ${run.id} FOR UPDATE`;
      const current = await tx.transcriptionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (current.status === "COMPLETED") return;
      if (current.leaseToken !== claim.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date() || !ACTIVE_TRANSCRIPTION_STATUSES.includes(current.status as typeof ACTIVE_TRANSCRIPTION_STATUSES[number])) throw new ConflictError("Lease lost.");
      await retainedRecording(actor, run.recordingId, tx);
      await tx.clinicalTranscript.create({ data: { tenantId: run.tenantId, clinicId: run.clinicId, registrationId: run.registrationId, recordingId: run.recordingId, transcriptionRunId: run.id, sourceText: source.sourceText, sourceHash, segments: { create: source.segments }, speakerMappings: { create: [...new Set(source.segments.map((segment) => segment.speakerLabel))].map((speakerLabel) => ({ speakerLabel, speakerType: "UNKNOWN" })) } } });
      const completed = await tx.transcriptionRun.update({ where: { id: run.id }, data: { status: "COMPLETED", activeKey: null, languageCode: source.languageCode, providerRequestId: source.providerRequestId, completedAt: new Date(), lastPollAt: new Date(), latencyMs: Date.now() - since.getTime(), failureCode: null, nextAttemptAt: null, ...released } });
      await transcriptionAudit(tx, actor, completed, "completed", { segmentCount: source.segments.length });
    });
  } catch (error) {
    if (error instanceof ConflictError || controller.signal.aborted) return;
    const failure = error instanceof TranscriptionFailure ? error : new TranscriptionFailure(error instanceof PermissionError || error instanceof ScopeError || error instanceof FeatureError || error instanceof ClinicalAudioDisabledError ? "CONSENT_INVALID" : "PROVIDER_FAILURE");
    const current = await prisma.transcriptionRun.findUnique({ where: { id: claim.id } });
    if (!current || current.leaseToken !== claim.leaseToken) return;
    const ambiguousCreate = current.submissionIntentAt !== null && current.providerJobId === null;
    // A documented 429 is a definite rejection, unlike ambiguous network/5xx creation.
    const definiteCreateRejection = ambiguousCreate && failure.code === "RATE_LIMIT";
    const retry = current.provider === "SARVAM" && failure.retryable && (!ambiguousCreate || definiteCreateRejection) && current.attemptNumber < 3;
    await prisma.$transaction(async (tx) => {
      const changed = await tx.transcriptionRun.updateMany({ where: { id: claim.id, leaseToken: claim.leaseToken, leaseExpiresAt: { gt: new Date() }, status: { in: [...ACTIVE_TRANSCRIPTION_STATUSES] } }, data: { failureCode: failure.code, ...(retry ? { ...(definiteCreateRejection ? { submissionIntentAt: null } : {}), attemptNumber: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5_000 * 2 ** current.attemptNumber + Math.floor(Math.random() * 1_000)) } : { status: failure.code === "TIMEOUT" ? "TIMED_OUT" : "FAILED", activeKey: null, completedAt: new Date(), nextAttemptAt: null }), ...released } });
      if (changed.count === 1 && !retry) await transcriptionAudit(tx, actorFor(claim), { ...current, status: failure.code === "TIMEOUT" ? "TIMED_OUT" : "FAILED" }, "failed", { failureCategory: failure.code });
    });
  } finally { clearInterval(heartbeat); }
}
