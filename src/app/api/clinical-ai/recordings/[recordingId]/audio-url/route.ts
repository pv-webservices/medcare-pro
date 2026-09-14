import { requireActor } from "@/lib/session";
import { audioError, audioJson } from "@/lib/clinical-audio/api";
import { getRecordingAudioUrl } from "@/lib/clinical-audio/uploadService";
type Context = { params: Promise<{ recordingId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { recordingId } = await context.params;
    return audioJson(await getRecordingAudioUrl(actor, recordingId));
  } catch (e) {
    return audioError(e);
  }
}
