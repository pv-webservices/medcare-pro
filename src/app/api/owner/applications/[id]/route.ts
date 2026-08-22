import { jsonError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { getClinicApplication } from "@/lib/platform/applications";

/**
 * One clinic application in full — Stage 3.
 *
 * An unknown id and the reserved platform tenant's id both answer 404, so the
 * platform row cannot be probed for by id.
 */

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;

    const application = await getClinicApplication(owner, id);
    if (!application) {
      return jsonError("Not found.", 404);
    }

    return jsonOk(application);
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/applications/[id]");
  }
}
