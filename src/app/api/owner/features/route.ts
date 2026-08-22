import { z } from "zod";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  getPlatformFeatureAdmin,
  setFeatureGlobalEnabled,
} from "@/lib/platform/entitlements";
import { MAX_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * The platform-wide feature switch — Stage 9, layer 1.
 *
 * `requirePlatformOwner()` is the whole gate and runs before anything else in
 * both handlers: it re-reads the session registry and the account's platform
 * role from the database on every call. A signed-in clinic user gets 404 from
 * toErrorResponse — the same answer as an unknown URL — so this route does not
 * confirm its own existence to them.
 *
 * The typed confirmation travels in the body and is checked server-side in
 * evaluateGlobalSwitch. It is a deliberate speed bump, not a credential: it
 * stops a misclick, and it is not relied on to stop anything else.
 */

const patchSchema = z.object({
  featureKey: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
  /** The feature key, typed out. Required by the policy when switching off. */
  confirmation: z.string().trim().max(64).optional(),
});

export async function GET() {
  try {
    const owner = await requirePlatformOwner();
    return jsonOk(await getPlatformFeatureAdmin(owner));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/features");
  }
}

export async function PATCH(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const input = patchSchema.parse(await readJsonBody(request));

    return jsonOk(
      await setFeatureGlobalEnabled(owner, {
        featureKey: input.featureKey,
        enabled: input.enabled,
        reason: input.reason ?? null,
        confirmation: input.confirmation ?? null,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/owner/features");
  }
}
