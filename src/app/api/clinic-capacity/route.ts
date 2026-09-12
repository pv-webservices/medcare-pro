import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { getClinicCapacityForActor } from "@/lib/clinicCapacityRequests";
import { requireActor } from "@/lib/session";

export async function GET() {
  try {
    return jsonOk(await getClinicCapacityForActor(await requireActor()));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinic-capacity");
  }
}

