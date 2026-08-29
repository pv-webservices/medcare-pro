import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { listAssignableUsers } from "@/lib/tasks";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const clinicId = new URL(request.url).searchParams.get("clinicId");
    return jsonOk(await listAssignableUsers(actor, clinicId));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/tasks/assignable-users");
  }
}

