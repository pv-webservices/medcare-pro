import { z } from "zod";
import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { requestTranscription } from "@/lib/transcription/service";
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try {
    const actor = await requireActor();
    z.strictObject({}).parse(await readAudioJson(request));
    const result = await requestTranscription(actor, (await context.params).recordingId);
    return audioJson(result.run, result.created ? 201 : 200);
  } catch (error) { return audioError(error); }
}
