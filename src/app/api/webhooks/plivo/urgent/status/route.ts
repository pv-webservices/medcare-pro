import { ClinicTelephonyCallEventType } from "@prisma/client";
import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { buildUrgentTransferFailureXml } from "@/lib/telephony/plivo";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { buildUrgentDialOutcomeXml } from "@/lib/telephony/urgent";
import { observeProductionCallEvents } from "@/lib/telephony/callObservability";
import { getClinicIvrRuntimeMenuForTrustedClinic } from "@/lib/telephony/ivrRuntime";

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
      return xmlResponse(buildUrgentTransferFailureXml());
    }
    const clinic = await resolveInboundClinicByPlivoNumber(sourceNumbers[0]);
    if (!clinic) return xmlResponse(buildUrgentTransferFailureXml());
    try {
      await requireTenantFeatureEntitlement(clinic.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return xmlResponse(buildUrgentTransferFailureXml());
    }

    const status = verification.params.DialStatus;
    const normalizedStatus = typeof status === "string" ? status : undefined;
    const runtimeMenu =
      normalizedStatus === "completed"
        ? undefined
        : await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
    const xml = buildUrgentDialOutcomeXml(normalizedStatus, runtimeMenu);
    await observeProductionCallEvents({
      clinicId: clinic.clinicId,
      providerCallUuid: verification.params.DialALegUUID,
      events: [
        normalizedStatus === "completed"
          ? ClinicTelephonyCallEventType.URGENT_TRANSFER_CONNECTED
          : ClinicTelephonyCallEventType.URGENT_TRANSFER_FAILED,
      ],
    });
    return xmlResponse(xml);
  } catch {
    console.error("Could not process the Plivo urgent Dial callback.");
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
