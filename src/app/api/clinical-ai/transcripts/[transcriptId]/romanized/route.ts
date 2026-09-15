import { z } from "zod";
import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { getRomanizedView, requestRomanization } from "@/lib/transcription/romanization";
export async function GET(_request: Request, context: { params: Promise<{ transcriptId: string }> }) { try { return audioJson(await getRomanizedView(await requireActor(), (await context.params).transcriptId)); } catch (error) { return audioError(error); } }
export async function POST(request: Request, context: { params: Promise<{ transcriptId: string }> }) { try { const actor = await requireActor(); z.strictObject({}).parse(await readAudioJson(request)); return audioJson(await requestRomanization(actor, (await context.params).transcriptId), 202); } catch (error) { return audioError(error); } }
