import { z } from "zod";
import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { fallbackEligibility, requestGeminiFallback } from "@/lib/transcription/fallback";
export async function GET(_request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try { const result = await fallbackEligibility(await requireActor(), (await context.params).recordingId); return audioJson({ available: result.available, reason: result.reason }); }
  catch (error) { return audioError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try { const actor = await requireActor(); z.strictObject({ confirmed: z.literal(true) }).parse(await readAudioJson(request)); const result = await requestGeminiFallback(actor, (await context.params).recordingId); return audioJson(result.run, result.created ? 201 : 200); }
  catch (error) { return audioError(error); }
}
