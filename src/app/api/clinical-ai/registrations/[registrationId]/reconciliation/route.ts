import { requireActor } from "@/lib/session";
import { BadRequestError } from "@/lib/domainErrors";
import { reconciliationError, reconciliationJson } from "@/lib/clinical-reconciliation/api";
import { reconcileDraft } from "@/lib/clinical-reconciliation/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ registrationId: string }> };
/** 50 items at their field limits fit well inside this. */
const MAX_BODY_BYTES = 128 * 1024;

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new BadRequestError("Request too large.");
    return reconciliationJson(
      await reconcileDraft(actor, (await context.params).registrationId, JSON.parse(body)),
    );
  } catch (error) {
    return reconciliationError(error);
  }
}
