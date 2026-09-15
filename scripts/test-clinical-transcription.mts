import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createClinicalAudioFixture } from "./clinical-audio-test-fixture";
import { createRecording, transitionRecording } from "@/lib/clinical-audio/recordingService";
import { initRecordingUpload, completeRecordingUpload } from "@/lib/clinical-audio/uploadService";
import { getRecordingStorageProvider, InMemoryRecordingStorage } from "@/lib/clinical-audio/storage";
import { claimNextTranscriptionRun, fencedRunUpdate, requestTranscription } from "@/lib/transcription/service";
import { workTranscriptionOnce as unscopedWork } from "@/lib/transcription/worker";
import { getSarvamBatchConfig } from "@/lib/transcription/batchConfig";
import { addCorrection, confirmSpeaker, getTranscript, reviewTranscript } from "@/lib/transcription/transcripts";
import type { SarvamJobStatus } from "@/lib/transcription/providers/sarvam";
import { TranscriptionFailure } from "@/lib/transcription/errors";
import { ConflictError } from "@/lib/apiHandler";
import { fallbackEligibility, requestGeminiFallback, setFallbackSettings } from "@/lib/transcription/fallback";
import { getRomanizedView, requestRomanization, workRomanizationOnce, SarvamTransliterationClient } from "@/lib/transcription/romanization";
import { cleanupAudioOnce, cleanupProviderArtifactOnce } from "@/lib/clinical-audio/cleanup";
import { POST as sarvamCallback } from "@/app/api/clinical-ai/transcription/webhooks/sarvam/route";
let checks = 0;
function check(label: string, assertion: unknown) { assert.ok(assertion, label); checks++; console.log(`PASS ${label}`); }
try {
  const fixture = await createClinicalAudioFixture();
  const actor = fixture.doctorUser.actor;
  const workTranscriptionOnce = (workerId: string, dependencies: Parameters<typeof unscopedWork>[1]) => unscopedWork(workerId, { ...dependencies!, tenantId: actor.tenantId });
  // Explicit synthetic injection: this script never constructs a live provider.
  process.env.TRANSCRIPTION_PRIMARY_PROVIDER = "sarvam";
  process.env.SARVAM_API_SUBSCRIPTION_KEY = "synthetic-never-sent";
  process.env.TRANSCRIPTION_AUTO_FALLBACK = "false";
  delete process.env.CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL;
  delete process.env.SARVAM_WEBHOOK_SECRET;
  const config = getSarvamBatchConfig();
  const storage = getRecordingStorageProvider() as InMemoryRecordingStorage;
  async function ready() {
    const visit = await fixture.visit();
    const recording = await createRecording(actor, visit.id, { attested: true, method: "VERBAL", consenterType: "PATIENT" });
    await transitionRecording(actor, recording.id, "start", { clientElapsedMs: 0, mimeType: "audio/webm;codecs=opus" });
    await transitionRecording(actor, recording.id, "stop", { clientElapsedMs: 20_000 });
    const upload = await initRecordingUpload(actor, recording.id, { mimeType: "audio/webm;codecs=opus", durationMs: 20_000, byteSize: 2048 });
    const etag = await storage.putPart(upload.uploadId!, 1, new Uint8Array(2048));
    await completeRecordingUpload(actor, recording.id, { uploadId: upload.uploadId, parts: [{ partNumber: 1, etag }] });
    return recording;
  }
  const recording = await ready();
  await assert.rejects(requestTranscription(fixture.foreign.actor, recording.id)); check("foreign tenant cannot request transcription", true);
  await assert.rejects(requestTranscription(fixture.scopedUser.actor, recording.id)); check("wrong clinic cannot request transcription", true);
  await assert.rejects(requestTranscription(fixture.admin.actor, recording.id)); check("unlinked Doctor cannot request transcription", true);
  const notReadyVisit = await fixture.visit();
  const notReady = await createRecording(actor, notReadyVisit.id, { attested: true, method: "VERBAL", consenterType: "PATIENT" });
  await assert.rejects(requestTranscription(actor, notReady.id)); check("non-READY recording cannot queue transcription", await prisma.transcriptionRun.count({ where: { recordingId: notReady.id } }) === 0);
  const requested = await Promise.all(Array.from({ length: 10 }, () => requestTranscription(actor, recording.id)));
  check("10 duplicate requests create one durable active run", new Set(requested.map((entry) => entry.run.id)).size === 1 && requested.filter((entry) => entry.created).length === 1);
  const claimed = await Promise.all([claimNextTranscriptionRun("worker-a", actor.tenantId), claimNextTranscriptionRun("worker-b", actor.tenantId)]);
  check("two workers cannot claim the same run", claimed.filter(Boolean).length === 1);
  const stale = claimed.find(Boolean)!;
  await prisma.transcriptionRun.update({ where: { id: stale.id }, data: { leaseExpiresAt: new Date(0) } });
  const reclaimed = await claimNextTranscriptionRun("worker-c", actor.tenantId);
  check("expired lease is reclaimed with a new fencing token", reclaimed && reclaimed.id === stale.id && reclaimed.leaseToken !== stale.leaseToken);
  await assert.rejects(fencedRunUpdate(stale, { status: "FAILED" })); check("stale worker cannot overwrite reclaimed run", true);
  await prisma.transcriptionRun.update({ where: { id: stale.id }, data: { leaseExpiresAt: new Date(0) } });
  let creates = 0; let uploads = 0;
  const syntheticJobId = `synthetic-${randomUUID()}`;
  let state: SarvamJobStatus["job_state"] = "Accepted";
  const status = (jobId: string): SarvamJobStatus => ({ job_id: jobId, job_state: state, total_files: 1, successful_files_count: state === "Completed" ? 1 : 0, failed_files_count: 0, job_details: [{ state: state === "Completed" ? "Success" : "Processing", inputs: [{ file_name: `${recording.id}.webm` }], outputs: state === "Completed" ? [{ file_name: "synthetic-output.json" }] : [] }] });
  const provider = {
    async createJob() { creates++; return syntheticJobId; },
    async upload(_jobId: string, _filename: string, stream: ReadableStream<Uint8Array>) { uploads++; const reader = stream.getReader(); let bytes = 0; for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; } reader.releaseLock(); assert.equal(bytes, 2048); },
    async start(jobId: string) { state = "Running"; return status(jobId); },
    async status(jobId: string) { return status(jobId); },
    async result() { return { request_id: "synthetic", transcript: "Metformin 500 mg once daily. No chest pain for three days.", language_code: "en-IN", diarized_transcript: { entries: [{ speaker_id: "speaker_0", start_time_seconds: 0, end_time_seconds: 10, transcript: "Metformin 500 mg once daily." }, { speaker_id: "speaker_1", start_time_seconds: 17, end_time_seconds: 20, transcript: "No chest pain for three days." }] } }; },
  };
  await workTranscriptionOnce("worker-d", { config, storage, provider });
  let run = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: stale.id } });
  check("submission persists provider job and upload checkpoints", run.providerJobId === syntheticJobId && run.uploadCompletedAt && run.status === "PROCESSING");
  check("processing persists next poll and releases lease", run.nextAttemptAt && run.lastPollAt && !run.leaseToken);
  process.env.SARVAM_WEBHOOK_SECRET = "synthetic-callback-secret-at-least-32-characters";
  const hint = () => new Request("https://example.test/api/clinical-ai/transcription/webhooks/sarvam", { method: "POST", headers: { "X-SARVAM-JOB-CALLBACK-TOKEN": process.env.SARVAM_WEBHOOK_SECRET! }, body: JSON.stringify({ job_id: syntheticJobId, job_state: "Completed" }) });
  assert.equal((await sarvamCallback(hint())).status, 200);
  const firstHint = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: run.id } });
  for (let count = 0; count < 10; count++) assert.equal((await sarvamCallback(hint())).status, 200);
  const duplicateHint = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: run.id } });
  check("10 duplicate authenticated callbacks cause one persisted hint only", firstHint.updatedAt.getTime() === duplicateHint.updatedAt.getTime() && duplicateHint.callbackState === "Completed");
  check("callback cannot finalize or create source rows", duplicateHint.status === "PROCESSING" && await prisma.clinicalTranscript.count({ where: { transcriptionRunId: run.id } }) === 0);
  delete process.env.SARVAM_WEBHOOK_SECRET;
  await prisma.transcriptionRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } });
  state = "Completed";
  await workTranscriptionOnce("worker-e", { config, storage, provider });
  run = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: run.id } });
  check("polling recovery completes without new provider job or upload", creates === 1 && uploads === 1 && run.status === "COMPLETED" && !run.activeKey && run.providerRequestId === "synthetic");
  const evidence = await prisma.clinicalTranscript.findUniqueOrThrow({ where: { transcriptionRunId: run.id } });
  let transcript = await getTranscript(actor, evidence.id);
  check("atomic source, segments and UNKNOWN speakers persist", transcript.segments.length === 2 && transcript.speakers.length === 2 && transcript.speakers.every((speaker) => speaker.speakerType === "UNKNOWN"));
  await assert.rejects(getTranscript(fixture.foreign.actor, evidence.id)); check("foreign tenant cannot read transcript", true);
  await assert.rejects(getTranscript(fixture.admin.actor, evidence.id)); check("unlinked Doctor identity cannot read transcript", true);
  await assert.rejects(reviewTranscript(actor, evidence.id, { attested: true, expectedVersion: transcript.version })); check("UNKNOWN speakers block review", true);
  await confirmSpeaker(actor, evidence.id, transcript.speakers[0].id, { speakerType: "DOCTOR", expectedVersion: transcript.version });
  transcript = await getTranscript(actor, evidence.id);
  await assert.rejects(confirmSpeaker(actor, evidence.id, transcript.speakers[1].id, { speakerType: "DOCTOR", expectedVersion: transcript.version })); check("multiple Doctor mappings rejected", true);
  await confirmSpeaker(actor, evidence.id, transcript.speakers[1].id, { speakerType: "PATIENT", expectedVersion: transcript.version });
  transcript = await getTranscript(actor, evidence.id);
  await reviewTranscript(actor, evidence.id, { attested: true, expectedVersion: transcript.version });
  transcript = await getTranscript(actor, evidence.id);
  check("explicit clinician review persists", !!transcript.reviewedAt && transcript.reviewedByUserId === actor.userId);
  await addCorrection(actor, transcript.segments[1].id, { correctedText: "No chest pain for three days. Left knee pain.", expectedVersion: transcript.version });
  transcript = await getTranscript(actor, evidence.id);
  check("correction invalidates review, preserving source checksum and times", !transcript.reviewedAt && transcript.sourceHash === evidence.sourceHash && transcript.segments[1].startMs === 17000 && transcript.sourceText === evidence.sourceText);
  await addCorrection(actor, transcript.segments[1].id, { correctedText: "No chest pain for three days; left knee pain.", expectedVersion: transcript.version });
  transcript = await getTranscript(actor, evidence.id);
  const history = transcript.segments[1].corrections;
  check("corrections append with supersession chain and original evidence", history.length === 2 && history.some((entry) => entry.supersedesCorrectionId === history.find((entry) => !entry.supersedesCorrectionId)?.id) && transcript.segments[1].text === "No chest pain for three days.");
  await assert.rejects(addCorrection(actor, transcript.segments[1].id, { correctedText: "stale", expectedVersion: 1 })); check("optimistic version rejects stale correction", true);
  const audits = await prisma.auditLog.findMany({ where: { targetId: run.id } });
  check("audit contains metadata, not source or corrections", !JSON.stringify(audits).includes("Metformin") && !JSON.stringify(audits).includes("chest pain"));
  await assert.rejects(prisma.clinicalTranscript.update({ where: { id: evidence.id }, data: { sourceText: "changed source" } })); check("database rejects original source rewrite", true);
  await assert.rejects(prisma.clinicalTranscriptSegment.update({ where: { id: transcript.segments[1].id }, data: { startMs: 5 } })); check("database rejects original timestamp rewrite", true);
  await assert.rejects(prisma.clinicalTranscriptSegment.delete({ where: { id: transcript.segments[1].id } })); check("database rejects source segment deletion", true);
  await assert.rejects(prisma.transcriptCorrection.update({ where: { id: history[0].id }, data: { correctedText: "overwritten" } })); check("database rejects correction history overwrite", true);
  await assert.rejects(prisma.transcriptCorrection.delete({ where: { id: history[0].id } })); check("database rejects correction history deletion", true);
  await assert.rejects(prisma.transcriptSpeakerMapping.update({ where: { id: transcript.speakers[0].id }, data: { speakerLabel: "changed-provider-id" } })); check("database rejects provider speaker identity rewrite", true);
  await assert.rejects(prisma.transcriptionRun.update({ where: { id: run.id }, data: { status: "PROCESSING", activeKey: run.recordingId } })); check("COMPLETED run is terminal at database boundary", true);
  await assert.rejects(prisma.transcriptionRun.create({ data: { tenantId: actor.tenantId, clinicId: run.clinicId, registrationId: run.registrationId, recordingId: run.recordingId, requestedByUserId: actor.userId, provider: "SARVAM", model: "saaras:v4", activeKey: null } })); check("database CHECK rejects null active-key bypass", true);
  const failureRecording = await ready();
  const failureRequest = await requestTranscription(actor, failureRecording.id);
  let createAttempts = 0;
  const uncertainProvider = { ...provider, async createJob(): Promise<string> { createAttempts++; throw new TranscriptionFailure("NETWORK", true); } };
  await workTranscriptionOnce("uncertain-worker", { config, storage, provider: uncertainProvider });
  const uncertain = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: failureRequest.run.id } });
  check("ambiguous create fails closed without retry or duplicate provider job", uncertain.status === "FAILED" && uncertain.submissionIntentAt && !uncertain.activeKey && createAttempts === 1);
  const retryRequest = await requestTranscription(actor, failureRecording.id);
  check("explicit retry creates a new Sarvam-only run", retryRequest.created && retryRequest.run.provider === "SARVAM" && retryRequest.run.id !== uncertain.id);
  const retryJobId = `retry-${randomUUID()}`;
  await prisma.transcriptionRun.update({ where: { id: retryRequest.run.id }, data: { providerJobId: retryJobId, submissionIntentAt: new Date(), submittedAt: new Date(), status: "PROCESSING" } });
  const limitedProvider = { ...provider, async status(): Promise<SarvamJobStatus> { throw new TranscriptionFailure("RATE_LIMIT", true); } };
  await workTranscriptionOnce("limited-worker", { config, storage, provider: limitedProvider });
  let limited = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: retryRequest.run.id } });
  check("rate limit persists backoff, same provider job and attempt count", limited.status === "PROCESSING" && limited.attemptNumber === 2 && limited.nextAttemptAt && limited.providerJobId === retryJobId);
  for (let count = 0; count < 2; count++) { await prisma.transcriptionRun.update({ where: { id: limited.id }, data: { nextAttemptAt: new Date(0) } }); await workTranscriptionOnce("limited-worker", { config, storage, provider: limitedProvider }); }
  limited = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: limited.id } });
  check("transient errors stop after three attempts", limited.status === "FAILED" && limited.attemptNumber === 3 && !limited.activeKey);
  const timeoutRequest = await requestTranscription(actor, failureRecording.id);
  await prisma.transcriptionRun.update({ where: { id: timeoutRequest.run.id }, data: { providerJobId: `timeout-${randomUUID()}`, submittedAt: new Date(0), status: "PROCESSING" } });
  state = "Running";
  await workTranscriptionOnce("timeout-worker", { config, storage, provider });
  const timedOut = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: timeoutRequest.run.id } });
  check("long-running job times out durably with no transcript", timedOut.status === "TIMED_OUT" && timedOut.failureCode === "TIMEOUT" && !timedOut.activeKey && await prisma.clinicalTranscript.count({ where: { transcriptionRunId: timedOut.id } }) === 0);
  const invalidRequest = await requestTranscription(actor, failureRecording.id);
  await prisma.transcriptionRun.update({ where: { id: invalidRequest.run.id }, data: { providerJobId: `invalid-${randomUUID()}`, submittedAt: new Date(), status: "PROCESSING" } });
  state = "Completed";
  const invalidProvider = { ...provider, async result() { return { transcript: "not diarized" }; } };
  await workTranscriptionOnce("invalid-worker", { config, storage, provider: invalidProvider });
  const invalid = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: invalidRequest.run.id } });
  check("invalid diarization fails without partial source rows", invalid.status === "FAILED" && invalid.failureCode === "INVALID_RESPONSE" && await prisma.clinicalTranscript.count({ where: { transcriptionRunId: invalid.id } }) === 0);
  const revokedRequest = await requestTranscription(actor, failureRecording.id);
  const consentOwner = await prisma.consultationRecording.findUniqueOrThrow({ where: { id: failureRecording.id }, select: { consentId: true } });
  await prisma.consultationRecordingConsent.update({ where: { id: consentOwner.consentId }, data: { withdrawnAt: new Date(), withdrawnByUserId: actor.userId } });
  await workTranscriptionOnce("revoked-worker", { config, storage, provider });
  const revoked = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: revokedRequest.run.id } });
  check("withdrawn consent fails before provider IO", revoked.status === "FAILED" && revoked.failureCode === "CONSENT_INVALID" && !revoked.providerJobId);
  // Reproduce persisted crash boundaries with an expired lease, not graceful error handling.
  for (const checkpoint of ["after-create-before-id-write", "after-id-write", "after-upload-before-checkpoint", "after-upload-checkpoint", "after-start"] as const) {
    const crashRecording = await ready();
    const queued = await requestTranscription(actor, crashRecording.id);
    const jobId = `crash-${randomUUID()}`;
    let providerState: SarvamJobStatus["job_state"] = "Accepted";
    let createCount = 0; let uploadCount = 0; let startCount = 0; let interrupted = false;
    const crash = async () => {
      interrupted = true;
      await prisma.transcriptionRun.update({ where: { id: queued.run.id }, data: { leaseExpiresAt: new Date(0) } });
      throw new ConflictError("Synthetic expired worker lease.");
    };
    const crashProvider = {
      ...provider,
      async createJob() { createCount++; if (!interrupted && checkpoint === "after-create-before-id-write") await crash(); return jobId; },
      async status(id: string) { if (!interrupted && checkpoint === "after-id-write") await crash(); return { ...status(id), job_state: providerState }; },
      async upload(id: string, filename: string, stream: ReadableStream<Uint8Array>) { uploadCount++; await provider.upload(id, filename, stream); if (!interrupted && checkpoint === "after-upload-before-checkpoint") await crash(); },
      async start(id: string) { if (!interrupted && checkpoint === "after-upload-checkpoint") await crash(); startCount++; providerState = "Running"; if (!interrupted && checkpoint === "after-start") await crash(); return { ...status(id), job_state: providerState }; },
    };
    await workTranscriptionOnce("crashed-worker", { config, storage, provider: crashProvider });
    await workTranscriptionOnce("recovery-worker", { config, storage, provider: crashProvider });
    const recovered = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: queued.run.id } });
    check(`crash recovery: ${checkpoint}`, createCount === 1 && (checkpoint === "after-create-before-id-write" ? recovered.status === "FAILED" && !recovered.providerJobId : recovered.status === "PROCESSING" && recovered.providerJobId === jobId && startCount === 1 && uploadCount === (checkpoint === "after-upload-before-checkpoint" ? 2 : 1)));
    if (recovered.activeKey) await prisma.transcriptionRun.update({ where: { id: recovered.id }, data: { status: "FAILED", activeKey: null } });
  }
  const rejectedRecording = await ready();
  const rejectedRequest = await requestTranscription(actor, rejectedRecording.id);
  await workTranscriptionOnce("rejected-create", { config, storage, provider: { ...provider, async createJob(): Promise<string> { throw new TranscriptionFailure("RATE_LIMIT", true); } } });
  const rejected = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: rejectedRequest.run.id } });
  check("definite create 429 clears ambiguous intent and schedules bounded retry", rejected.status === "PREPARING" && rejected.attemptNumber === 2 && !rejected.submissionIntentAt && !rejected.providerJobId && rejected.nextAttemptAt);
  await prisma.transcriptionRun.update({ where: { id: rejected.id }, data: { status: "FAILED", activeKey: null } });
  const heartbeatRecording = await ready();
  const heartbeatRequest = await requestTranscription(actor, heartbeatRecording.id);
  let initialLease = 0;
  const heartbeatProvider = { ...provider, async createJob() {
    initialLease = (await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: heartbeatRequest.run.id } })).leaseExpiresAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 41_000));
    const renewed = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: heartbeatRequest.run.id } });
    check("long submission renews lease and blocks competing worker claim", renewed.leaseExpiresAt!.getTime() > initialLease && await claimNextTranscriptionRun("competing-worker", actor.tenantId) === null);
    return `heartbeat-${randomUUID()}`;
  } };
  state = "Accepted";
  await workTranscriptionOnce("heartbeat-worker", { config, storage, provider: heartbeatProvider });
  const heartbeatRun = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: heartbeatRequest.run.id } });
  check("renewed worker completes submission and releases lease", heartbeatRun.status === "PROCESSING" && !heartbeatRun.leaseToken);
  await prisma.transcriptionRun.update({ where: { id: heartbeatRun.id }, data: { status: "FAILED", activeKey: null } });
  await prisma.role.update({ where: { id: fixture.roleId }, data: { permissions: [...fixture.originalPermissions.filter((permission) => permission !== "clinical-ai:transcription"), "clinical-ai:transcript-read", "clinical-ai:recording"] } });
  transcript = await getTranscript(actor, evidence.id);
  await assert.rejects(addCorrection(actor, transcript.segments[0].id, { correctedText: "reader cannot edit", expectedVersion: transcript.version }));
  await assert.rejects(confirmSpeaker(actor, transcript.id, transcript.speakers[0].id, { speakerType: "DOCTOR", expectedVersion: transcript.version }));
  await assert.rejects(reviewTranscript(actor, transcript.id, { attested: true, expectedVersion: transcript.version }));
  check("transcript-read permits evidence reads but no mutations", transcript.sourceHash === evidence.sourceHash);
  await prisma.role.update({ where: { id: fixture.roleId }, data: { permissions: [...fixture.originalPermissions, "clinical-ai:transcript-read", "clinical-ai:recording", "clinical-ai:transcription"] } });
  process.env.CLINICAL_AUDIO_ENABLED = "false";
  await assert.rejects(getTranscript(actor, evidence.id)); check("kill switch blocks transcript reads", true);
  process.env.CLINICAL_AUDIO_ENABLED = "true";
  process.env.TRANSCRIPTION_FALLBACK_PROVIDER = "gemini";
  process.env.GEMINI_TRANSCRIPTION_API_KEY = "synthetic-fallback-never-sent";
  const fallbackRecording = await ready();
  const failedPrimary = await requestTranscription(actor, fallbackRecording.id);
  await prisma.transcriptionRun.update({ where: { id: failedPrimary.run.id }, data: { status: "FAILED", failureCode: "NETWORK", activeKey: null } });
  await assert.rejects(requestGeminiFallback(actor, fallbackRecording.id)); check("tenant fallback defaults disabled", true);
  await assert.rejects(setFallbackSettings(actor, true)); check("clinician cannot change organization processor governance", true);
  await assert.rejects(setFallbackSettings(fixture.admin.actor, true)); check("clinic-scoped admin cannot opt the whole tenant into Google processing", true);
  await setFallbackSettings(fixture.owner.actor, true);
  await assert.rejects(requestGeminiFallback(fixture.foreign.actor, fallbackRecording.id)); check("foreign fallback denied", true);
  await assert.rejects(requestGeminiFallback(fixture.scopedUser.actor, fallbackRecording.id)); check("cross-clinic fallback denied", true);
  await assert.rejects(requestGeminiFallback(fixture.admin.actor, fallbackRecording.id)); check("unlinked admin fallback denied", true);
  await prisma.consultationRecording.update({ where: { id: fallbackRecording.id }, data: { durationMs: 31 * 60_000 } });
  check("31 minute fallback unavailable", (await fallbackEligibility(actor, fallbackRecording.id)).reason === "DURATION_LIMIT");
  await assert.rejects(requestGeminiFallback(actor, fallbackRecording.id));
  await prisma.consultationRecording.update({ where: { id: fallbackRecording.id }, data: { durationMs: 29 * 60_000 } });
  check("29 minute failed Sarvam run eligible", (await fallbackEligibility(actor, fallbackRecording.id)).available);
  const fallbackRequests = await Promise.all(Array.from({ length: 10 }, () => requestGeminiFallback(actor, fallbackRecording.id)));
  check("ten concurrent fallback requests create exactly one run", new Set(fallbackRequests.map(r => r.run.id)).size === 1 && fallbackRequests.filter(r => r.created).length === 1);
  const fallbackRun = fallbackRequests[0].run;
  const geminiSource = { sourceText: "मुझे तीन दिन से बुखार है. Metformin 500 mg. آپ میٹفارمین پانچ سو ملی گرام لے رہے ہیں", providerRequestId: "synthetic-gemini", segments: [
    { ordinal: 0, speakerLabel: "spk_1", startMs: 0, endMs: 1000, text: "मुझे तीन दिन से बुखार है" },
    { ordinal: 1, speakerLabel: "spk_2", startMs: 1000, endMs: 2000, text: "Metformin 500 mg." },
    { ordinal: 2, speakerLabel: "spk_1", startMs: 2000, endMs: 3000, text: "آپ میٹفارمین پانچ سو ملی گرام لے رہے ہیں" },
  ] };
  await workTranscriptionOnce("gemini-synthetic-worker", { config, storage, provider, gemini: { async transcribe(input) { await input.stream.cancel(); await input.artifact("files/synthetic", false); return geminiSource; } } });
  const completedFallback = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: fallbackRun.id }, include: { transcript: true } });
  check("fallback preserves failed Sarvam provenance and own source", completedFallback.status === "COMPLETED" && completedFallback.fallbackFromRunId === failedPrimary.run.id && completedFallback.transcript?.sourceText === geminiSource.sourceText && (await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: failedPrimary.run.id } })).status === "FAILED");
  const fallbackTranscript = completedFallback.transcript!;
  await assert.rejects(requestGeminiFallback(actor, fallbackRecording.id)); check("successful source cannot request Gemini comparison", true);
  const derivedRequests = await Promise.all(Array.from({ length: 10 }, () => requestRomanization(actor, fallbackTranscript.id)));
  check("duplicate Romanization requests reuse same view", new Set(derivedRequests.map(v => v.id)).size === 1);
  await assert.rejects(getRomanizedView(fixture.foreign.actor, fallbackTranscript.id)); check("foreign derived-view access denied", true);
  let transliterationCalls = 0;
  const transliterator = new SarvamTransliterationClient("synthetic", async () => { transliterationCalls++; return new Response(JSON.stringify({ source_language_code: "hi-IN", transliterated_text: "mujhe teen din se bukhar hai" })); });
  await workRomanizationOnce(transliterator, actor.tenantId);
  const derivedView = await getRomanizedView(actor, fallbackTranscript.id);
  check("mixed-script view aligned and partial; Latin passthrough and Urdu preserved", derivedView?.isPartial && derivedView.segments.length === 3 && transliterationCalls === 1 && derivedView.segments.some(s => s.status === "PASSTHROUGH" && s.text === "Metformin 500 mg.") && derivedView.segments.some(s => s.status === "UNSUPPORTED" && s.text === geminiSource.segments[2].text));
  check("Romanization cannot rewrite source", (await getTranscript(actor, fallbackTranscript.id)).sourceText === geminiSource.sourceText);
  await assert.rejects(prisma.transcriptDerivedSegment.create({ data: { derivedViewId: derivedRequests[0].id, sourceSegmentId: transcript.segments[0].id, text: "synthetic foreign source", status: "PASSTHROUGH" } }));
  check("database rejects derived segment bound to another transcript", true);
  await assert.rejects(prisma.transcriptDerivedView.create({ data: { transcriptId: fallbackTranscript.id, sourceHash: "0".repeat(64), type: "SYNTHETIC_INVALID", createdByUserId: actor.userId } }));
  check("database rejects derived view with a foreign source hash", true);
  await prisma.consultationRecording.update({ where: { id: fallbackRecording.id }, data: { audioDeleteAfter: new Date(Date.now() + 60000) } });
  check("unexpired audio is excluded from cleanup", await cleanupAudioOnce(storage, actor.tenantId) === 0 && !(await prisma.consultationRecording.findUniqueOrThrow({ where: { id: fallbackRecording.id } })).audioDeletedAt);
  await prisma.consultationRecording.update({ where: { id: fallbackRecording.id }, data: { audioDeleteAfter: new Date(Date.now() - 1000) } });
  let deletions = 0;
  const failingStorage = Object.create(storage) as InMemoryRecordingStorage;
  failingStorage.deleteObject = async () => { throw new Error("SYNTHETIC_STORAGE_OUTAGE"); };
  await cleanupAudioOnce(failingStorage, actor.tenantId);
  check("storage outage leaves audio undeleted and schedules retry", !(await prisma.consultationRecording.findUniqueOrThrow({ where: { id: fallbackRecording.id } })).audioDeletedAt);
  await prisma.consultationRecording.update({ where: { id: fallbackRecording.id }, data: { audioCleanupNextAttemptAt: new Date(0) } });
  const deletingStorage = Object.create(storage) as InMemoryRecordingStorage;
  deletingStorage.deleteObject = async input => { deletions++; await storage.deleteObject(input); };
  await Promise.all([cleanupAudioOnce(deletingStorage, actor.tenantId), cleanupAudioOnce(deletingStorage, actor.tenantId)]);
  check("two cleanup workers delete exactly once and mark audio deleted", deletions === 1 && (await prisma.consultationRecording.findUniqueOrThrow({ where: { id: fallbackRecording.id } })).audioDeletedAt);
  await cleanupAudioOnce(deletingStorage, actor.tenantId); check("already deleted audio remains idempotent", deletions === 1);
  const missingRecording = await ready();
  await prisma.consultationRecording.update({ where: { id: missingRecording.id }, data: { audioDeleteAfter: new Date(0) } });
  const missingStorage = Object.create(storage) as InMemoryRecordingStorage;
  missingStorage.deleteObject = async () => { throw Object.assign(new Error("synthetic missing object"), { name: "NotFound" }); };
  await cleanupAudioOnce(missingStorage, actor.tenantId);
  check("confirmed missing object is marked deleted safely", (await prisma.consultationRecording.findUniqueOrThrow({ where: { id: missingRecording.id } })).audioDeletedAt);
  await assert.rejects(requestGeminiFallback(actor, fallbackRecording.id)); await assert.rejects(requestTranscription(actor, fallbackRecording.id)); check("deleted audio rejects both providers", true);
  check("source, corrections and derived views survive audio deletion", (await getTranscript(actor, fallbackTranscript.id)).sourceHash === fallbackTranscript.sourceHash && (await getRomanizedView(actor, fallbackTranscript.id))?.status === "COMPLETED");
  let artifactDeletions = 0;
  await Promise.all([cleanupProviderArtifactOnce({ async deleteFile() { artifactDeletions++; } }, actor.tenantId), cleanupProviderArtifactOnce({ async deleteFile() { artifactDeletions++; } }, actor.tenantId)]);
  check("provider cleanup is durable and exclusive", artifactDeletions === 1 && (await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: fallbackRun.id } })).providerArtifactDeletedAt);
  const fallbackAudits = await prisma.auditLog.findMany({ where: { targetId: { in: [fallbackRun.id, fallbackRecording.id] } } });
  check("fallback and retention audits contain metadata only", !JSON.stringify(fallbackAudits).includes("Metformin") && !JSON.stringify(fallbackAudits).includes("files/synthetic") && !JSON.stringify(fallbackAudits).includes("बुखार"));
  await setFallbackSettings(fixture.owner.actor, false);
  console.log(`Clinical transcription: ${checks} checks passed.`);
} finally { await prisma.$disconnect(); }
