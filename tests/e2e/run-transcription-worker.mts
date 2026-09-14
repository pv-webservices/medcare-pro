// Disposable test-runner only; never imported by application code.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "../../src/lib/prisma";
import { assertClinicalAudioDatabase } from "../../scripts/clinical-audio-test-fixture";
import { workTranscriptionOnce } from "../../src/lib/transcription/worker";
import { getSarvamBatchConfig } from "../../src/lib/transcription/batchConfig";
import { getClinicalAudioConfig } from "../../src/lib/clinical-audio/config";
import { LocalRecordingStorageProvider } from "../../src/lib/clinical-audio/storage/local";
import type { SarvamJobStatus } from "../../src/lib/transcription/providers/sarvam";
import { TranscriptionFailure } from "../../src/lib/transcription/errors";
assertClinicalAudioDatabase();
process.env.AI_ENABLED = "true"; process.env.CLINICAL_AUDIO_ENABLED = "true"; process.env.RECORDING_STORAGE_PROVIDER = "local";
try {
  const recording = await prisma.consultationRecording.findUniqueOrThrow({ where: { id: process.argv[2] } });
  const run = await prisma.transcriptionRun.findUniqueOrThrow({ where: { activeKey: recording.id } });
  const config = getSarvamBatchConfig({ TRANSCRIPTION_PRIMARY_PROVIDER: "sarvam", SARVAM_API_SUBSCRIPTION_KEY: "synthetic-never-sent" });
  const storage = new LocalRecordingStorageProvider(getClinicalAudioConfig({ ...process.env, RECORDING_LOCAL_ROOT: resolve(tmpdir(), "medcare-ai2a1-e2e-private"), RECORDING_LOCAL_SIGNING_SECRET: "disposable-local-audio-signing-secret" })!);
  const jobId = run.providerJobId ?? `synthetic-${randomUUID()}`;
  let state: SarvamJobStatus["job_state"] = run.providerJobId ? "Completed" : "Accepted";
  const status = (): SarvamJobStatus => ({ job_id: jobId, job_state: state, total_files: 1, successful_files_count: state === "Completed" ? 1 : 0, failed_files_count: 0, job_details: [{ state: state === "Completed" ? "Success" : "Processing", inputs: [{ file_name: `${recording.id}.webm` }], outputs: state === "Completed" ? [{ file_name: "synthetic.json" }] : [] }] });
  const provider = {
    async createJob() { if (process.argv.includes("--fail")) throw new TranscriptionFailure("AUTH"); return jobId; },
    async upload(_id: string, _name: string, stream: ReadableStream<Uint8Array>) { const reader = stream.getReader(); while (!(await reader.read()).done) { /* consume private stream only */ } reader.releaseLock(); },
    async start() { state = "Running"; return status(); }, async status() { return status(); },
    async result() { return { request_id: "synthetic", transcript: "Metformin 500 mg once daily. No chest pain for three days; left knee pain.", language_code: "en-IN", diarized_transcript: { entries: [{ transcript: "Metformin 500 mg once daily.", start_time_seconds: 0, end_time_seconds: 10, speaker_id: "speaker_0" }, { transcript: "No chest pain for three days; left knee pain.", start_time_seconds: 17, end_time_seconds: 20, speaker_id: "speaker_1" }] } }; },
  };
  await workTranscriptionOnce("synthetic-e2e-worker", { config, storage, provider, tenantId: recording.tenantId });
} finally { await prisma.$disconnect(); }
