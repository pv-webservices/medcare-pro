import { randomUUID } from "node:crypto";
import { workTranscriptionOnce } from "@/lib/transcription/worker";
import { workRomanizationOnce } from "@/lib/transcription/romanization";
import {
  authorizeClinicalAudioCron,
  cronJson,
} from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = authorizeClinicalAudioCron(request);
  if (denied) return denied;

  try {
    const processed = await workTranscriptionOnce(
      `clinical-audio-http-${randomUUID()}`,
      undefined,
      1,
    );
    const romanized = await workRomanizationOnce();
    return cronJson({ ok: true, processed, romanized });
  } catch {
    return cronJson({ ok: false }, 503);
  }
}
