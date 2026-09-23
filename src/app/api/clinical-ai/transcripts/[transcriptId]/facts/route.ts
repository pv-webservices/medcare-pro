import { requireActor } from "@/lib/session";
import { factsError, factsJson } from "@/lib/clinical-facts/api";
import { listTranscriptFacts, requestFactExtraction } from "@/lib/clinical-facts/service";

type Context = { params: Promise<{ transcriptId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    return factsJson(await listTranscriptFacts(actor, (await context.params).transcriptId));
  } catch (error) {
    return factsError(error);
  }
}

export async function POST(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const result = await requestFactExtraction(actor, (await context.params).transcriptId);
    return factsJson(result, result.created ? 202 : 200);
  } catch (error) {
    return factsError(error);
  }
}
