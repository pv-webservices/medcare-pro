import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  isCanonicalIndianPhoneNumber,
  normalizePlivoDestinationNumber,
} from "@/lib/telephony/phoneNumber";
import {
  buildClinicMainMenuXml,
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
  buildReceptionFailureThenMainMenuXml,
  buildReceptionTransferCompletedXml,
  buildReceptionTransferXml,
  PLIVO_RECEPTION_STATUS_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";

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
  const providerNumber = canonicalNumber(input.providerNumber);
  const receptionNumber = canonicalNumber(input.receptionPhoneNumber);
  if (
    providerNumber === null ||
    receptionNumber === null ||
    !isCanonicalIndianPhoneNumber(providerNumber) ||
    !isCanonicalIndianPhoneNumber(receptionNumber)
  ) {
    return false;
  }

  const publicNumber = canonicalNumber(input.publicPhoneNumber);
  return (
    receptionNumber !== providerNumber &&
    (publicNumber === null || receptionNumber !== publicNumber)
  );
}

function mainMenu(requestUrl: string, clinicName: string): string {
  return buildClinicMainMenuXml(
    buildPlivoInputActionUrl(requestUrl),
    clinicName,
  );
}

export function buildReceptionRouteXml(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  providerNumber: unknown;
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
    return mainMenu(input.requestUrl, input.clinic.clinicName);
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
}): string {
  if (input.status === "completed") {
    return buildReceptionTransferCompletedXml();
  }
  return buildReceptionFailureThenMainMenuXml(
    buildPlivoInputActionUrl(input.requestUrl),
    input.clinic.clinicName,
  );
}
