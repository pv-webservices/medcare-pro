import { BadRequestError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { resolvePlatformPlivoEnvironment } from "@/lib/platform/plivoNumberEnvironment";
import { createPlatformPlivoNumberProvider } from "@/lib/platform/plivoNumberProvider";
import { syncPlatformPlivoNumbers } from "@/lib/platform/plivoNumbers";

export async function POST() {
  try {
    const owner = await requirePlatformOwner();
    const environment = resolvePlatformPlivoEnvironment();
    if (!environment) {
      throw new BadRequestError("Plivo inventory sync is not configured.");
    }
    const provider = createPlatformPlivoNumberProvider(environment);
    return jsonOk(
      await syncPlatformPlivoNumbers(
        owner,
        provider,
        environment.expectedApplicationId,
      ),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/ivr-numbers/sync");
  }
}
