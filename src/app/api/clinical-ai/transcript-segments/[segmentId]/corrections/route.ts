import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { addCorrection, correctionSchema } from "@/lib/transcription/transcripts";
export async function POST(request: Request, context: { params: Promise<{ segmentId: string }> }) {
  try { const actor = await requireActor(); return audioJson(await addCorrection(actor, (await context.params).segmentId, correctionSchema.parse(await readAudioJson(request)))); }
  catch (error) { return audioError(error); }
}
