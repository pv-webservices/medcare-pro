import { requireActor } from "@/lib/session";
import { audioError, audioJson } from "@/lib/clinical-audio/api";
import { latestTranscription } from "@/lib/transcription/service";
export async function GET(_request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try { return audioJson(await latestTranscription(await requireActor(), (await context.params).recordingId)); }
  catch (error) { return audioError(error); }
}
