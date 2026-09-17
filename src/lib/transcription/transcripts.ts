import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ScopeError, type ActorContext } from "@/lib/rbac";
import { ConflictError } from "@/lib/domainErrors";
import { recordingForActor } from "@/lib/clinical-audio/recordingService";
import { transcriptionAudit } from "./service";

export const speakerConfirmationSchema = z.strictObject({ speakerType: z.enum(["UNKNOWN", "DOCTOR", "PATIENT", "CAREGIVER", "OTHER"]), expectedVersion: z.number().int().positive() });
export const correctionSchema = z.strictObject({ correctedText: z.string().min(1).max(16_000).refine((text) => !!text.trim()), expectedVersion: z.number().int().positive() });
export const reviewSchema = z.strictObject({ attested: z.literal(true), expectedVersion: z.number().int().positive() });
const include = { segments: { orderBy: { ordinal: "asc" as const } }, speakerMappings: true, corrections: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] }, transcriptionRun: true };
async function authorizedTranscript(actor: ActorContext, id: string, tx: Prisma.TransactionClient, mutation = false) {
  const transcript = await tx.clinicalTranscript.findFirst({ where: { id, tenantId: actor.tenantId }, include });
  if (!transcript) throw new ScopeError();
  const recording = await recordingForActor(actor, transcript.recordingId, mutation ? "clinical-ai:transcription" : "clinical-ai:transcript-read", tx, false);
  const run = transcript.transcriptionRun;
  if (transcript.clinicId !== recording.clinicId || transcript.registrationId !== recording.registrationId || run.recordingId !== recording.id || run.tenantId !== actor.tenantId || run.clinicId !== recording.clinicId || run.registrationId !== recording.registrationId || run.status !== "COMPLETED") throw new ScopeError();
  return transcript;
}
export async function getTranscript(actor: ActorContext, id: string) {
  const transcript = await authorizedTranscript(actor, id, prisma);
  return { id: transcript.id, recordingId: transcript.recordingId, version: transcript.version, sourceText: transcript.sourceText, sourceHash: transcript.sourceHash, languageCode: transcript.transcriptionRun.languageCode, reviewedAt: transcript.reviewedAt, reviewedByUserId: transcript.reviewedByUserId, speakers: transcript.speakerMappings.map((mapping) => ({ id: mapping.id, speakerLabel: mapping.speakerLabel, speakerType: mapping.speakerType, confirmedAt: mapping.confirmedAt, confirmedByUserId: mapping.confirmedByUserId })), segments: transcript.segments.map((segment) => ({ ...segment, corrections: transcript.corrections.filter((correction) => correction.segmentId === segment.id) })) };
}
async function mutateTranscript<T>(actor: ActorContext, id: string, expectedVersion: number, work: (tx: Prisma.TransactionClient, transcript: Awaited<ReturnType<typeof authorizedTranscript>>) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const visible = await authorizedTranscript(actor, id, tx, true);
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.registrationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${visible.recordingId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM clinical_transcripts WHERE id = ${id} FOR UPDATE`;
    const transcript = await authorizedTranscript(actor, id, tx, true);
    if (transcript.version !== expectedVersion) throw new ConflictError("Transcript changed. Reload before saving.");
    return work(tx, transcript);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
async function invalidate(tx: Prisma.TransactionClient, actor: ActorContext, transcript: Awaited<ReturnType<typeof authorizedTranscript>>) {
  await tx.clinicalTranscript.update({ where: { id: transcript.id }, data: { version: { increment: 1 }, reviewedAt: null, reviewedByUserId: null } });
  if (transcript.reviewedAt) await transcriptionAudit(tx, actor, transcript.transcriptionRun, "review-invalidated", { transcriptId: transcript.id });
}
export async function confirmSpeaker(actor: ActorContext, transcriptId: string, mappingId: string, input: z.infer<typeof speakerConfirmationSchema>) {
  return mutateTranscript(actor, transcriptId, input.expectedVersion, async (tx, transcript) => {
    if (!transcript.speakerMappings.some((mapping) => mapping.id === mappingId)) throw new ScopeError();
    if (input.speakerType === "DOCTOR" && transcript.speakerMappings.some((mapping) => mapping.id !== mappingId && mapping.speakerType === "DOCTOR")) throw new ConflictError("Only one Doctor speaker may be confirmed.");
    await tx.transcriptSpeakerMapping.update({ where: { id: mappingId }, data: { speakerType: input.speakerType, confirmedAt: input.speakerType === "UNKNOWN" ? null : new Date(), confirmedByUserId: input.speakerType === "UNKNOWN" ? null : actor.userId } });
    await invalidate(tx, actor, transcript);
    await transcriptionAudit(tx, actor, transcript.transcriptionRun, "speaker-confirmed", { transcriptId, speakerMappingId: mappingId, speakerType: input.speakerType });
    return { saved: true };
  });
}
export async function addCorrection(actor: ActorContext, segmentId: string, input: z.infer<typeof correctionSchema>) {
  const segment = await prisma.clinicalTranscriptSegment.findFirst({ where: { id: segmentId, transcript: { tenantId: actor.tenantId } }, select: { transcriptId: true } });
  if (!segment) throw new ScopeError();
  return mutateTranscript(actor, segment.transcriptId, input.expectedVersion, async (tx, transcript) => {
    const original = transcript.segments.find((entry) => entry.id === segmentId);
    if (!original) throw new ScopeError();
    const history = transcript.corrections.filter((entry) => entry.segmentId === segmentId);
    const supersededIds = new Set(history.map((entry) => entry.supersedesCorrectionId));
    const latest = history.find((entry) => !supersededIds.has(entry.id));
    await tx.transcriptCorrection.create({ data: { transcriptId: transcript.id, segmentId, createdById: actor.userId, originalText: original.text, correctedText: input.correctedText, supersedesCorrectionId: latest?.id ?? null } });
    await invalidate(tx, actor, transcript);
    await transcriptionAudit(tx, actor, transcript.transcriptionRun, "correction-added", { transcriptId: transcript.id, segmentId });
    return { saved: true };
  });
}
export async function reviewTranscript(actor: ActorContext, transcriptId: string, input: z.infer<typeof reviewSchema>) {
  return mutateTranscript(actor, transcriptId, input.expectedVersion, async (tx, transcript) => {
    const mappings = transcript.speakerMappings;
    if (!mappings.length || mappings.some((mapping) => mapping.speakerType === "UNKNOWN" || !mapping.confirmedAt) || mappings.filter((mapping) => mapping.speakerType === "DOCTOR").length !== 1 || !mappings.some((mapping) => mapping.speakerType === "PATIENT")) throw new ConflictError("Confirm all speakers, including Doctor and Patient, before review.");
    await tx.clinicalTranscript.update({ where: { id: transcriptId }, data: { version: { increment: 1 }, reviewedAt: new Date(), reviewedByUserId: actor.userId } });
    await transcriptionAudit(tx, actor, transcript.transcriptionRun, "reviewed", { transcriptId });
    return { saved: true };
  });
}
