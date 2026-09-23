import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { createClinicalAudioFixture } from "./clinical-audio-test-fixture";
import { createRecording, transitionRecording } from "@/lib/clinical-audio/recordingService";
import { initRecordingUpload, completeRecordingUpload } from "@/lib/clinical-audio/uploadService";
import { getRecordingStorageProvider, InMemoryRecordingStorage } from "@/lib/clinical-audio/storage";
import { addCorrection, confirmSpeaker, getTranscript, reviewTranscript } from "@/lib/transcription/transcripts";
import { AiError } from "@/lib/ai/errors";
import type { AiProvider } from "@/lib/ai/types";
import {
  getAcceptedTranscriptFacts,
  listTranscriptFacts,
  requestFactExtraction,
  reviewFact,
  workFactExtractionOnce as unscopedWork,
} from "@/lib/clinical-facts/service";

let checks = 0;
function check(label: string, assertion: unknown) { assert.ok(assertion, label); checks++; console.log(`PASS ${label}`); }

// Synthetic configuration only: the provider is always injected below.
process.env.CLINICAL_FACTS_ENABLED = "true";
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "synthetic-never-sent";
process.env.GEMINI_MODEL = "synthetic-model";

const SEGMENTS = [
  { speakerLabel: "speaker_0", text: "Do you have chest pain?" },
  { speakerLabel: "speaker_1", text: "No chest pain. I have fever since 3 days." },
  { speakerLabel: "speaker_0", text: "Take paracetamol 500 mg twice daily for 5 days." },
  { speakerLabel: "speaker_1", text: "Mujhe penicillin se allergy hai." },
];

try {
  const fixture = await createClinicalAudioFixture();
  const actor = fixture.doctorUser.actor;
  const storage = getRecordingStorageProvider() as InMemoryRecordingStorage;
  const work = (provider: AiProvider) => unscopedWork("facts-test-worker", { provider, tenantId: actor.tenantId });

  async function reviewedTranscript() {
    const visit = await fixture.visit();
    const recording = await createRecording(actor, visit.id, { attested: true, method: "VERBAL", consenterType: "PATIENT" });
    await transitionRecording(actor, recording.id, "start", { clientElapsedMs: 0, mimeType: "audio/webm;codecs=opus" });
    await transitionRecording(actor, recording.id, "stop", { clientElapsedMs: 20_000 });
    const upload = await initRecordingUpload(actor, recording.id, { mimeType: "audio/webm;codecs=opus", durationMs: 20_000, byteSize: 2048 });
    const etag = await storage.putPart(upload.uploadId!, 1, new Uint8Array(2048));
    await completeRecordingUpload(actor, recording.id, { uploadId: upload.uploadId, parts: [{ partNumber: 1, etag }] });
    const ready = await prisma.consultationRecording.findUniqueOrThrow({ where: { id: recording.id } });
    // Equivalent to a completed provider pass (the worker path is covered by
    // test-clinical-transcription.mts).
    const run = await prisma.transcriptionRun.create({ data: { tenantId: ready.tenantId, clinicId: ready.clinicId, registrationId: ready.registrationId, recordingId: ready.id, requestedByUserId: actor.userId, provider: "SARVAM", model: "saaras:v4", status: "COMPLETED", completedAt: new Date(), languageCode: "en-IN" } });
    const transcript = await prisma.clinicalTranscript.create({ data: { tenantId: ready.tenantId, clinicId: ready.clinicId, registrationId: ready.registrationId, recordingId: ready.id, transcriptionRunId: run.id, sourceText: SEGMENTS.map((s) => s.text).join(" "), sourceHash: "a".repeat(64), segments: { create: SEGMENTS.map((s, ordinal) => ({ ordinal, speakerLabel: s.speakerLabel, startMs: ordinal * 4000, endMs: ordinal * 4000 + 3500, text: s.text })) }, speakerMappings: { create: [{ speakerLabel: "speaker_0", speakerType: "UNKNOWN" }, { speakerLabel: "speaker_1", speakerType: "UNKNOWN" }] } } });
    let view = await getTranscript(actor, transcript.id);
    await confirmSpeaker(actor, transcript.id, view.speakers.find((s) => s.speakerLabel === "speaker_0")!.id, { speakerType: "DOCTOR", expectedVersion: view.version });
    view = await getTranscript(actor, transcript.id);
    await confirmSpeaker(actor, transcript.id, view.speakers.find((s) => s.speakerLabel === "speaker_1")!.id, { speakerType: "PATIENT", expectedVersion: view.version });
    view = await getTranscript(actor, transcript.id);
    return { id: transcript.id, view };
  }

  const segmentId = (view: Awaited<ReturnType<typeof getTranscript>>, ordinal: number) => view.segments.find((s) => s.ordinal === ordinal)!.id;
  function provider(view: Awaited<ReturnType<typeof getTranscript>>): AiProvider & { calls: number } {
    return {
      calls: 0,
      async generateStructured<T>() {
        this.calls++;
        const facts = [
          // Valid, supported facts.
          { category: "SYMPTOM", assertion: "NEGATED", subject: "PATIENT", statement: "No chest pain", attributes: { name: "chest pain" }, evidence: [{ segmentId: segmentId(view, 1), quote: "No chest pain." }] },
          { category: "SYMPTOM", assertion: "PRESENT", subject: "PATIENT", statement: "Fever for 3 days", attributes: { name: "fever", duration: "3 days" }, evidence: [{ segmentId: segmentId(view, 1), quote: "I have fever since 3 days." }] },
          { category: "MEDICATION_MENTION", assertion: "PRESENT", subject: "PATIENT", statement: "Paracetamol 500 mg twice daily for 5 days", attributes: { name: "paracetamol", strength: "500 mg", frequency: "twice daily", duration: "5 days" }, evidence: [{ segmentId: segmentId(view, 2), quote: "Take paracetamol 500 mg twice daily for 5 days." }] },
          { category: "ALLERGY", assertion: "PRESENT", subject: "PATIENT", statement: "Allergy to penicillin", attributes: { substance: "penicillin" }, evidence: [{ segmentId: segmentId(view, 3), quote: "Mujhe penicillin se allergy hai." }] },
          // Hallucinations that must never be stored.
          { category: "SYMPTOM", assertion: "PRESENT", subject: "PATIENT", statement: "Chest pain", attributes: { name: "chest pain" }, evidence: [{ segmentId: segmentId(view, 0), quote: "Do you have chest pain?" }] },
          { category: "MEDICATION_MENTION", assertion: "PRESENT", subject: "PATIENT", statement: "Paracetamol 650 mg", attributes: { name: "paracetamol", strength: "650 mg" }, evidence: [{ segmentId: segmentId(view, 2), quote: "Take paracetamol 500 mg twice daily for 5 days." }] },
          { category: "ALLERGY", assertion: "NEGATED", subject: "PATIENT", statement: "No known allergies", attributes: { substance: "penicillin" }, evidence: [{ segmentId: segmentId(view, 3), quote: "Mujhe penicillin se allergy hai." }] },
          { category: "DIAGNOSIS_MENTION", assertion: "PRESENT", subject: "PATIENT", statement: "Dengue", attributes: { name: "dengue" }, evidence: [{ segmentId: segmentId(view, 1), quote: "I have dengue." }] },
        ];
        return { output: { facts } as T, inputTokens: 100, outputTokens: 50 };
      },
    };
  }

  // Gates and preconditions.
  let t = await reviewedTranscript();
  await assert.rejects(requestFactExtraction(actor, t.id)); check("unreviewed transcript cannot be extracted", (await prisma.clinicalFactExtractionRun.count({ where: { transcriptId: t.id } })) === 0);
  await reviewTranscript(actor, t.id, { attested: true, expectedVersion: t.view.version });
  process.env.CLINICAL_FACTS_ENABLED = "false";
  await assert.rejects(requestFactExtraction(actor, t.id)); check("kill switch blocks extraction", true);
  process.env.CLINICAL_FACTS_ENABLED = "true";
  await assert.rejects(requestFactExtraction(fixture.foreign.actor, t.id)); check("foreign tenant cannot request extraction", true);
  await assert.rejects(requestFactExtraction(fixture.admin.actor, t.id)); check("unlinked Doctor cannot request extraction", true);

  // Idempotency: one run and one provider pass however often it is requested.
  const requests = await Promise.all(Array.from({ length: 5 }, () => requestFactExtraction(actor, t.id).catch((err) => { console.error("requestFactExtraction caught error:", err); return null; })));
  const runIds = new Set(requests.filter(Boolean).map((r) => r!.run.id));
  check("concurrent duplicate requests create one run", runIds.size === 1 && (await prisma.clinicalFactExtractionRun.count({ where: { transcriptId: t.id } })) === 1);
  const fake = provider(t.view);
  check("worker processes the run", (await work(fake)) === 1 && fake.calls === 1);
  check("a completed run is not processed again", (await work(fake)) === 0 && fake.calls === 1);
  const repeat = await requestFactExtraction(actor, t.id);
  check("repeat request after completion returns the same run", !repeat.created && runIds.has(repeat.run.id));

  // Only validated facts are stored, with exact evidence.
  const run = await prisma.clinicalFactExtractionRun.findFirstOrThrow({ where: { transcriptId: t.id }, include: { facts: { include: { evidence: true } } } });
  check("only the 4 supported facts are stored; 4 hallucinations rejected", run.status === "COMPLETED" && run.facts.length === 4 && run.rejectedCount === 4 && !run.activeKey);
  const counts = run.rejectionCounts as Record<string, number>;
  check("rejections are counted by reason only", counts.QUESTION_AS_FACT === 1 && counts.ATTRIBUTE_NOT_IN_EVIDENCE === 1 && counts.NEGATION_WITHOUT_CUE === 1 && counts.QUOTE_NOT_FOUND === 1 && !JSON.stringify(counts).includes("dengue"));
  const view = await getTranscript(actor, t.id);
  check("every evidence span matches the reviewed segment text", run.facts.flatMap((f) => f.evidence).every((e) => view.segments.find((s) => s.id === e.segmentId)!.text.slice(e.charStart, e.charEnd) === e.quote));
  const aiRun = await prisma.aiRun.findFirstOrThrow({ where: { registrationId: run.registrationId, feature: "clinical_facts" } });
  check("provider usage is metered without clinical text", aiRun.status === "SUCCEEDED" && aiRun.inputTokens === 100 && aiRun.outputCharacterCount === 0);
  await assert.rejects(prisma.clinicalFactCandidate.update({ where: { id: run.facts[0].id }, data: { statement: "tampered" } }));
  await assert.rejects(prisma.clinicalFactEvidence.delete({ where: { id: run.facts[0].evidence[0].id } }));
  await assert.rejects(prisma.clinicalFactExtractionRun.update({ where: { id: run.id }, data: { effectiveHash: "0".repeat(64) } }));
  check("facts, evidence and run identity are immutable at the database", true);

  // Doctor review: explicit, per fact, append-only.
  let listing = await listTranscriptFacts(actor, t.id);
  check("listing shows current facts with no decision yet", listing.run?.stale === false && listing.facts.length === 4 && listing.facts.every((f) => f.decision === null));
  await assert.rejects(listTranscriptFacts(fixture.foreign.actor, t.id)); check("foreign tenant cannot list facts", true);
  const fever = listing.facts.find((f) => f.attributes.name === "fever")!;
  const chest = listing.facts.find((f) => f.attributes.name === "chest pain")!;
  await reviewFact(actor, fever.id, { decision: "ACCEPTED" });
  await reviewFact(actor, chest.id, { decision: "DISMISSED", reason: "Synthetic dismissal" });
  await reviewFact(actor, chest.id, { decision: "ACCEPTED" });
  await assert.rejects(reviewFact(fixture.foreign.actor, fever.id, { decision: "DISMISSED" })); check("foreign tenant cannot review a fact", true);
  listing = await listTranscriptFacts(actor, t.id);
  check("latest append-only decision is current", listing.facts.find((f) => f.id === chest.id)!.decision === "ACCEPTED" && (await prisma.clinicalFactReview.count({ where: { factId: chest.id } })) === 2);
  const reviewRow = await prisma.clinicalFactReview.findFirstOrThrow({ where: { factId: fever.id } });
  await assert.rejects(prisma.clinicalFactReview.update({ where: { id: reviewRow.id }, data: { decision: "DISMISSED" } }));
  check("fact reviews are append-only at the database", true);
  const accepted = await getAcceptedTranscriptFacts(actor, t.id);
  check("AI-4 input contains only accepted facts", accepted.length === 2 && accepted.every((f) => f.decision === "ACCEPTED"));

  // Staleness: correcting the transcript invalidates everything downstream.
  await addCorrection(actor, view.segments.find((s) => s.ordinal === 1)!.id, { correctedText: "No chest pain. I have fever since 4 days.", expectedVersion: view.version });
  listing = await listTranscriptFacts(actor, t.id);
  check("transcript correction makes the extraction stale", listing.run?.stale === true && !listing.canExtract);
  await assert.rejects(reviewFact(actor, fever.id, { decision: "DISMISSED" })); check("stale facts cannot be reviewed", true);
  check("stale accepted facts never reach AI-4", (await getAcceptedTranscriptFacts(actor, t.id)).length === 0);

  // A run that goes stale before processing fails closed without a provider call.
  t = await reviewedTranscript();
  await reviewTranscript(actor, t.id, { attested: true, expectedVersion: t.view.version });
  await requestFactExtraction(actor, t.id);
  const reviewed = await getTranscript(actor, t.id);
  await addCorrection(actor, reviewed.segments[1].id, { correctedText: "Corrected before extraction.", expectedVersion: reviewed.version });
  const untouched = provider(reviewed);
  await work(untouched);
  const staleRun = await prisma.clinicalFactExtractionRun.findFirstOrThrow({ where: { transcriptId: t.id } });
  check("stale run fails as STALE without calling the provider", staleRun.status === "FAILED" && staleRun.failureCode === "STALE" && untouched.calls === 0);

  // Transient provider failures retry with backoff, then fail; the doctor can retry.
  t = await reviewedTranscript();
  await reviewTranscript(actor, t.id, { attested: true, expectedVersion: t.view.version });
  const first = await requestFactExtraction(actor, t.id);
  const failing: AiProvider = { async generateStructured() { throw new AiError("TIMEOUT"); } };
  await work(failing);
  let retrying = await prisma.clinicalFactExtractionRun.findUniqueOrThrow({ where: { id: first.run.id } });
  check("timeout requeues with backoff", retrying.status === "QUEUED" && retrying.attemptNumber === 2 && !!retrying.nextAttemptAt && retrying.nextAttemptAt > new Date());
  for (let attempt = 0; attempt < 2; attempt++) {
    await prisma.$executeRaw`UPDATE clinical_fact_extraction_runs SET next_attempt_at = NULL WHERE id = ${first.run.id}`;
    await work(failing);
  }
  retrying = await prisma.clinicalFactExtractionRun.findUniqueOrThrow({ where: { id: first.run.id } });
  check("after bounded attempts the run fails and frees the transcript", retrying.status === "FAILED" && retrying.failureCode === "TIMEOUT" && !retrying.activeKey);
  const second = await requestFactExtraction(actor, t.id);
  check("doctor can request a fresh run after a failure", second.created && second.run.id !== first.run.id);

  console.log(`Clinical fact extraction DB checks passed: ${checks}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : "Clinical fact extraction checks failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
