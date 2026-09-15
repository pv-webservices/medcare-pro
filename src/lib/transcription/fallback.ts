import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { ConflictError } from "@/lib/apiHandler";
import { writeAuditLog } from "@/lib/audit";
import { getGeminiTranscriptionConfig, GEMINI_DIARIZED_MAX_DURATION_MS } from "./providers/gemini";
import { retainedRecording, publicRun, transcriptionAudit } from "./service";

const eligibleFailures = new Set(["AUTH", "QUOTA", "RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_FAILURE", "INVALID_RESPONSE"]);
export async function getFallbackSettings(actor: ActorContext) {
  await requirePermission(actor, "feature:view");
  const tenant = await prisma.tenant.findFirst({ where: { id: actor.tenantId, isPlatform: false, status: "ACTIVE" }, select: { allowGeminiTranscriptionFallback: true } });
  if (!tenant) throw new ScopeError();
  return tenant;
}
export async function setFallbackSettings(actor: ActorContext, allowed: boolean) {
  return prisma.$transaction(async tx => {
    await requirePermission(actor, "feature:manage", undefined, tx);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    const tenant = await tx.tenant.findFirst({ where: { id: actor.tenantId, isPlatform: false, status: "ACTIVE" } });
    if (!tenant) throw new ScopeError();
    if (tenant.allowGeminiTranscriptionFallback !== allowed) {
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { allowGeminiTranscriptionFallback: allowed } });
      await writeAuditLog(tx, { action: allowed ? "GEMINI_TRANSCRIPTION_FALLBACK_ENABLED" : "GEMINI_TRANSCRIPTION_FALLBACK_DISABLED", targetType: "Tenant", targetId: actor.tenantId, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { allowed } });
    }
    return { allowGeminiTranscriptionFallback: allowed };
  });
}
export async function fallbackEligibility(actor: ActorContext, recordingId: string, tx: Prisma.TransactionClient = prisma) {
  const recording = await retainedRecording(actor, recordingId, tx);
  if (recording.durationMs! > GEMINI_DIARIZED_MAX_DURATION_MS) return { available: false, reason: "DURATION_LIMIT" as const };
  getGeminiTranscriptionConfig();
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
  if (!tenant.allowGeminiTranscriptionFallback) return { available: false, reason: "TENANT_DISABLED" as const };
  if (await tx.clinicalTranscript.count({ where: { recordingId, tenantId: actor.tenantId } })) return { available: false, reason: "SOURCE_EXISTS" as const };
  const primary = await tx.transcriptionRun.findFirst({ where: { recordingId, tenantId: actor.tenantId, provider: "SARVAM" }, orderBy: [{ queuedAt: "desc" }, { id: "desc" }] });
  if (!primary || !["FAILED", "TIMED_OUT"].includes(primary.status) || !eligibleFailures.has(primary.failureCode ?? "")) return { available: false, reason: "PRIMARY_NOT_ELIGIBLE" as const };
  return { available: true, reason: null, primary, recording };
}
export async function requestGeminiFallback(actor: ActorContext, recordingId: string) {
  await retainedRecording(actor, recordingId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    const visible = await retainedRecording(actor, recordingId, tx);
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.registrationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${recordingId} FOR UPDATE`;
    const eligibility = await fallbackEligibility(actor, recordingId, tx);
    if (!eligibility.available || !eligibility.primary || !eligibility.recording) throw new ConflictError("Gemini fallback is unavailable for this recording.");
    const existing = await tx.transcriptionRun.findUnique({ where: { fallbackKey: eligibility.primary.id } });
    if (existing) return { run: publicRun(existing), created: false };
    if (await tx.transcriptionRun.findUnique({ where: { activeKey: recordingId } })) throw new ConflictError("Transcription is already active.");
    const run = await tx.transcriptionRun.create({ data: { tenantId: actor.tenantId, clinicId: visible.clinicId, registrationId: visible.registrationId, recordingId, requestedByUserId: actor.userId, provider: "GEMINI", model: "gemini-3.5-transcribe", activeKey: recordingId, fallbackKey: eligibility.primary.id, fallbackFromRunId: eligibility.primary.id, audioDurationMs: visible.durationMs, audioBytes: visible.byteSize, requestedSpeakerCount: 2 } });
    await transcriptionAudit(tx, actor, run, "FALLBACK_REQUESTED");
    return { run: publicRun(run), created: true };
  });
}
