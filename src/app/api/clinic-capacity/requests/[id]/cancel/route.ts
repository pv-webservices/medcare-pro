import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { cancelClinicCapacityRequest } from "@/lib/clinicCapacityRequests";
import { requireActor } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await cancelClinicCapacityRequest(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/clinic-capacity/requests/[id]/cancel");
  }
}

