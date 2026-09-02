import {
  doesIvrRevisionMatchRuntimeMenu,
  getClinicIvrRuntimeMenuForTrustedClinic,
  IVR_MENU_CHANGED_MESSAGE,
  resolveRuntimeMainMenuAction,
} from "@/lib/telephony/ivrRuntime";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { bindAndTransitionTelephonyTestCallCallback } from "@/lib/telephony/testCall";
import {
  buildTelephonyTestMenuXml,
  telephonyTestActionMessage,
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
      transition: { kind: "none" },
    });
    if (context.terminal) {
      return testCallXmlResponse("<Response></Response>");
    }
    const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic({
      clinicId: context.clinicId,
      clinicName: context.clinicName,
    });
    if (!doesIvrRevisionMatchRuntimeMenu(request.url, runtimeMenu)) {
      return testCallXmlResponse(
        buildTelephonyTestMenuXml({
          requestUrl: request.url,
          testCallId: context.testCallId,
          clinicName: context.clinicName,
          runtimeMenu,
          message: IVR_MENU_CHANGED_MESSAGE,
        }),
      );
    }

    const action = resolveRuntimeMainMenuAction(
      runtimeMenu,
      oneValidatedPlivoValue(verification.params, "Digits"),
    );
    if (action === "repeat-menu") {
      return testCallXmlResponse(
        buildTelephonyTestMenuXml({
          requestUrl: request.url,
          testCallId: context.testCallId,
          clinicName: context.clinicName,
          runtimeMenu,
        }),
      );
    }
    if (action === "invalid-input") {
      return testCallXmlResponse(
        buildTelephonyTestMenuXml({
          requestUrl: request.url,
          testCallId: context.testCallId,
          clinicName: context.clinicName,
          runtimeMenu,
          invalidSelection: true,
        }),
      );
    }
    return testCallXmlResponse(
      buildTelephonyTestMenuXml({
        requestUrl: request.url,
        testCallId: context.testCallId,
        clinicName: context.clinicName,
        runtimeMenu,
        message: telephonyTestActionMessage(action),
      }),
    );
  } catch (error: unknown) {
    const rejected = telephonyTestCallbackErrorResponse(error);
    if (rejected) return rejected;
    console.error("Could not process the Plivo test-call input XML.");
    return new Response("Service unavailable.", { status: 503 });
  }
}
