import { buildClinicInformationForClinic } from "@/lib/telephony/clinicInformation";
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

    const digits = verification.params.Digits;
    if (digits === "9") {
      const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
      return xmlResponse(
        buildEffectiveClinicMainMenuXml({
          inputActionUrl: buildPlivoInputActionUrl(request.url),
          clinicName: clinic.clinicName,
          runtimeMenu,
        }),
      );
    }
    return xmlResponse(
      await buildClinicInformationForClinic({
        requestUrl: request.url,
        clinic,
        invalidSelection: true,
      }),
    );
  } catch {
    console.error("Could not process the Plivo clinic information callback.");
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
