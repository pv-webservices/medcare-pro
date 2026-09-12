import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { approveClinicCapacityRequest, ownerApprovalSchema } from "@/lib/platform/clinicCapacity";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = ownerApprovalSchema.parse(await readJsonBody(request));
    return jsonOk(await approveClinicCapacityRequest(owner, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/clinic-requests/[id]/approve");
  }
}

