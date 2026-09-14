import { requireActor } from "@/lib/session";
import { ScopeError } from "@/lib/rbac";
import {
  transitionRecording,
  withdrawRecordingConsent,
} from "@/lib/clinical-audio/recordingService";
import { audioJson, audioError, readAudioJson } from "@/lib/clinical-audio/api";
type Context = { params: Promise<{ recordingId: string; action: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { recordingId, action } = await context.params;
    const body = await readAudioJson(request);
    if (action === "withdraw-consent")
      return audioJson(
        await withdrawRecordingConsent(actor, recordingId, body),
      );
    if (
      action === "start" ||
      action === "pause" ||
      action === "resume" ||
      action === "stop"
    )
      return audioJson(
        await transitionRecording(actor, recordingId, action, body),
      );
    throw new ScopeError();
  } catch (e) {
    return audioError(e);
  }
}
