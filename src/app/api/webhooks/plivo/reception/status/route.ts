import { ClinicTelephonyCallEventType } from "@prisma/client";
import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { buildTelephonyUnavailableXml } from "@/lib/telephony/plivo";
import { buildReceptionDialOutcomeXml } from "@/lib/telephony/reception";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
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
    const sourceNumbers = new URL(request.url).searchParams.getAll(
      "sourceNumber",
    );
    if (sourceNumbers.length !== 1) {
      return xmlResponse(buildTelephonyUnavailableXml());
    }
    const clinic = await resolveInboundClinicByPlivoNumber(sourceNumbers[0]);
    if (!clinic) return xmlResponse(buildTelephonyUnavailableXml());
    try {
      await requireTenantFeatureEntitlement(clinic.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return xmlResponse(buildTelephonyUnavailableXml());
    }

    const statusValue = verification.params.DialStatus;
    const status = typeof statusValue === "string" ? statusValue : undefined;
    const xml = buildReceptionDialOutcomeXml({
      requestUrl: request.url,
      clinic,
      status,
      runtimeMenu:
        status === "completed"
          ? undefined
          : await getClinicIvrRuntimeMenuForTrustedClinic(clinic),
    });
    await observeProductionCallEvents({
      clinicId: clinic.clinicId,
      providerCallUuid: verification.params.DialALegUUID,
      events:
        status === "completed"
          ? [ClinicTelephonyCallEventType.RECEPTION_CONNECTED]
          : [
              ClinicTelephonyCallEventType.RECEPTION_FAILED,
              ClinicTelephonyCallEventType.RECEPTION_FALLBACK_TO_IVR,
            ],
    });
    return xmlResponse(xml);
  } catch {
    console.error("Could not process the Plivo reception Dial callback.");
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
