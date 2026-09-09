import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  listPlatformPlivoNumbers,
  releasePlatformPlivoNumber,
  releasePlatformPlivoNumberEarly,
  releasePlatformPlivoNumberSchema,
  restorePreviousPlatformPlivoNumber,
} from "@/lib/platform/plivoNumbers";

export async function GET() {
  try {
    const owner = await requirePlatformOwner();
    return jsonOk(await listPlatformPlivoNumbers(owner));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/ivr-numbers");
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const input = releasePlatformPlivoNumberSchema.parse(
      await readJsonBody(request),
    );
    if (input.action === "releaseQuarantine") {
      await releasePlatformPlivoNumber(owner, input.numberId);
    } else if (input.action === "releaseQuarantineEarly") {
      await releasePlatformPlivoNumberEarly(owner, input.numberId, input.reason);
    } else {
      await restorePreviousPlatformPlivoNumber(owner, input.numberId);
    }
    return jsonOk(await listPlatformPlivoNumbers(owner));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/ivr-numbers");
  }
}
