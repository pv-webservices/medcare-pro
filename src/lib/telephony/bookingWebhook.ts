import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import {
  buildMessageThenMainMenuXml,
  buildPlivoInputActionUrl,
  buildTelephonyUnavailableXml,
} from "@/lib/telephony/plivo";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";

export interface ValidatedBookingWebhookInput {
  requestUrl: string;
  clinic: InboundClinicContext;
  from: unknown;
  callUuid: unknown;
  digits?: string;
}

export async function processBookingWebhook(
  request: Request,
  handler: (input: ValidatedBookingWebhookInput) => Promise<string>,
  logLabel: string,
): Promise<Response> {
  const verification = await verifyPlivoV3Webhook(request);
  if (!verification.ok) {
    if (verification.reason === "missing-configuration") {
      console.error("Plivo webhook validation is not configured.");
      return new Response("Service unavailable.", { status: 503 });
    }
    return new Response("Forbidden.", { status: 403 });
  }

  try {
    const clinic = await resolveInboundClinicByPlivoNumber(verification.params.To);
    if (!clinic) return xmlResponse(buildTelephonyUnavailableXml());
    try {
      await requireTenantFeatureEntitlement(
        clinic.tenantId,
        MODULE_FEATURES.appointments,
      );
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return xmlResponse(
        buildMessageThenMainMenuXml(
          "Telephone appointment booking is not available for this clinic.",
          buildPlivoInputActionUrl(request.url),
          clinic.clinicName,
        ),
      );
    }
    const digitsValue = verification.params.Digits;
    return xmlResponse(
      await handler({
        requestUrl: request.url,
        clinic,
        from: verification.params.From,
        callUuid: verification.params.CallUUID,
        digits: typeof digitsValue === "string" ? digitsValue : undefined,
      }),
    );
  } catch {
    console.error(`Could not process the Plivo ${logLabel} callback.`);
    return new Response("Service unavailable.", { status: 503 });
  }
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
