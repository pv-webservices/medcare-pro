import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import {
  initRecordingUpload,
  signRecordingPart,
  completeRecordingUpload,
  discardRecording,
} from "@/lib/clinical-audio/uploadService";
import { ScopeError } from "@/lib/rbac";
type Context = { params: Promise<{ recordingId: string; operation: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { recordingId, operation } = await context.params;
    const input = await readAudioJson(request);
    if (operation === "init")
      return audioJson(await initRecordingUpload(actor, recordingId, input));
    if (operation === "part")
      return audioJson(await signRecordingPart(actor, recordingId, input));
    if (operation === "complete")
      return audioJson(
        await completeRecordingUpload(actor, recordingId, input),
      );
    if (operation === "abort")
      return audioJson(await discardRecording(actor, recordingId));
    throw new ScopeError();
  } catch (e) {
    return audioError(e);
  }
}
