import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { ownerRejectionSchema, rejectClinicCapacityRequest } from "@/lib/platform/clinicCapacity";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = ownerRejectionSchema.parse(await readJsonBody(request));
    return jsonOk(await rejectClinicCapacityRequest(owner, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/clinic-requests/[id]/reject");
  }
}

