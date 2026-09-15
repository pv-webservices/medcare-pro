import { z } from "zod";
import { requireActor } from "@/lib/session";
import { audioError, audioJson, readAudioJson } from "@/lib/clinical-audio/api";
import { getFallbackSettings, setFallbackSettings } from "@/lib/transcription/fallback";
export async function GET() { try { return audioJson(await getFallbackSettings(await requireActor())); } catch (error) { return audioError(error); } }
export async function POST(request: Request) { try { const actor = await requireActor(); const input = z.strictObject({ allowed: z.boolean() }).parse(await readAudioJson(request)); return audioJson(await setFallbackSettings(actor, input.allowed)); } catch (error) { return audioError(error); } }
