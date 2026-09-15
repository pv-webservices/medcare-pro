import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { confirmSpeaker, speakerConfirmationSchema } from "@/lib/transcription/transcripts";
export async function POST(request: Request, context: { params: Promise<{ transcriptId: string; speakerId: string }> }) {
  try { const actor = await requireActor(); const params = await context.params; return audioJson(await confirmSpeaker(actor, params.transcriptId, params.speakerId, speakerConfirmationSchema.parse(await readAudioJson(request)))); }
  catch (error) { return audioError(error); }
}
