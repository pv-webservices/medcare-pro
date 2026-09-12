import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { ownerPaymentSchema, setClinicCapacityPayment } from "@/lib/platform/clinicCapacity";

interface RouteContext { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = ownerPaymentSchema.parse(await readJsonBody(request));
    return jsonOk(await setClinicCapacityPayment(owner, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/owner/clinic-requests/[id]/payment");
  }
}

