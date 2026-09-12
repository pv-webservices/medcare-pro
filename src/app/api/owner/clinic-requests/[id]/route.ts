import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { getClinicCapacityRequest } from "@/lib/platform/clinicCapacity";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    return jsonOk(await getClinicCapacityRequest(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/clinic-requests/[id]");
  }
}

