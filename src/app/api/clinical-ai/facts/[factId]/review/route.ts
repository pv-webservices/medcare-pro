import { requireActor } from "@/lib/session";
import { readAudioJson } from "@/lib/clinical-audio/api";
import { factsError, factsJson } from "@/lib/clinical-facts/api";
import { reviewFact } from "@/lib/clinical-facts/service";
import { factReviewSchema } from "@/lib/clinical-facts/schema";

export async function POST(request: Request, context: { params: Promise<{ factId: string }> }) {
  try {
    const actor = await requireActor();
    const input = factReviewSchema.parse(await readAudioJson(request));
    return factsJson(await reviewFact(actor, (await context.params).factId, input));
  } catch (error) {
    return factsError(error);
  }
}
