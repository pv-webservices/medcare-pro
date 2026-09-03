import {
  jsonError,
  jsonOk,
  readOptionalJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getTelephonyTestCallPanelForActor,
  startTelephonyTestCallForActor,
  TelephonyTestCallProviderError,
} from "@/lib/telephony/testCall";
import { startTelephonyTestCallSchema } from "@/lib/telephony/testCallContract";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    return jsonOk(await getTelephonyTestCallPanelForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics/[id]/telephony/test-call");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    startTelephonyTestCallSchema.parse(await readOptionalJsonBody(request));
    return jsonOk(
      await startTelephonyTestCallForActor(actor, id, request.url),
      201,
    );
  } catch (error: unknown) {
    if (error instanceof TelephonyTestCallProviderError) {
      return jsonError(error.message, 502);
    }
    return toErrorResponse(error, "POST /api/clinics/[id]/telephony/test-call");
  }
}
