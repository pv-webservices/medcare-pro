import { requireActor } from "@/lib/session";
import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requestTranscription } from "@/lib/transcription/service";
type Context = { params: Promise<{ recordingId: string }> };
export async function POST(_request: Request, context: Context) {
  try { const actor = await requireActor(); const { recordingId } = await context.params; return jsonOk(await requestTranscription(actor, recordingId)); }
  catch (error) { return toErrorResponse(error, "POST transcription request"); }
}
