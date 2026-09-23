import { randomUUID } from "node:crypto";
import { workTranscriptionOnce } from "@/lib/transcription/worker";
import { workRomanizationOnce } from "@/lib/transcription/romanization";
import { workFactExtractionOnce } from "@/lib/clinical-facts/service";
import {
  authorizeClinicalAudioCron,
  cronFailure,
  cronJson,
} from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = authorizeClinicalAudioCron(request);
  if (denied) return denied;

  try {
    const workerId = `clinical-audio-http-${randomUUID()}`;
    const processed = await workTranscriptionOnce(workerId, undefined, 1);
    const romanized = await workRomanizationOnce();
    // No-op (0) unless CLINICAL_FACTS_ENABLED; at most one extraction run.
    const facts = await workFactExtractionOnce(workerId);
    return cronJson({ ok: true, processed, romanized, facts });
  } catch (error) {
    return cronFailure("worker", error);
  }
}
