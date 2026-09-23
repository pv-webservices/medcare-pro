import { createHash, randomUUID } from "node:crypto";
import { Prisma, type ClinicalFactExtractionRun } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { ConflictError } from "@/lib/domainErrors";
import { FeatureError } from "@/lib/featureResolution";
import { writeAuditLog } from "@/lib/audit";
import { getAiConfig } from "@/lib/ai/config";
import { getAiProvider } from "@/lib/ai/provider";
import { AiError } from "@/lib/ai/errors";
import type { AiProvider } from "@/lib/ai/types";
import { completeAiRun, reserveAiRun } from "@/lib/ai/usage";
import { recordingForActor } from "@/lib/clinical-audio/recordingService";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import type { AudioPermission } from "@/lib/clinical-audio/authorization";
import { getCurrentTranscriptReview } from "@/lib/transcription/transcripts";
import {
  ClinicalFactsDisabledError,
  clinicalFactsEnabled,
  FACT_CHUNK_MAX_CHARS,
  FACT_CHUNK_OVERLAP_SEGMENTS,
  FACT_INSTRUCTION,
  FACT_LEASE_MS,
  FACT_MAX_ATTEMPTS,
  FACT_MAX_REQUESTS_PER_REVIEW,
  FACT_PROMPT_VERSION,
  FACT_SCHEMA_VERSION,
} from "./config";
import { factExtractionOutputSchema, type FactReviewInput } from "./schema";
import {
  chunkSegments,
  conflictingFactKeys,
  conflictKeyOf,
  mergeFacts,
  validateFactCandidate,
  type FactRejection,
  type ValidatedFact,
} from "./evidence";

const ACTIVE = ["QUEUED", "PROCESSING"];
const RETRYABLE = new Set(["TIMEOUT", "NETWORK", "RATE_LIMIT", "QUOTA", "INVALID_OUTPUT", "LEASE_LOST"]);
const released = { leaseToken: null, leaseExpiresAt: null };

class FactRunFailure extends Error {
  constructor(public readonly failure: string) {
    super(failure);
    this.name = "FactRunFailure";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static [Symbol.hasInstance](instance: unknown): boolean {
    return (
      typeof instance === "object" &&
      instance !== null &&
      (instance as Error).name === "FactRunFailure" &&
      "failure" in instance
    );
  }
}

/** Same live chain as AI-2 (active actor, tenant/clinic scope, linked assigned
 * Doctor, entitlement, permission) plus the AI-3 kill switch. */
async function authorizeTranscriptFacts(
  actor: ActorContext,
  transcriptId: string,
  permission: AudioPermission,
  tx: Prisma.TransactionClient = prisma,
) {
  if (!clinicalFactsEnabled()) throw new ClinicalFactsDisabledError();
  const transcript = await tx.clinicalTranscript.findFirst({
    where: { id: transcriptId, tenantId: actor.tenantId },
    select: { id: true, recordingId: true, registrationId: true, clinicId: true },
  });
  if (!transcript) throw new ScopeError();
  const recording = await recordingForActor(
    actor,
    transcript.recordingId,
    permission,
    tx,
    permission === "clinical-ai:transcript-read" ? false : undefined,
  );
  if (recording.registrationId !== transcript.registrationId || recording.clinicId !== transcript.clinicId)
    throw new ScopeError();
  return transcript;
}

function publicRun(run: ClinicalFactExtractionRun) {
  return {
    id: run.id,
    status: run.status,
    failure: run.failureCode,
    candidateCount: run.candidateCount,
    rejectedCount: run.rejectedCount,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

async function factAudit(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  action: string,
  runId: string,
  metadata: Record<string, string | number | boolean | null>,
) {
  await writeAuditLog(tx, {
    action,
    targetType: "ClinicalFactExtractionRun",
    targetId: runId,
    actorUserId: actor.userId,
    actorTenantId: actor.tenantId,
    afterValue: { runId, ...metadata },
  });
}

/** Explicit doctor action. Idempotent per review snapshot and pipeline
 * version: repeats return the same run and never pay for a second call. */
export async function requestFactExtraction(actor: ActorContext, transcriptId: string) {
  await authorizeTranscriptFacts(actor, transcriptId, "clinical-ai:facts-extract");
  const review = await getCurrentTranscriptReview(actor, transcriptId);
  if (!review) throw new ConflictError("Review the transcript before extracting facts.");
  const config = getAiConfig();
  if (!config) throw new ClinicalFactsDisabledError();
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM clinical_transcripts WHERE id = ${transcriptId} FOR UPDATE`;
      const transcript = await authorizeTranscriptFacts(actor, transcriptId, "clinical-ai:facts-extract", tx);
      // Repeats of the same request share a key; each terminal failure opens
      // a new key so the doctor can retry, up to a bounded number of times.
      const failures = await tx.clinicalFactExtractionRun.count({
        where: { transcriptReviewId: review.id, status: "FAILED" },
      });
      if (failures >= FACT_MAX_REQUESTS_PER_REVIEW)
        throw new ConflictError("Fact extraction keeps failing for this transcript. Contact support.");
      const idempotencyKey = createHash("sha256")
        .update([review.id, FACT_PROMPT_VERSION, FACT_SCHEMA_VERSION, failures].join("|"))
        .digest("hex");
      const existing = await tx.clinicalFactExtractionRun.findUnique({ where: { idempotencyKey } });
      if (existing) return { run: publicRun(existing), created: false };
      if (await tx.clinicalFactExtractionRun.findUnique({ where: { activeKey: transcriptId } }))
        throw new ConflictError("A fact extraction is already running for this transcript.");
      const run = await tx.clinicalFactExtractionRun.create({
        data: {
          tenantId: actor.tenantId,
          clinicId: transcript.clinicId,
          registrationId: transcript.registrationId,
          transcriptId,
          transcriptReviewId: review.id,
          effectiveHash: review.effectiveHash,
          provider: config.provider,
          model: config.model,
          promptVersion: FACT_PROMPT_VERSION,
          schemaVersion: FACT_SCHEMA_VERSION,
          activeKey: transcriptId,
          idempotencyKey,
          requestedByUserId: actor.userId,
        },
      });
      await factAudit(tx, actor, "CLINICAL_FACT_EXTRACTION_REQUESTED", run.id, { transcriptId, status: run.status });
      return { run: publicRun(run), created: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export async function claimNextFactRun(workerId: string, tenantId?: string) {
  const now = new Date();
  const scope = tenantId ?? null;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinical_fact_extraction_runs WHERE status IN ('QUEUED','PROCESSING') AND (${scope} IS NULL OR tenant_id = ${scope}) AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}) AND (lease_expires_at IS NULL OR lease_expires_at <= ${now}) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    const run = await tx.clinicalFactExtractionRun.findUniqueOrThrow({ where: { id: rows[0].id } });
    return tx.clinicalFactExtractionRun.update({
      where: { id: run.id },
      data: {
        status: "PROCESSING",
        startedAt: run.startedAt ?? now,
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + FACT_LEASE_MS),
      },
    });
  });
}

async function renewLease(run: ClinicalFactExtractionRun) {
  const changed = await prisma.clinicalFactExtractionRun.updateMany({
    where: { id: run.id, leaseToken: run.leaseToken, leaseExpiresAt: { gt: new Date() } },
    data: { leaseExpiresAt: new Date(Date.now() + FACT_LEASE_MS) },
  });
  if (changed.count !== 1) throw new FactRunFailure("LEASE_LOST");
}

/** One bounded worker pass: at most one extraction run. Called from the
 * internal cron route; `provider` and `tenantId` are injected by tests. */
export async function workFactExtractionOnce(
  workerId: string,
  dependencies: { provider?: AiProvider; tenantId?: string } = {},
) {
  if (!clinicalFactsEnabled()) return 0;
  const run = await claimNextFactRun(workerId, dependencies.tenantId);
  if (!run) return 0;
  await processFactRun(run, dependencies.provider);
  return 1;
}

async function processFactRun(run: ClinicalFactExtractionRun, injected?: AiProvider) {
  const actor = { userId: run.requestedByUserId, tenantId: run.tenantId };
  const start = Date.now();
  let aiRunId: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    // The requesting doctor must still be authorized, and the transcript must
    // still be exactly what was reviewed, at processing time.
    let review: Awaited<ReturnType<typeof getCurrentTranscriptReview>>;
    try {
      await authorizeTranscriptFacts(actor, run.transcriptId, "clinical-ai:facts-extract");
      review = await getCurrentTranscriptReview(actor, run.transcriptId);
    } catch (error) {
      if (error instanceof PermissionError || error instanceof ScopeError || error instanceof FeatureError || error instanceof ClinicalAudioDisabledError || error instanceof ClinicalFactsDisabledError)
        throw new FactRunFailure("NOT_AUTHORIZED");
      throw error;
    }
    if (!review || review.id !== run.transcriptReviewId || review.effectiveHash !== run.effectiveHash)
      throw new FactRunFailure("STALE");
    const config = getAiConfig();
    if (!config) throw new FactRunFailure("DISABLED");
    const chunks = chunkSegments(review.segments, FACT_CHUNK_MAX_CHARS, FACT_CHUNK_OVERLAP_SEGMENTS);
    const aiRun = await reserveAiRun(
      actor,
      run.clinicId,
      {
        registrationId: run.registrationId,
        feature: "clinical_facts",
        field: "transcript",
        mode: "EXTRACT",
        inputCharacterCount: review.segments.reduce((sum, s) => sum + s.text.length, 0),
      },
      config,
    );
    aiRunId = aiRun.id;
    const provider = injected ?? getAiProvider();
    const accepted: ValidatedFact[] = [];
    const rejections: Partial<Record<FactRejection | "SCHEMA", number>> = {};
    let proposed = 0;
    for (const chunk of chunks) {
      await renewLease(run);
      const response = await provider.generateStructured<unknown>({
        task: "clinical-fact-extraction",
        systemInstruction: FACT_INSTRUCTION,
        // Minimized input: segment ids, confirmed roles and text only.
        input: { segments: chunk.map((s) => ({ id: s.segmentId, speaker: s.speakerType, text: s.text })) },
        schema: z.toJSONSchema(factExtractionOutputSchema),
      });
      inputTokens += response.inputTokens ?? 0;
      outputTokens += response.outputTokens ?? 0;
      const parsed = factExtractionOutputSchema.safeParse(response.output);
      if (!parsed.success) throw new AiError("INVALID_OUTPUT");
      for (const candidate of parsed.data.facts) {
        proposed++;
        // Evidence may only cite segments the provider was shown.
        const result = validateFactCandidate(candidate, chunk);
        if (result.ok) accepted.push(result.fact);
        else rejections[result.reason] = (rejections[result.reason] ?? 0) + 1;
      }
    }
    const facts = mergeFacts(accepted);
    const rejectedCount = proposed - accepted.length;
    await prisma.$transaction(async (tx) => {
      const current = await tx.clinicalFactExtractionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (current.leaseToken !== run.leaseToken || current.status !== "PROCESSING" || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date())
        throw new FactRunFailure("LEASE_LOST");
      for (const fact of facts)
        await tx.clinicalFactCandidate.create({
          data: {
            tenantId: run.tenantId,
            clinicId: run.clinicId,
            registrationId: run.registrationId,
            extractionRunId: run.id,
            category: fact.category,
            assertion: fact.assertion,
            subject: fact.subject,
            statement: fact.statement,
            attributes: fact.attributes,
            evidence: { create: fact.evidence },
          },
        });
      await tx.clinicalFactExtractionRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          activeKey: null,
          failureCode: null,
          nextAttemptAt: null,
          chunkCount: chunks.length,
          candidateCount: facts.length,
          rejectedCount,
          rejectionCounts: rejections,
          completedAt: new Date(),
          ...released,
        },
      });
      await factAudit(tx, actor, "CLINICAL_FACT_EXTRACTION_COMPLETED", run.id, {
        transcriptId: run.transcriptId,
        candidateCount: facts.length,
        rejectedCount,
        chunkCount: chunks.length,
      });
    });
    await completeAiRun(actor, aiRunId, { status: "SUCCEEDED", outputCharacterCount: 0, latencyMs: Date.now() - start, inputTokens, outputTokens });
  } catch (error) {
    const failure =
      error instanceof FactRunFailure || (typeof error === "object" && error !== null && (error as Error).name === "FactRunFailure" && "failure" in error)
        ? (error as FactRunFailure).failure
        : error instanceof AiError || (typeof error === "object" && error !== null && ((error as Error).name === "AiError" || "code" in error))
          ? (error as AiError).code
          : "FAILED";
    if (aiRunId)
      await completeAiRun(actor, aiRunId, { status: failure, outputCharacterCount: 0, latencyMs: Date.now() - start, inputTokens, outputTokens }).catch(() => undefined);
    await failFactRun(run, failure);
  }
}

async function failFactRun(run: ClinicalFactExtractionRun, failure: string) {
  const retry = RETRYABLE.has(failure) && run.attemptNumber < FACT_MAX_ATTEMPTS;
  await prisma.$transaction(async (tx) => {
    const changed = await tx.clinicalFactExtractionRun.updateMany({
      where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } },
      data: retry
        ? { status: "QUEUED", failureCode: failure, attemptNumber: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** (run.attemptNumber - 1)), ...released }
        : { status: "FAILED", failureCode: failure, activeKey: null, completedAt: new Date(), nextAttemptAt: null, ...released },
    });
    if (changed.count === 1 && !retry)
      await factAudit(tx, { userId: run.requestedByUserId, tenantId: run.tenantId }, "CLINICAL_FACT_EXTRACTION_FAILED", run.id, { transcriptId: run.transcriptId, failure });
  });
}

// Millisecond timestamps can tie; cuid ids break ties in creation order.
const latestReview = {
  orderBy: [{ reviewedAt: "desc" as const }, { id: "desc" as const }],
  take: 1,
};
const factInclude = { evidence: true, reviews: latestReview };
type FactWithRelations = Prisma.ClinicalFactCandidateGetPayload<{ include: typeof factInclude }>;

function publicFact(fact: FactWithRelations, conflicts: Set<string>) {
  const attributes = fact.attributes as Record<string, string>;
  return {
    id: fact.id,
    category: fact.category,
    assertion: fact.assertion,
    subject: fact.subject,
    statement: fact.statement,
    attributes,
    evidence: fact.evidence.map((e) => ({ segmentId: e.segmentId, speakerType: e.speakerType, quote: e.quote, charStart: e.charStart, charEnd: e.charEnd })),
    decision: fact.reviews[0]?.decision ?? null,
    conflicting: conflicts.has(conflictKeyOf({ category: fact.category as ValidatedFact["category"], subject: fact.subject as ValidatedFact["subject"], attributes })),
  };
}

/** Latest extraction for the transcript, with staleness derived at read time. */
export async function listTranscriptFacts(actor: ActorContext, transcriptId: string) {
  await authorizeTranscriptFacts(actor, transcriptId, "clinical-ai:transcript-read");
  const current = await getCurrentTranscriptReview(actor, transcriptId);
  const run = await prisma.clinicalFactExtractionRun.findFirst({
    where: { transcriptId, tenantId: actor.tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { facts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: factInclude } },
  });
  const stale = !!run && (!current || run.transcriptReviewId !== current.id);
  const conflicts = conflictingFactKeys(
    (run?.facts ?? []).map((f) => ({
      category: f.category as ValidatedFact["category"],
      subject: f.subject as ValidatedFact["subject"],
      assertion: f.assertion as ValidatedFact["assertion"],
      attributes: f.attributes as Record<string, string>,
    })),
  );
  return {
    canExtract: !!current,
    run: run ? { ...publicRun(run), stale } : null,
    facts: (run?.facts ?? []).map((fact) => publicFact(fact, conflicts)),
  };
}

/** Explicit per-fact Accept/Dismiss (no bulk accept). Append-only. */
export async function reviewFact(actor: ActorContext, factId: string, input: FactReviewInput) {
  const fact = await prisma.clinicalFactCandidate.findFirst({
    where: { id: factId, tenantId: actor.tenantId },
    include: { extractionRun: true },
  });
  if (!fact) throw new ScopeError();
  const run = fact.extractionRun;
  await authorizeTranscriptFacts(actor, run.transcriptId, "clinical-ai:facts-review");
  const current = await getCurrentTranscriptReview(actor, run.transcriptId);
  if (run.status !== "COMPLETED" || !current || current.id !== run.transcriptReviewId)
    throw new ConflictError("These facts are out of date. Extract facts again from the reviewed transcript.");
  return prisma.$transaction(async (tx) => {
    const review = await tx.clinicalFactReview.create({
      data: { tenantId: actor.tenantId, factId, decision: input.decision, reason: input.reason || null, reviewedByUserId: actor.userId },
    });
    await factAudit(tx, actor, "CLINICAL_FACT_REVIEWED", run.id, { factId, decision: review.decision });
    return { saved: true, decision: review.decision };
  });
}

/** AI-4 input contract: only doctor-accepted facts of the CURRENT review. */
export async function getAcceptedTranscriptFacts(actor: ActorContext, transcriptId: string) {
  const listing = await listTranscriptFacts(actor, transcriptId);
  if (!listing.run || listing.run.stale || listing.run.status !== "COMPLETED") return [];
  return listing.facts.filter((fact) => fact.decision === "ACCEPTED");
}
