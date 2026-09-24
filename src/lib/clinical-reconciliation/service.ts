import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { authorizeClinicalAudio } from "@/lib/clinical-audio/authorization";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import { getAcceptedTranscriptFacts } from "@/lib/clinical-facts/service";
import { ClinicalFactsDisabledError } from "@/lib/clinical-facts/config";
import { medicationSchema } from "@/lib/prescriptionValidation";
import { ClinicalReconciliationDisabledError, clinicalReconciliationEnabled } from "./config";
import { reconcilePrescription, type ReconcileFact } from "./reconcile";

/** The unsaved editor state, bounded exactly like a draft save. Never stored. */
export const reconciliationRequestSchema = z.strictObject({
  items: z
    .array(
      medicationSchema.pick({
        medicineGenericName: true,
        brandName: true,
        strength: true,
        frequency: true,
        durationValue: true,
        durationUnit: true,
      }),
    )
    .max(50),
  followUpInstructions: z.string().trim().max(4000).default(""),
});

/** Linked assigned Doctor of an editable draft, holding the fact-review
 * permission (PRD §12 Q4), plus the AI-4 kill switch. */
async function authorizeReconciliation(actor: ActorContext, registrationId: string) {
  if (!clinicalReconciliationEnabled()) throw new ClinicalReconciliationDisabledError();
  return authorizeClinicalAudio(actor, registrationId, "clinical-ai:facts-review");
}

export async function mayUseReconciliation(actor: ActorContext, registrationId: string) {
  if (!clinicalReconciliationEnabled()) return false;
  try {
    await authorizeReconciliation(actor, registrationId);
    return true;
  } catch (error) {
    if (
      error instanceof PermissionError ||
      error instanceof ScopeError ||
      error instanceof FeatureError ||
      error instanceof ClinicalAudioDisabledError ||
      error instanceof ClinicalFactsDisabledError ||
      error instanceof ClinicalReconciliationDisabledError
    )
      return false;
    throw error;
  }
}

/**
 * AI-4: compare the doctor's current (unsaved) draft with the facts they
 * accepted from every current transcript review of this visit. Read-only:
 * nothing is persisted and no provider is called.
 */
export async function reconcileDraft(actor: ActorContext, registrationId: string, raw: unknown) {
  const draft = reconciliationRequestSchema.parse(raw);
  const visit = await authorizeReconciliation(actor, registrationId);
  const transcripts = await prisma.clinicalTranscript.findMany({
    where: { tenantId: actor.tenantId, registrationId: visit.id, clinicId: visit.clinicId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const perTranscript = await Promise.all(
    transcripts.map(async ({ id }) => ({ transcriptId: id, facts: await getAcceptedTranscriptFacts(actor, id) })),
  );
  const facts = perTranscript.flatMap(({ facts }) => facts) as ReconcileFact[];
  const segmentIds = [...new Set(facts.flatMap((fact) => fact.evidence.map((e) => e.segmentId)))];
  const segments = segmentIds.length
    ? await prisma.clinicalTranscriptSegment.findMany({
        where: { id: { in: segmentIds }, transcriptId: { in: transcripts.map((t) => t.id) } },
        select: { id: true, startMs: true },
      })
    : [];
  const startMs = new Map(segments.map((segment) => [segment.id, segment.startMs]));
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const report = reconcilePrescription(facts, {
    items: draft.items.map((item) => ({
      medicineGenericName: item.medicineGenericName,
      brandName: item.brandName,
      strength: item.strength,
      frequency: item.frequency,
      durationValue: item.durationValue,
      durationUnit: item.durationUnit,
    })),
    followUpInstructions: draft.followUpInstructions,
  });
  return {
    ...report,
    acceptedFacts: facts.length,
    results: report.results.map((result) => ({
      ...result,
      evidence: (byId.get(result.factId)?.evidence ?? []).map((e) => ({
        segmentId: e.segmentId,
        quote: e.quote,
        startMs: startMs.get(e.segmentId) ?? null,
      })),
    })),
  };
}
