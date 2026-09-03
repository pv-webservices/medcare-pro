import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { getClinicIvrRuntimeMenuForTrustedClinic } from "@/lib/telephony/ivrRuntime";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { bindAndTransitionTelephonyTestCallCallback } from "@/lib/telephony/testCall";
import {
  buildTelephonyTestMenuXml,
  TELEPHONY_TEST_CALL_PREFIX,
} from "@/lib/telephony/testCallIvr";
import {
  oneValidatedPlivoValue,
  telephonyTestCallbackErrorResponse,
  testCallXmlResponse,
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
      transition: { kind: "answered" },
    });
    try {
      await requireTenantFeatureEntitlement(context.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return testCallXmlResponse("<Response></Response>");
    }
    if (context.terminal) {
      return testCallXmlResponse("<Response></Response>");
    }
    const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic({
      clinicId: context.clinicId,
      clinicName: context.clinicName,
    });
    return testCallXmlResponse(
      buildTelephonyTestMenuXml({
        requestUrl: request.url,
        testCallId: context.testCallId,
        clinicName: context.clinicName,
        runtimeMenu,
        message: TELEPHONY_TEST_CALL_PREFIX,
      }),
    );
  } catch (error: unknown) {
    const rejected = telephonyTestCallbackErrorResponse(error);
    if (rejected) return rejected;
    console.error("Could not generate the Plivo test-call answer XML.");
    return new Response("Service unavailable.", { status: 503 });
  }
}
