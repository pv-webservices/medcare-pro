import { requireActor } from "@/lib/session";
import { audioError, audioJson } from "@/lib/clinical-audio/api";
import { getTranscript } from "@/lib/transcription/transcripts";
export async function GET(_request: Request, context: { params: Promise<{ transcriptId: string }> }) {
  try { return audioJson(await getTranscript(await requireActor(), (await context.params).transcriptId)); }
  catch (error) { return audioError(error); }
}
