import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { resolvePlivoNumberQuarantineDays } from "@/lib/platform/plivoNumberEnvironment";
import {
  assignPlatformPlivoNumber,
  getPlatformTenantIvr,
  platformPlivoAssignmentSchema,
  reassignPlatformPlivoNumber,
  restorePreviousPlatformPlivoNumber,
  unassignPlatformPlivoNumber,
} from "@/lib/platform/plivoNumbers";

interface Context { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    return jsonOk(await getPlatformTenantIvr(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/applications/[id]/ivr");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = platformPlivoAssignmentSchema.parse(await readJsonBody(request));
    if (input.action === "assign") {
      await assignPlatformPlivoNumber(owner, id, input);
    } else if (input.action === "unassign") {
      await unassignPlatformPlivoNumber(
        owner,
        id,
        input,
        resolvePlivoNumberQuarantineDays(),
      );
    } else if (input.action === "reassign") {
      await reassignPlatformPlivoNumber(
        owner,
        id,
        input,
        resolvePlivoNumberQuarantineDays(),
      );
    } else {
      await restorePreviousPlatformPlivoNumber(owner, input.numberId, id);
    }
    return jsonOk(await getPlatformTenantIvr(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/applications/[id]/ivr");
  }
}
