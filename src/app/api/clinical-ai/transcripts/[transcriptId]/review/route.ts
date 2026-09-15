import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { reviewTranscript, reviewSchema } from "@/lib/transcription/transcripts";
export async function POST(request: Request, context: { params: Promise<{ transcriptId: string }> }) {
  try { const actor = await requireActor(); return audioJson(await reviewTranscript(actor, (await context.params).transcriptId, reviewSchema.parse(await readAudioJson(request)))); }
  catch (error) { return audioError(error); }
}
