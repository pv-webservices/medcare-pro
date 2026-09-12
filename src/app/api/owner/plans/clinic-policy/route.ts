import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { planClinicPolicySchema, setPlanClinicPolicy } from "@/lib/platform/clinicCapacity";

export async function PATCH(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const input = planClinicPolicySchema.parse(await readJsonBody(request));
    return jsonOk(await setPlanClinicPolicy(owner, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/owner/plans/clinic-policy");
  }
}

