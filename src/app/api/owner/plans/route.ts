import { z } from "zod";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { getPlanAdmin, setPlanFeature } from "@/lib/platform/entitlements";
import { MAX_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * What each plan includes — Stage 9, layer 2a.
 *
 * ONE FEATURE PER REQUEST rather than a whole plan's ticked boxes. A plan edit
 * moves every organisation on the plan that has no override, so each one is its
 * own decision with its own reason and its own audit row; submitting a screenful
 * at once would collapse several of those into a single entry that no longer
 * says which change the reason was written about.
 */

const patchSchema = z.object({
  planKey: z.string().trim().min(1).max(64),
  featureKey: z.string().trim().min(1).max(64),
  included: z.boolean(),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

export async function GET() {
  try {
    const owner = await requirePlatformOwner();
    return jsonOk(await getPlanAdmin(owner));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/plans");
  }
}

export async function PATCH(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const input = patchSchema.parse(await readJsonBody(request));

    return jsonOk(
      await setPlanFeature(owner, {
        planKey: input.planKey,
        featureKey: input.featureKey,
        included: input.included,
        reason: input.reason ?? null,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/owner/plans");
  }
}
