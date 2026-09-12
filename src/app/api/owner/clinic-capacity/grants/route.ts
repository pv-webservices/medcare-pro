import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { createManualClinicCapacityGrant, manualClinicCapacityGrantSchema } from "@/lib/platform/clinicCapacity";

export async function POST(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const input = manualClinicCapacityGrantSchema.parse(await readJsonBody(request));
    return jsonOk(await createManualClinicCapacityGrant(owner, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/clinic-capacity/grants");
  }
}

