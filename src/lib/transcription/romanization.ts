import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTranscript } from "./transcripts";
import { readBoundedProviderJson } from "./normalize";
import { TranscriptionFailure } from "./errors";
import type { ActorContext } from "@/lib/rbac";

const scripts: [RegExp, string][] = [[/\p{Script=Devanagari}/u, "hi-IN"], [/\p{Script=Bengali}/u, "bn-IN"], [/\p{Script=Gujarati}/u, "gu-IN"], [/\p{Script=Gurmukhi}/u, "pa-IN"], [/\p{Script=Oriya}/u, "od-IN"], [/\p{Script=Tamil}/u, "ta-IN"], [/\p{Script=Telugu}/u, "te-IN"], [/\p{Script=Kannada}/u, "kn-IN"], [/\p{Script=Malayalam}/u, "ml-IN"]];
export function romanizationLanguage(text: string, hint?: string | null) {
  const letters = [...text].filter(c => /\p{Letter}/u.test(c));
  if (letters.every(c => /\p{Script=Latin}/u.test(c))) return "PASSTHROUGH";
  const native = letters.filter(c => !/\p{Script=Latin}/u.test(c));
  const found = scripts.find(([pattern]) => native.every(c => pattern.test(c)));
  if (!found) return "UNSUPPORTED";
  if (found[1] === "hi-IN" && hint === "mr-IN") return hint;
  return found[1];
}
/** Grapheme-safe, lossless partition, conservatively bounded by UTF-16 length. */
export function splitTransliteration(text: string): string[] {
  const chunks: string[] = [];
  let pending = "";
  for (const entry of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (entry.segment.length > 1000) throw new TranscriptionFailure("INVALID_RESPONSE");
    if (pending.length + entry.segment.length > 1000) {
      const boundary = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"));
      if (boundary >= 500) { chunks.push(pending.slice(0, boundary + 1)); pending = pending.slice(boundary + 1); }
      else { chunks.push(pending); pending = ""; }
    }
    pending += entry.segment;
  }
  if (pending) chunks.push(pending);
  return chunks;
}
export class SarvamTransliterationClient {
  constructor(readonly apiKey = process.env.SARVAM_API_SUBSCRIPTION_KEY?.trim(), readonly transport: typeof fetch = fetch) {}
  async transliterate(input: string, sourceLanguageCode: string) {
    if (!this.apiKey || !input || input.length > 1000) throw new TranscriptionFailure("CONFIGURATION");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.transport("https://api.sarvam.ai/transliterate", { method: "POST", redirect: "error", headers: { "api-subscription-key": this.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ input, source_language_code: sourceLanguageCode, target_language_code: "en-IN", numerals_format: "international", spoken_form: false }), signal: AbortSignal.timeout(30_000) });
        if (!response.ok) { await response.body?.cancel(); throw new TranscriptionFailure(response.status === 429 ? "RATE_LIMIT" : "PROVIDER_FAILURE", response.status === 429 || response.status >= 500); }
        const result = z.object({ transliterated_text: z.string().min(1).max(16000), source_language_code: z.string() }).safeParse(await readBoundedProviderJson(response, 128 * 1024));
        if (!result.success || !result.data.transliterated_text.trim() || romanizationLanguage(result.data.transliterated_text) !== "PASSTHROUGH") throw new TranscriptionFailure("INVALID_RESPONSE");
        return result.data.transliterated_text;
      } catch (error) {
        const failure = error instanceof TranscriptionFailure ? error : new TranscriptionFailure("NETWORK", true);
        if (!failure.retryable || attempt === 2) throw failure;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw new TranscriptionFailure("PROVIDER_FAILURE");
  }
}
export async function getRomanizedView(actor: ActorContext, transcriptId: string) {
  const source = await getTranscript(actor, transcriptId);
  return prisma.transcriptDerivedView.findUnique({ where: { transcriptId_sourceHash_type: { transcriptId, sourceHash: source.sourceHash, type: "ROMANIZED" } }, select: { id: true, status: true, isPartial: true, segments: { select: { sourceSegmentId: true, text: true, status: true } } } });
}
export async function requestRomanization(actor: ActorContext, transcriptId: string) {
  const source = await getTranscript(actor, transcriptId);
  // Same explicit clinician transcription authority; audio need not exist.
  const { recordingForActor } = await import("@/lib/clinical-audio/recordingService");
  return prisma.$transaction(async tx => {
    const visible = await recordingForActor(actor, source.recordingId, "clinical-ai:transcription", tx, false);
    await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${visible.registrationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM consultation_recordings WHERE id = ${source.recordingId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM clinical_transcripts WHERE id = ${transcriptId} FOR UPDATE`;
    await recordingForActor(actor, source.recordingId, "clinical-ai:transcription", tx, false);
    const existing = await tx.transcriptDerivedView.findUnique({ where: { transcriptId_sourceHash_type: { transcriptId, sourceHash: source.sourceHash, type: "ROMANIZED" } }, select: { id: true, status: true } });
    return existing ?? tx.transcriptDerivedView.create({ data: { transcriptId, sourceHash: source.sourceHash, createdByUserId: actor.userId }, select: { id: true, status: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
export async function workRomanizationOnce(client = new SarvamTransliterationClient(), tenantId?: string) {
  const now = new Date();
  const scope = tenantId ?? null;
  const view = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT v.id FROM transcript_derived_views v JOIN clinical_transcripts t ON t.id = v.transcript_id WHERE v.status IN ('QUEUED','PROCESSING') AND (${scope} IS NULL OR t.tenant_id = ${scope}) AND (v.lease_expires_at IS NULL OR v.lease_expires_at <= ${now}) ORDER BY v.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    return tx.transcriptDerivedView.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000) }, include: { transcript: { include: { segments: { orderBy: { ordinal: "asc" } }, transcriptionRun: true } }, segments: true } });
  });
  if (!view) return 0;
  const renew = async () => {
    const changed = await prisma.transcriptDerivedView.updateMany({ where: { id: view.id, leaseToken: view.leaseToken, leaseExpiresAt: { gt: new Date() }, status: "PROCESSING" }, data: { leaseExpiresAt: new Date(Date.now() + 120_000) } });
    if (changed.count !== 1) throw new TranscriptionFailure("TIMEOUT");
  };
  try {
    await getTranscript({ userId: view.createdByUserId, tenantId: view.transcript.tenantId }, view.transcriptId);
    const { recordingForActor } = await import("@/lib/clinical-audio/recordingService");
    await recordingForActor({ userId: view.createdByUserId, tenantId: view.transcript.tenantId }, view.transcript.recordingId, "clinical-ai:transcription", prisma, false);
    for (const segment of view.transcript.segments) {
      if (view.segments.some(s => s.sourceSegmentId === segment.id)) continue;
      await renew();
      const language = romanizationLanguage(segment.text, view.transcript.transcriptionRun.languageCode);
      let text = segment.text;
      let status = language;
      if (!["PASSTHROUGH", "UNSUPPORTED"].includes(language)) {
        try {
          const parts: string[] = [];
          for (const chunk of splitTransliteration(segment.text)) { await renew(); const whitespace = chunk.match(/\s+$/u)?.[0] ?? ""; const input = chunk.slice(0, chunk.length - whitespace.length); parts.push(input ? await client.transliterate(input, language) + whitespace : chunk); }
          text = parts.join("");
          if (text.length > 16000) throw new TranscriptionFailure("INVALID_RESPONSE");
          status = "COMPLETED";
        } catch { status = "FAILED"; text = segment.text; }
      }
      await prisma.$transaction(async tx => {
        const changed = await tx.transcriptDerivedView.updateMany({ where: { id: view.id, leaseToken: view.leaseToken, leaseExpiresAt: { gt: new Date() } }, data: { isPartial: { set: status === "UNSUPPORTED" || status === "FAILED" || view.isPartial } } });
        if (changed.count !== 1) throw new TranscriptionFailure("TIMEOUT");
        await tx.transcriptDerivedSegment.create({ data: { derivedViewId: view.id, sourceSegmentId: segment.id, text, status, sourceLanguageCode: ["PASSTHROUGH", "UNSUPPORTED"].includes(language) ? null : language } });
      });
    }
    const partial = await prisma.transcriptDerivedSegment.count({ where: { derivedViewId: view.id, status: { in: ["UNSUPPORTED", "FAILED"] } } });
    await prisma.transcriptDerivedView.updateMany({ where: { id: view.id, leaseToken: view.leaseToken, leaseExpiresAt: { gt: new Date() } }, data: { status: "COMPLETED", isPartial: partial > 0, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } });
  } catch {
    await prisma.transcriptDerivedView.updateMany({ where: { id: view.id, leaseToken: view.leaseToken }, data: { status: "FAILED", isPartial: true, leaseToken: null, leaseExpiresAt: null } });
  }
  return 1;
}
