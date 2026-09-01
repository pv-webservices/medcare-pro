import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { handleSlotMenuInput } from "@/lib/telephony/availability";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import {
  buildEffectiveClinicMainMenuXml,
  buildPlivoInputActionUrl,
  buildTelephonyUnavailableXml,
} from "@/lib/telephony/plivo";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
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
    const clinic = await resolveInboundClinicByPlivoNumber(
      verification.params.To,
    );
    if (!clinic) return xmlResponse(buildTelephonyUnavailableXml());
    const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
    try {
      await requireTenantFeatureEntitlement(
        clinic.tenantId,
        MODULE_FEATURES.appointments,
      );
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return xmlResponse(
        buildEffectiveClinicMainMenuXml({
          message:
            "Telephone appointment availability is not available for this clinic.",
          inputActionUrl: buildPlivoInputActionUrl(request.url),
          clinicName: clinic.clinicName,
          runtimeMenu,
        }),
      );
    }
    const value = verification.params.Digits;
    const digits = typeof value === "string" ? value : undefined;
    return xmlResponse(
      await handleSlotMenuInput({
        requestUrl: request.url,
        clinic,
        digits,
        runtimeMenu,
      }),
    );
  } catch {
    console.error("Could not process the Plivo slot-page callback.");
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
