import {
  ClinicTelephonyCallEventType,
  ClinicTelephonyCallMenuSource,
} from "@prisma/client";
import {
  buildEffectiveClinicMainMenuXml,
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
import {
  getClinicIvrRuntimeMenuForTrustedClinic,
  doesIvrRevisionMatchRuntimeMenu,
  IVR_MENU_CHANGED_MESSAGE,
  resolveRuntimeMainMenuAction,
} from "@/lib/telephony/ivrRuntime";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { buildUrgentMenuForClinic } from "@/lib/telephony/urgent";
import { buildClinicInformationForClinic } from "@/lib/telephony/clinicInformation";
import {
  eventForMainMenuAction,
  observeProductionCallEvents,
} from "@/lib/telephony/callObservability";

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

    const runtimeMenu = await getClinicIvrRuntimeMenuForTrustedClinic(clinic);
    const inputActionUrl = buildPlivoInputActionUrl(request.url);
    if (!doesIvrRevisionMatchRuntimeMenu(request.url, runtimeMenu)) {
      const xml = buildEffectiveClinicMainMenuXml({
        inputActionUrl,
        clinicName: clinic.clinicName,
        runtimeMenu,
        message: IVR_MENU_CHANGED_MESSAGE,
      });
      await observeProductionCallEvents({
        clinicId: clinic.clinicId,
        providerCallUuid: verification.params.CallUUID,
        phoneMenuSource:
          runtimeMenu.source === "custom"
            ? ClinicTelephonyCallMenuSource.CUSTOM
            : ClinicTelephonyCallMenuSource.DEFAULT,
        events: [ClinicTelephonyCallEventType.MENU_REVISION_REFRESHED],
      });
      return xmlResponse(xml);
    }

    const validatedDigits = verification.params.Digits;
    const digits =
      typeof validatedDigits === "string" ? validatedDigits : undefined;
    const action =
      runtimeMenu.source === "default"
        ? resolveMainMenuAction(digits)
        : resolveRuntimeMainMenuAction(runtimeMenu, digits);
    await observeProductionCallEvents({
      clinicId: clinic.clinicId,
      providerCallUuid: verification.params.CallUUID,
      phoneMenuSource:
        runtimeMenu.source === "custom"
          ? ClinicTelephonyCallMenuSource.CUSTOM
          : ClinicTelephonyCallMenuSource.DEFAULT,
      events: [eventForMainMenuAction(action)],
    });
    if (action === "tomorrow-slots" || action === "appointment-booking") {
      try {
        await requireTenantFeatureEntitlement(
          clinic.tenantId,
          MODULE_FEATURES.appointments,
        );
      } catch (error: unknown) {
        if (!(error instanceof FeatureError)) throw error;
        await observeProductionCallEvents({
          clinicId: clinic.clinicId,
          providerCallUuid: verification.params.CallUUID,
          events: [ClinicTelephonyCallEventType.APPOINTMENTS_UNAVAILABLE],
        });
        return xmlResponse(
          buildEffectiveClinicMainMenuXml({
            message:
              "Telephone appointment availability is not available for this clinic.",
            inputActionUrl,
            clinicName: clinic.clinicName,
            runtimeMenu,
          }),
        );
      }
      if (action === "tomorrow-slots") {
        return xmlResponse(
          await buildDoctorMenuForClinic(request.url, clinic, 0, false, runtimeMenu),
        );
      }
      return xmlResponse(
        await beginTelephoneBooking({
          requestUrl: request.url,
          clinic,
          from: verification.params.From,
          callUuid: verification.params.CallUUID,
          digits,
          runtimeMenu,
        }),
      );
    }
    if (action === "urgent-assistance") {
      return xmlResponse(buildUrgentMenuForClinic(request.url));
    }
    if (action === "clinic-information") {
      return xmlResponse(
        await buildClinicInformationForClinic({
          requestUrl: request.url,
          clinic,
        }),
      );
    }
    return xmlResponse(
      buildEffectiveClinicMainMenuXml({
        inputActionUrl,
        clinicName: clinic.clinicName,
        runtimeMenu,
        invalidSelection: action === "invalid-input",
      }),
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
