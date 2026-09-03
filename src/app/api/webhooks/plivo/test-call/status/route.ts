import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import {
  bindAndTransitionTelephonyTestCallCallback,
  resolveTelephonyTestCallStatusTransition,
} from "@/lib/telephony/testCall";
import {
  oneValidatedPlivoValue,
  telephonyTestCallbackErrorResponse,
  verifiedTestCallId,
} from "@/lib/telephony/testCallWebhook";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const verification = await verifyPlivoV3Webhook(request);
  if (!verification.ok) {
    return new Response(
      verification.reason === "missing-configuration"
        ? "Service unavailable."
        : "Forbidden.",
      { status: verification.reason === "missing-configuration" ? 503 : 403 },
    );
  }

  try {
    const context = await bindAndTransitionTelephonyTestCallCallback({
      testCallId: verifiedTestCallId(request.url),
      callUuid: oneValidatedPlivoValue(verification.params, "CallUUID"),
      requestUuid: oneValidatedPlivoValue(verification.params, "RequestUUID"),
      transition: resolveTelephonyTestCallStatusTransition(verification.params),
    });
    try {
      await requireTenantFeatureEntitlement(context.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return new Response("", {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response("", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const rejected = telephonyTestCallbackErrorResponse(error);
    if (rejected) return rejected;
    console.error("Could not process the Plivo test-call status callback.");
    return new Response("Service unavailable.", { status: 503 });
  }
}
