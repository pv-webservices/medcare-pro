import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import {
  createClinicalAudioFixture,
  assertClinicalAudioDatabase,
} from "./clinical-audio-test-fixture";
import {
  createRecording,
  transitionRecording,
  withdrawRecordingConsent,
  listRecordings,
} from "@/lib/clinical-audio/recordingService";
let checks = 0;
function check(label: string, v: unknown) {
  assert.ok(v, label);
  checks++;
  console.log("PASS " + label);
}
const consent = { attested: true, method: "VERBAL", consenterType: "PATIENT" };
try {
  assertClinicalAudioDatabase();
  const f = await createClinicalAudioFixture();
  const actor = f.doctorUser.actor;
  const visit = await f.visit();
  const migrations = await prisma.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  check(
    "AI-2A migration applied",
    migrations.some(
      (m) =>
        m.migration_name === "20260914010000_clinical_recording_transcription",
    ),
  );
  for (const name of ["20260914120000_sarvam_batch_transcription", "20260914120100_transcription_evidence_guards"]) check("AI-2A.2 migration applied: " + name, migrations.some((migration) => migration.migration_name === name));
  for (const name of ["20260914010000_clinical_recording_transcription", "20260914120000_sarvam_batch_transcription", "20260914120100_transcription_evidence_guards", "20260915120000_clinical_ai2a3_hardening", "20260916140000_clinical_audio_r2_upload_id"]) {
    const sql = (await readFile(`prisma/migrations/${name}/migration.sql`, "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(Buffer.from(sql, "utf8")).digest("hex");
    check("Migration checksum matches: " + name, migrations.some((migration) => migration.migration_name === name && migration.checksum === checksum));
  }
  const uploadIdCol = await prisma.$queryRaw<
    Array<{ CHARACTER_MAXIMUM_LENGTH: bigint | number }>
  >`SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='consultation_recordings' AND COLUMN_NAME='upload_id'`;
  check("upload_id column widened to 1024", uploadIdCol.length === 1 && Number(uploadIdCol[0].CHARACTER_MAXIMUM_LENGTH) === 1024);
  const transcriptionIndexes = await prisma.$queryRaw<{ INDEX_NAME: string; NON_UNIQUE: bigint }[]>`SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transcription_runs'`;
  for (const name of ["transcription_runs_active_key_key", "transcription_runs_provider_provider_job_id_key"]) check("Transcription unique index: " + name, transcriptionIndexes.some((index) => index.INDEX_NAME === name && Number(index.NON_UNIQUE) === 0));
  const evidenceTriggers = await prisma.$queryRaw<{ TRIGGER_NAME: string }[]>`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`;
  check("Permanent fallback unique key", transcriptionIndexes.some(index => index.INDEX_NAME === "transcription_runs_fallback_key_key" && Number(index.NON_UNIQUE) === 0));
  for (const name of ["derived_segment_owner_guard", "derived_view_source_guard", "derived_segment_identity_guard", "derived_view_identity_guard"]) check("Derived evidence trigger: " + name, evidenceTriggers.some(trigger => trigger.TRIGGER_NAME === name));
  const derivedIndexes = await prisma.$queryRaw<{ INDEX_NAME: string; NON_UNIQUE: bigint }[]>`SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transcript_derived_views'`;
  check("Derived source/type unique key", derivedIndexes.some(index => index.INDEX_NAME === "derived_source_type_key" && Number(index.NON_UNIQUE) === 0));
  const derivedFks = await prisma.$queryRaw<{ DELETE_RULE: string }[]>`SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('transcript_derived_views','transcript_derived_segments')`;
  check("All four derived foreign keys restrictive", derivedFks.length === 4 && derivedFks.every(fk => fk.DELETE_RULE === "RESTRICT"));
  for (const name of ["transcription_active_key_insert", "transcription_active_key_update", "clinical_transcript_source_immutable", "clinical_transcript_segment_immutable", "clinical_transcript_segment_no_delete", "transcript_correction_append_only", "transcript_correction_no_delete", "transcript_speaker_identity_immutable"]) check("Evidence trigger: " + name, evidenceTriggers.some((trigger) => trigger.TRIGGER_NAME === name));
  const indexes = await prisma.$queryRaw<
    Array<{ INDEX_NAME: string }>
  >`SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='consultation_recordings'`;
  check(
    "active key unique index",
    indexes.some(
      (i) => i.INDEX_NAME === "consultation_recordings_active_key_key",
    ),
  );
  check(
    "retention index",
    indexes.some(
      (i) => i.INDEX_NAME === "consultation_recordings_audio_delete_after_idx",
    ),
  );
  const fks = await prisma.$queryRaw<
    Array<{ TABLE_NAME: string; DELETE_RULE: string }>
  >`SELECT TABLE_NAME,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('consultation_recording_consents','consultation_recordings','clinical_transcripts','clinical_transcript_segments','transcription_runs','transcript_corrections','transcript_speaker_mappings','consultation_recording_events')`;
  check(
    "all 30 clinical foreign keys restrictive",
    fks.length === 30 && fks.every((fk) => fk.DELETE_RULE === "RESTRICT"),
  );
  await assert.rejects(
    createRecording(actor, visit.id, {
      method: "VERBAL",
      consenterType: "PATIENT",
    }),
  );
  check("explicit consent required", true);
  const simultaneous = await Promise.allSettled([
    createRecording(actor, visit.id, consent),
    createRecording(actor, visit.id, consent),
  ]);
  check(
    "two simultaneous creates: exactly one succeeds",
    simultaneous.filter((r) => r.status === "fulfilled").length === 1 &&
      simultaneous.filter((r) => r.status === "rejected").length === 1,
  );
  const r = simultaneous.find((r) => r.status === "fulfilled")!;
  assert.equal(r.status, "fulfilled");
  const id = r.value.id;
  const stored = await prisma.consultationRecording.findUniqueOrThrow({
    where: { id },
  });
  const duplicateConsent = await prisma.consultationRecordingConsent.create({
    data: {
      tenantId: stored.tenantId,
      clinicId: stored.clinicId,
      registrationId: stored.registrationId,
      patientId: stored.patientId,
      doctorId: stored.doctorId,
      capturedByUserId: actor.userId,
      method: "VERBAL",
      consenterType: "PATIENT",
      consentedAt: new Date(),
    },
  });
  const direct = await Promise.allSettled([
    prisma.consultationRecording.create({
      data: {
        tenantId: stored.tenantId,
        clinicId: stored.clinicId,
        registrationId: stored.registrationId,
        patientId: stored.patientId,
        doctorId: stored.doctorId,
        createdByUserId: stored.createdByUserId,
        activeKey: visit.id,
        consentId: duplicateConsent.id,
      },
    }),
  ]);
  check(
    "DB unique guard independently rejects duplicate",
    direct[0].status === "rejected",
  );
  await assert.rejects(
    prisma.consultationRecording.update({
      where: { id },
      data: { activeKey: null },
    }),
  );
  check("DB check prevents null-key active bypass", true);
  await assert.rejects(
    transitionRecording(actor, id, "pause", { clientElapsedMs: 0 }),
  );
  check("CREATED to PAUSED rejected", true);
  check(
    "start",
    (
      await transitionRecording(actor, id, "start", {
        clientElapsedMs: 0,
        mimeType: "audio/webm;codecs=opus",
      })
    ).status === "RECORDING",
  );
  check(
    "pause",
    (await transitionRecording(actor, id, "pause", { clientElapsedMs: 1000 }))
      .status === "PAUSED",
  );
  check(
    "resume",
    (await transitionRecording(actor, id, "resume", { clientElapsedMs: 1000 }))
      .status === "RECORDING",
  );
  const stops = await Promise.all([
    transitionRecording(actor, id, "stop", { clientElapsedMs: 2000 }),
    transitionRecording(actor, id, "stop", { clientElapsedMs: 2000 }),
  ]);
  check(
    "duplicate stops idempotent",
    stops.every((r) => r.status === "STOPPED"),
  );
  await assert.rejects(
    transitionRecording(actor, id, "start", { clientElapsedMs: 0 }),
  );
  check("STOPPED to RECORDING rejected", true);
  await assert.rejects(prisma.registration.delete({ where: { id: visit.id } }));
  check("registration deletion restricted", true);
  await assert.rejects(prisma.patient.delete({ where: { id: f.patient.id } }));
  check("patient deletion restricted", true);
  await assert.rejects(listRecordings(f.foreign.actor, visit.id));
  check("tenant isolation", true);
  await assert.rejects(listRecordings(f.scopedUser.actor, visit.id));
  check("clinic isolation", true);
  await assert.rejects(
    createRecording(f.admin.actor, (await f.visit()).id, consent),
  );
  check("admin cannot impersonate Doctor", true);
  const withdrawn = await createRecording(actor, (await f.visit()).id, consent);
  await transitionRecording(actor, withdrawn.id, "start", {
    clientElapsedMs: 0,
    mimeType: "audio/webm",
  });
  check(
    "withdrawal aborts",
    (
      await withdrawRecordingConsent(actor, withdrawn.id, {
        clientElapsedMs: 1000,
      })
    ).status === "ABORTED",
  );
  await assert.rejects(
    transitionRecording(actor, withdrawn.id, "resume", {
      clientElapsedMs: 1000,
    }),
  );
  check("withdrawal terminal", true);
  const audits = await prisma.auditLog.findMany({
    where: { targetId: withdrawn.id },
  });
  check(
    "withdrawal metadata audited",
    audits.some((a) => a.action === "clinical-audio.consent-withdrawn"),
  );
  check(
    "no transcription queued",
    (await prisma.transcriptionRun.count({
      where: { recordingId: withdrawn.id },
    })) === 0,
  );
  console.log("Clinical audio verification: " + checks + " checks passed.");
} finally {
  await prisma.$disconnect();
}
