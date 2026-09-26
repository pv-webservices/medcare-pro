import { prisma } from "@/lib/prisma";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { getClinicalAudioConfig } from "@/lib/clinical-audio/config";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import { clinicalFactsEnabled, ClinicalFactsDisabledError } from "@/lib/clinical-facts/config";
import { getAcceptedTranscriptFacts } from "@/lib/clinical-facts/service";
import { ACTIVE_TRANSCRIPTION_STATUSES } from "@/lib/transcription/types";
import type { AllergyInput, AudioInput } from "./rules";

const denied = (error: unknown) =>
  error instanceof PermissionError ||
  error instanceof ScopeError ||
  error instanceof FeatureError ||
  error instanceof ClinicalAudioDisabledError ||
  error instanceof ClinicalFactsDisabledError;

/** Accepted AI-3 allergy facts of every current review of the visit, or null
 * when facts are off or this actor may not read them (PC-07 is then skipped). */
async function acceptedAllergies(actor: ActorContext, registrationId: string): Promise<AllergyInput[] | null> {
  if (!clinicalFactsEnabled()) return null;
  const transcripts = await prisma.clinicalTranscript.findMany({
    where: { tenantId: actor.tenantId, registrationId },
    select: { id: true },
  });
  try {
    const facts = (await Promise.all(transcripts.map(({ id }) => getAcceptedTranscriptFacts(actor, id)))).flat();
    const allergies = facts.filter(
      (fact) => fact.category === "ALLERGY" && fact.assertion === "PRESENT" && fact.subject === "PATIENT",
    );
    const segmentIds = allergies.flatMap((fact) => fact.evidence.map((e) => e.segmentId));
    const segments = segmentIds.length
      ? await prisma.clinicalTranscriptSegment.findMany({
          where: { id: { in: segmentIds }, transcriptId: { in: transcripts.map((t) => t.id) } },
          select: { id: true, startMs: true },
        })
      : [];
    const startMs = new Map(segments.map((segment) => [segment.id, segment.startMs]));
    return allergies.map((fact) => ({
      substance: fact.attributes.substance ?? "",
      startMs: startMs.get(fact.evidence[0]?.segmentId ?? "") ?? null,
    }));
  } catch (error) {
    if (denied(error)) return null;
    throw error;
  }
}

/** Counts only (no transcript text): READY recordings still transcribing or
 * never transcribed, and transcripts with no review of their current version. */
async function audioState(actor: ActorContext, registrationId: string): Promise<AudioInput | null> {
  if (process.env.AI_ENABLED !== "true" || !getClinicalAudioConfig()) return null;
  const recordings = await prisma.consultationRecording.findMany({
    where: { tenantId: actor.tenantId, registrationId, status: "READY" },
    select: {
      audioDeletedAt: true,
      transcriptionRuns: { orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: 1, select: { status: true } },
      clinicalTranscripts: { select: { id: true, version: true, reviews: { select: { transcriptVersion: true } } } },
    },
  });
  const active = new Set<string>(ACTIVE_TRANSCRIPTION_STATUSES);
  let processing = 0;
  let untranscribed = 0;
  let unreviewed = 0;
  for (const recording of recordings) {
    if (active.has(recording.transcriptionRuns[0]?.status ?? "")) processing++;
    else if (!recording.clinicalTranscripts.length && !recording.audioDeletedAt) untranscribed++;
    unreviewed += recording.clinicalTranscripts.filter(
      (t) => !t.reviews.some((review) => review.transcriptVersion === t.version),
    ).length;
  }
  return { processing, untranscribed, unreviewed };
}

export async function loadCheckContext(actor: ActorContext, registrationId: string) {
  const [allergies, audio] = await Promise.all([
    acceptedAllergies(actor, registrationId),
    audioState(actor, registrationId),
  ]);
  return { allergies, audio };
}
