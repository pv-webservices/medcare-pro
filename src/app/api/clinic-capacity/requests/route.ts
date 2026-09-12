import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  clinicCapacityRequestSchema,
  submitClinicCapacityRequest,
} from "@/lib/clinicCapacityRequests";
import { requireActor } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = clinicCapacityRequestSchema.parse(await readJsonBody(request));
    return jsonOk(await submitClinicCapacityRequest(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/clinic-capacity/requests");
  }
}

