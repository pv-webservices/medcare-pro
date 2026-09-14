import { requireActor } from "@/lib/session";
import {
  createRecording,
  consentSchema,
  listRecordings,
} from "@/lib/clinical-audio/recordingService";
import { audioJson, audioError, readAudioJson } from "@/lib/clinical-audio/api";
import { z } from "zod";
const requestSchema = consentSchema.extend({
  registrationId: z.string().min(1).max(191),
});
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const { registrationId, ...consent } = requestSchema.parse(
      await readAudioJson(request),
    );
    return audioJson(await createRecording(actor, registrationId, consent));
  } catch (e) {
    return audioError(e);
  }
}
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const id = z
      .string()
      .min(1)
      .max(191)
      .parse(new URL(request.url).searchParams.get("registrationId"));
    return audioJson(await listRecordings(actor, id));
  } catch (e) {
    return audioError(e);
  }
}
