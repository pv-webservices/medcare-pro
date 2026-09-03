import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import { getPhoneDiagnosticsForActor } from "@/lib/telephony/callDiagnostics";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    return jsonOk(await getPhoneDiagnosticsForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "GET /api/clinics/[id]/telephony/diagnostics",
    );
  }
}
