import {
  buildClinicSelectionXml,
  buildMessageThenMainMenuXml,
  buildPlivoInputActionUrl,
  buildTelephonyUnavailableXml,
} from "@/lib/telephony/plivo";
import { buildDoctorMenuForClinic } from "@/lib/telephony/availability";
import { beginTelephoneBooking } from "@/lib/telephony/booking";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { FeatureError } from "@/lib/featureResolution";
import {
  MODULE_FEATURES,
  requireTenantFeatureEntitlement,
} from "@/lib/features";
import { resolveMainMenuAction } from "@/lib/telephony/routing";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { buildUrgentMenuForClinic } from "@/lib/telephony/urgent";

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
    if (!clinic) {
      return new Response(buildTelephonyUnavailableXml(), {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const validatedDigits = verification.params.Digits;
    const digits =
      typeof validatedDigits === "string" ? validatedDigits : undefined;
    const action = resolveMainMenuAction(digits);
    const inputActionUrl = buildPlivoInputActionUrl(request.url);
    if (action === "tomorrow-slots" || action === "appointment-booking") {
      try {
        await requireTenantFeatureEntitlement(
          clinic.tenantId,
          MODULE_FEATURES.appointments,
        );
      } catch (error: unknown) {
        if (!(error instanceof FeatureError)) throw error;
        return xmlResponse(
          buildMessageThenMainMenuXml(
            "Telephone appointment availability is not available for this clinic.",
            inputActionUrl,
            clinic.clinicName,
          ),
        );
      }
      if (action === "tomorrow-slots") {
        return xmlResponse(await buildDoctorMenuForClinic(request.url, clinic));
      }
      return xmlResponse(
        await beginTelephoneBooking({
          requestUrl: request.url,
          clinic,
          from: verification.params.From,
          callUuid: verification.params.CallUUID,
          digits,
        }),
      );
    }
    if (action === "urgent-assistance") {
      return xmlResponse(buildUrgentMenuForClinic(request.url));
    }
    return new Response(
      buildClinicSelectionXml(action, inputActionUrl, clinic.clinicName),
      {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    console.error("Could not resolve or generate the Plivo input XML.");
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
