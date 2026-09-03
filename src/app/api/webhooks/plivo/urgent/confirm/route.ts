import { ClinicTelephonyCallEventType } from "@prisma/client";
import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { buildTelephonyUnavailableXml } from "@/lib/telephony/plivo";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import {
  handleUrgentConfirmation,
  isUrgentTransferDestinationAvailable,
} from "@/lib/telephony/urgent";
import { getClinicIvrRuntimeMenuForTrustedClinic } from "@/lib/telephony/ivrRuntime";
import { observeProductionCallEvents } from "@/lib/telephony/callObservability";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const verification = await verifyPlivoV3Webhook(request);
  if (!verification.ok) {
    if (verification.reason === "missing-configuration") {
      console.error("Plivo webhook validation is not configured.");
      return new Response("Service unavailable.", { status: 503 });
    }
    return new Response("Forbidden.", { status: 403 });
  }

  try {
    const clinic = await resolveInboundClinicByPlivoNumber(
      verification.params.To,
    );
    if (!clinic) return xmlResponse(buildTelephonyUnavailableXml());
    try {
      await requireTenantFeatureEntitlement(clinic.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return xmlResponse(buildTelephonyUnavailableXml());
    }

    const value = verification.params.Digits;
    const digits = typeof value === "string" ? value : undefined;
    const xml = handleUrgentConfirmation({
      requestUrl: request.url,
      clinic,
      providerNumber: verification.params.To,
      digits,
      runtimeMenu: await getClinicIvrRuntimeMenuForTrustedClinic(clinic),
    });
    if (
      digits === "1" &&
      !isUrgentTransferDestinationAvailable({
        providerNumber: verification.params.To,
        publicPhoneNumber: clinic.publicPhoneNumber,
        urgentPhoneNumber: clinic.urgentPhoneNumber,
      })
    ) {
      await observeProductionCallEvents({
        clinicId: clinic.clinicId,
        providerCallUuid: verification.params.CallUUID,
        events: [ClinicTelephonyCallEventType.URGENT_TRANSFER_UNAVAILABLE],
      });
    }
    return xmlResponse(xml);
  } catch {
    console.error("Could not process the Plivo urgent confirmation callback.");
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
