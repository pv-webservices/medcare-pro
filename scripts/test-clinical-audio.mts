import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { createClinicalAudioFixture } from "./clinical-audio-test-fixture";
import {
  createRecording,
  transitionRecording,
  withdrawRecordingConsent,
  recordingForActor,
} from "@/lib/clinical-audio/recordingService";
import {
  initRecordingUpload,
  signRecordingPart,
  completeRecordingUpload,
  discardRecording,
  getRecordingAudioUrl,
} from "@/lib/clinical-audio/uploadService";
import {
  InMemoryRecordingStorage,
  getRecordingStorageProvider,
} from "@/lib/clinical-audio/storage";
import { mayUseWritingAssistant } from "@/lib/clinical-ai/writingAssistant";
let checks = 0;
function check(label: string, v: unknown) {
  assert.ok(v, label);
  checks++;
  console.log("PASS " + label);
}
async function denied(label: string, work: Promise<unknown>) {
  await assert.rejects(work);
  check(label, true);
}
try {
  const f = await createClinicalAudioFixture();
  const actor = f.doctorUser.actor;
  const s = new InMemoryRecordingStorage();
  const consent = {
    attested: true,
    method: "VERBAL",
    consenterType: "PATIENT",
  };
  async function stopped() {
    const visit = await f.visit();
    const r = await createRecording(actor, visit.id, consent);
    await transitionRecording(actor, r.id, "start", {
      clientElapsedMs: 0,
      mimeType: "audio/webm;codecs=opus",
    });
    await transitionRecording(actor, r.id, "stop", { clientElapsedMs: 1000 });
    return r;
  }
  const r = await stopped();
  const withdrawalDuringOutage = await stopped();
  const privateStorage = getRecordingStorageProvider();
  await initRecordingUpload(actor, withdrawalDuringOutage.id, {
    mimeType: "audio/webm;codecs=opus",
    byteSize: 2048,
    durationMs: 1000,
  });
  const originalAbort =
    privateStorage.abortMultipartUpload.bind(privateStorage);
  privateStorage.abortMultipartUpload = async () => {
    throw new Error("synthetic storage outage");
  };
  try {
    await denied(
      "withdrawal reports storage cleanup outage",
      withdrawRecordingConsent(actor, withdrawalDuringOutage.id, {
        clientElapsedMs: 1000,
      }),
    );
    const durable = await prisma.consultationRecording.findUniqueOrThrow({
      where: { id: withdrawalDuringOutage.id },
      include: { consent: true },
    });
    check(
      "withdrawal remains durable despite storage outage",
      durable.status === "ABORTED" && durable.consent.withdrawnAt !== null,
    );
    await denied(
      "withdrawn upload cannot finalize during outage",
      signRecordingPart(actor, withdrawalDuringOutage.id, {
        uploadId: durable.uploadId,
        partNumber: 1,
      }),
    );
  } finally {
    privateStorage.abortMultipartUpload = originalAbort;
  }
  await withdrawRecordingConsent(actor, withdrawalDuringOutage.id, {
    clientElapsedMs: 1000,
  });
  check("withdrawal cleanup retry succeeds", true);
  const input = {
    mimeType: "audio/webm;codecs=opus",
    byteSize: 2048,
    durationMs: 1000,
  };
  await denied(
    "video MIME rejected",
    initRecordingUpload(actor, r.id, { ...input, mimeType: "video/webm" }, s),
  );
  await denied(
    "empty audio rejected",
    initRecordingUpload(actor, r.id, { ...input, byteSize: 0 }, s),
  );
  await denied(
    "oversized recording rejected",
    initRecordingUpload(actor, r.id, { ...input, byteSize: 600_000_000 }, s),
  );
  await denied(
    "incorrect duration rejected",
    initRecordingUpload(actor, r.id, { ...input, durationMs: 1001 }, s),
  );
  const initial = await Promise.all([
    initRecordingUpload(actor, r.id, input, s),
    initRecordingUpload(actor, r.id, input, s),
  ]);
  check(
    "duplicate init reuses multipart",
    initial[0].uploadId === initial[1].uploadId && s.uploads.size === 1,
  );
  const init = initial[0];
  check("S3-compatible 8 MiB part size", init.partSize >= 5 * 1024 * 1024);
  check(
    "opaque storage key",
    s.uploads.get(init.uploadId!)!.key ===
      "clinical-recordings/" + actor.tenantId + "/" + r.id + "/source.webm",
  );
  await denied(
    "foreign upload denied",
    signRecordingPart(
      f.foreign.actor,
      r.id,
      { uploadId: init.uploadId, partNumber: 1 },
      s,
    ),
  );
  await denied(
    "wrong clinic upload denied",
    signRecordingPart(
      f.scopedUser.actor,
      r.id,
      { uploadId: init.uploadId, partNumber: 1 },
      s,
    ),
  );
  await denied(
    "wrong Doctor denied",
    signRecordingPart(
      f.admin.actor,
      r.id,
      { uploadId: init.uploadId, partNumber: 1 },
      s,
    ),
  );
  await denied(
    "wrong upload ID denied",
    signRecordingPart(actor, r.id, { uploadId: "wrong", partNumber: 1 }, s),
  );
  await denied(
    "part bound enforced",
    signRecordingPart(
      actor,
      r.id,
      { uploadId: init.uploadId, partNumber: 2 },
      s,
    ),
  );
  check(
    "correct final-part byte size",
    (
      await signRecordingPart(
        actor,
        r.id,
        { uploadId: init.uploadId, partNumber: 1 },
        s,
      )
    ).size === 2048,
  );
  const etag = await s.putPart(init.uploadId!, 1, new Uint8Array(2048));
  const completion = {
    uploadId: init.uploadId,
    parts: [{ partNumber: 1, etag }],
  };
  await denied(
    "malformed ETag rejected",
    completeRecordingUpload(
      actor,
      r.id,
      { ...completion, parts: [{ partNumber: 1, etag: "bad" }] },
      s,
    ),
  );
  const completes = await Promise.all([
    completeRecordingUpload(actor, r.id, completion, s),
    completeRecordingUpload(actor, r.id, completion, s),
  ]);
  check(
    "duplicate complete READY",
    completes.every((r) => r.status === "READY"),
  );
  const ready = await prisma.consultationRecording.findUniqueOrThrow({
    where: { id: r.id },
  });
  check("HEAD verified byte size", ready.byteSize === BigInt(2048));
  check("checksum from private storage", !!ready.sha256);
  check(
    "active recording key released only after READY",
    ready.activeKey === null,
  );
  check(
    "signed playback 300 second maximum",
    (await getRecordingAudioUrl(actor, r.id, s)).expiresIn <= 300,
  );
  await denied(
    "foreign playback denied",
    getRecordingAudioUrl(f.foreign.actor, r.id, s),
  );
  await denied(
    "wrong Doctor playback denied",
    getRecordingAudioUrl(f.admin.actor, r.id, s),
  );
  const role = await prisma.role.findUniqueOrThrow({ where: { id: f.roleId } });
  const permissions = role.permissions as string[];
  await prisma.role.update({
    where: { id: f.roleId },
    data: {
      permissions: permissions.filter(
        (p) => p !== "clinical-ai:transcript-read",
      ),
    },
  });
  await denied(
    "recording permission does not grant playback",
    getRecordingAudioUrl(actor, r.id, s),
  );
  await prisma.role.update({ where: { id: f.roleId }, data: { permissions } });
  await prisma.consultationRecording.update({
    where: { id: r.id },
    data: { audioDeletedAt: new Date() },
  });
  await denied(
    "deleted audio unavailable",
    getRecordingAudioUrl(actor, r.id, s),
  );
  const abandoned = await stopped();
  const abandonedInit = await initRecordingUpload(
    actor,
    abandoned.id,
    input,
    s,
  );
  await discardRecording(actor, abandoned.id, s);
  check("discard aborts multipart", !s.uploads.has(abandonedInit.uploadId!));
  check(
    "discard idempotent",
    (await discardRecording(actor, abandoned.id, s)).status === "ABORTED",
  );
  await denied(
    "aborted recording cannot finalize",
    completeRecordingUpload(
      actor,
      abandoned.id,
      { uploadId: abandonedInit.uploadId, parts: [{ partNumber: 1, etag }] },
      s,
    ),
  );
  const withdrawal = await stopped();
  await withdrawRecordingConsent(actor, withdrawal.id, {
    clientElapsedMs: 1000,
  });
  await denied(
    "withdrawal blocks upload init",
    initRecordingUpload(actor, withdrawal.id, input, s),
  );
  const failing = await stopped();
  const bad = new InMemoryRecordingStorage();
  const badInit = await initRecordingUpload(actor, failing.id, input, bad);
  const badEtag = await bad.putPart(badInit.uploadId!, 1, new Uint8Array(1024));
  await denied(
    "HEAD size mismatch cannot become READY",
    completeRecordingUpload(
      actor,
      failing.id,
      { uploadId: badInit.uploadId, parts: [{ partNumber: 1, etag: badEtag }] },
      bad,
    ),
  );
  check("invalid storage object deleted", bad.objects.size === 0);
  const writingOnly = await stopped();
  await prisma.role.update({
    where: { id: f.roleId },
    data: {
      permissions: permissions.filter((p) => p !== "clinical-ai:recording"),
    },
  });
  await denied(
    "writing-only role cannot upload",
    initRecordingUpload(actor, writingOnly.id, input, s),
  );
  await prisma.role.update({ where: { id: f.roleId }, data: { permissions } });
  process.env.GEMINI_API_KEY = "synthetic-never-sent";
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_MODEL = "synthetic-model";
  process.env.CLINICAL_AUDIO_ENABLED = "false";
  await denied(
    "audio kill switch denies access",
    recordingForActor(actor, r.id, "clinical-ai:transcript-read"),
  );
  check(
    "audio kill switch preserves AI-1",
    await mayUseWritingAssistant(actor, (await f.visit()).id),
  );
  process.env.CLINICAL_AUDIO_ENABLED = "true";
  await prisma.tenantFeatureOverride.updateMany({
    where: { tenantId: f.tenant.id, featureId: f.feature.id },
    data: { enabled: false },
  });
  await denied(
    "feature entitlement enforced",
    createRecording(actor, (await f.visit()).id, consent),
  );
  await prisma.tenantFeatureOverride.updateMany({
    where: { tenantId: f.tenant.id, featureId: f.feature.id },
    data: { enabled: true },
  });
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { status: "SUSPENDED" },
  });
  await denied(
    "inactive tenant rejected",
    getRecordingAudioUrl(actor, r.id, s),
  );
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { status: "ACTIVE" },
  });
  check(
    "READY does not enqueue transcription",
    (await prisma.transcriptionRun.count({
      where: { tenantId: f.tenant.id },
    })) === 0,
  );
  const runs = await prisma.auditLog.findMany({
    where: { actorTenantId: f.tenant.id, targetType: "ConsultationRecording" },
  });
  check(
    "audit metadata has no binary, URLs or speech",
    runs.every(
      (a) =>
        !/memory:\/\/|source.webm|etag|audioBlob|base64|signedUrl/.test(
          JSON.stringify(a.afterValue),
        ),
    ),
  );
  console.log("Clinical audio integration: " + checks + " checks passed.");
} finally {
  await prisma.$disconnect();
}
