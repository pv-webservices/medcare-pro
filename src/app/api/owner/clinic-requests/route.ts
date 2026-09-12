import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  listClinicCapacityRequests,
  ownerClinicRequestFilterSchema,
} from "@/lib/platform/clinicCapacity";

export async function GET(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const url = new URL(request.url);
    const filters = ownerClinicRequestFilterSchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    return jsonOk(await listClinicCapacityRequests(owner, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/clinic-requests");
  }
}

