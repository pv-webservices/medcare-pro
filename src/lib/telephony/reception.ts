import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import { isCallTransferDestinationAvailable } from "@/lib/telephony/destinationSafety";
import { normalizePlivoDestinationNumber } from "@/lib/telephony/phoneNumber";
import {
  buildEffectiveClinicMainMenuXml,
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
  buildReceptionTransferCompletedXml,
  buildReceptionTransferXml,
  PLIVO_RECEPTION_STATUS_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";
import type { ClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

function canonicalNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizePlivoDestinationNumber(value);
  } catch {
    return null;
  }
}

export function isReceptionDestinationAvailable(input: {
  providerNumber: unknown;
  publicPhoneNumber: unknown;
  receptionPhoneNumber: unknown;
}): boolean {
  return isCallTransferDestinationAvailable({
    providerNumber: input.providerNumber,
    publicPhoneNumber: input.publicPhoneNumber,
    destinationPhoneNumber: input.receptionPhoneNumber,
  });
}

function mainMenu(
  requestUrl: string,
  clinicName: string,
  runtimeMenu?: ClinicIvrRuntimeMenu,
  message?: string,
): string {
  return buildEffectiveClinicMainMenuXml({
    inputActionUrl: buildPlivoInputActionUrl(requestUrl),
    clinicName,
    runtimeMenu,
    message,
  });
}

export function buildReceptionRouteXml(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  providerNumber: unknown;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): string {
  const providerNumber = canonicalNumber(input.providerNumber);
  const receptionNumber = canonicalNumber(input.clinic.receptionPhoneNumber);
  if (
    !isReceptionDestinationAvailable({
      providerNumber: input.providerNumber,
      publicPhoneNumber: input.clinic.publicPhoneNumber,
      receptionPhoneNumber: input.clinic.receptionPhoneNumber,
    }) ||
    providerNumber === null ||
    receptionNumber === null
  ) {
    return mainMenu(
      input.requestUrl,
      input.clinic.clinicName,
      input.runtimeMenu,
    );
  }

  return buildReceptionTransferXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_RECEPTION_STATUS_WEBHOOK_PATH,
      { sourceNumber: providerNumber },
    ),
    callerId: providerNumber,
    destination: receptionNumber,
  });
}

export function buildReceptionDialOutcomeXml(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  status: unknown;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): string {
  if (input.status === "completed") {
    return buildReceptionTransferCompletedXml();
  }
  return mainMenu(
    input.requestUrl,
    input.clinic.clinicName,
    input.runtimeMenu,
    "We could not connect you to reception. You can continue using our automated telephone service.",
  );
}
