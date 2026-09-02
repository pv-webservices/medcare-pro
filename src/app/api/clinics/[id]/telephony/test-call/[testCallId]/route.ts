import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import { getTelephonyTestCallForActor } from "@/lib/telephony/testCall";

interface RouteContext {
  params: Promise<{ id: string; testCallId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id, testCallId } = await context.params;
    return jsonOk(await getTelephonyTestCallForActor(actor, id, testCallId));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "GET /api/clinics/[id]/telephony/test-call/[testCallId]",
    );
  }
}
