import {
  ClinicTelephonyCallEventType,
  ClinicTelephonyCallInitialRoute,
  ClinicTelephonyCallMenuSource,
} from "@prisma/client";
import {
  buildEffectiveClinicMainMenuXml,
  buildPlivoInputActionUrl,
  buildTelephonyUnavailableXml,
} from "@/lib/telephony/plivo";
import { FeatureError } from "@/lib/featureResolution";
import { MODULE_FEATURES, requireTenantFeatureEntitlement } from "@/lib/features";
import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import {
  getClinicBusinessHoursForTrustedClinic,
  resolveClinicBusinessState,
} from "@/lib/telephony/businessHours";
import { resolveEffectiveTelephonyRoute } from "@/lib/telephony/routing";
import {
  buildReceptionRouteXml,
  isReceptionDestinationAvailable,
} from "@/lib/telephony/reception";
import { getClinicIvrRuntimeMenuForTrustedClinic } from "@/lib/telephony/ivrRuntime";
import { observeInboundProductionCall } from "@/lib/telephony/callObservability";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const verification = await verifyPlivoV3Webhook(request);

  if (!verification.ok) {
    console.error(`Plivo Answer webhook rejected: ${verification.reason}`);
    if (verification.reason === "missing-configuration") {
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

    try {
      await requireTenantFeatureEntitlement(clinic.tenantId, MODULE_FEATURES.ivr);
    } catch (error: unknown) {
      if (!(error instanceof FeatureError)) throw error;
      return new Response(buildTelephonyUnavailableXml(), {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const routingMode = clinic.routingMode ?? "AFTER_HOURS";
    const businessState =
      routingMode === "AUTO"
        ? resolveClinicBusinessState({
            now: new Date(),
            timezone: clinic.timezone,
            hours: await getClinicBusinessHoursForTrustedClinic(
              clinic.clinicId,
            ),
          })
        : undefined;
    const effectiveRoute = resolveEffectiveTelephonyRoute({
      routingMode,
      businessState,
    });
    if (effectiveRoute === "RECEPTION") {
      const receptionAvailable = isReceptionDestinationAvailable({
        providerNumber: verification.params.To,
        publicPhoneNumber: clinic.publicPhoneNumber,
        receptionPhoneNumber: clinic.receptionPhoneNumber,
      });
      const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
      const xml = buildReceptionRouteXml({
        requestUrl: request.url,
        clinic,
        providerNumber: verification.params.To,
        runtimeMenu,
      });
      await observeInboundProductionCall({
        clinicId: clinic.clinicId,
        providerCallUuid: verification.params.CallUUID,
        callerNumber: verification.params.From,
        routingModeAtStart: routingMode,
        initialRoute: ClinicTelephonyCallInitialRoute.RECEPTION,
        phoneMenuSource: !receptionAvailable
          ? runtimeMenu.source === "custom"
            ? ClinicTelephonyCallMenuSource.CUSTOM
            : ClinicTelephonyCallMenuSource.DEFAULT
          : null,
        events: receptionAvailable
          ? [ClinicTelephonyCallEventType.ROUTED_TO_RECEPTION]
          : [
              ClinicTelephonyCallEventType.ROUTED_TO_RECEPTION,
              ClinicTelephonyCallEventType.RECEPTION_FALLBACK_TO_IVR,
              ClinicTelephonyCallEventType.ROUTED_TO_IVR,
            ],
      });
      return xmlResponse(xml);
    }

    const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
    const inputActionUrl = buildPlivoInputActionUrl(request.url);
    const xml = buildEffectiveClinicMainMenuXml({
      inputActionUrl,
      clinicName: clinic.clinicName,
      runtimeMenu,
    });
    await observeInboundProductionCall({
      clinicId: clinic.clinicId,
      providerCallUuid: verification.params.CallUUID,
      callerNumber: verification.params.From,
      routingModeAtStart: routingMode,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      phoneMenuSource:
        runtimeMenu.source === "custom"
          ? ClinicTelephonyCallMenuSource.CUSTOM
          : ClinicTelephonyCallMenuSource.DEFAULT,
      events: [ClinicTelephonyCallEventType.ROUTED_TO_IVR],
    });
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    console.error("Could not resolve or generate the Plivo answer XML.");
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
