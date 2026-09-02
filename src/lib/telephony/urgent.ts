import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import { isCallTransferDestinationAvailable } from "@/lib/telephony/destinationSafety";
import { normalizePlivoDestinationNumber } from "@/lib/telephony/phoneNumber";
import {
  buildEffectiveClinicMainMenuXml,
  buildPlivoActionUrl,
  buildPlivoInputActionUrl,
  buildUrgentAssistanceMenuXml,
  buildUrgentTransferCompletedXml,
  buildUrgentTransferFailureXml,
  buildUrgentTransferNotConfiguredXml,
  buildUrgentTransferTemporarilyUnavailableXml,
  buildUrgentTransferXml,
  PLIVO_URGENT_CONFIRM_WEBHOOK_PATH,
  PLIVO_URGENT_STATUS_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";
import type { ClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

export const DOCUMENTED_DIAL_STATUSES = Object.freeze([
  "completed",
  "busy",
  "failed",
  "cancel",
  "timeout",
  "no-answer",
] as const);

type DocumentedDialStatus = (typeof DOCUMENTED_DIAL_STATUSES)[number];

function canonicalNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizePlivoDestinationNumber(value);
  } catch {
    return null;
  }
}

export function buildUrgentMenuForClinic(
  requestUrl: string,
  invalidSelection = false,
  runtimeMenu?: ClinicIvrRuntimeMenu,
): string {
  return buildUrgentAssistanceMenuXml({
    actionUrl: buildPlivoActionUrl(
      requestUrl,
      PLIVO_URGENT_CONFIRM_WEBHOOK_PATH,
    ),
    invalidSelection,
    runtimeMenu,
  });
}

export function isUrgentTransferDestinationAvailable(input: {
  providerNumber: unknown;
  publicPhoneNumber: unknown;
  urgentPhoneNumber: unknown;
}): boolean {
  return isCallTransferDestinationAvailable({
    providerNumber: input.providerNumber,
    publicPhoneNumber: input.publicPhoneNumber,
    destinationPhoneNumber: input.urgentPhoneNumber,
  });
}

export function handleUrgentConfirmation(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  providerNumber: unknown;
  digits: string | undefined;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): string {
  if (input.digits === "9") {
    return buildEffectiveClinicMainMenuXml({
      inputActionUrl: buildPlivoInputActionUrl(input.requestUrl),
      clinicName: input.clinic.clinicName,
      runtimeMenu: input.runtimeMenu,
    });
  }
  if (input.digits !== "1") {
    return buildUrgentMenuForClinic(input.requestUrl, true, input.runtimeMenu);
  }

  if (input.clinic.urgentPhoneNumber === null) {
    return buildUrgentTransferNotConfiguredXml(input.runtimeMenu);
  }

  const providerNumber = canonicalNumber(input.providerNumber);
  const urgentNumber = canonicalNumber(input.clinic.urgentPhoneNumber);
  if (
    providerNumber === null ||
    urgentNumber === null ||
    !isUrgentTransferDestinationAvailable({
      providerNumber: input.providerNumber,
      publicPhoneNumber: input.clinic.publicPhoneNumber,
      urgentPhoneNumber: input.clinic.urgentPhoneNumber,
    })
  ) {
    return buildUrgentTransferTemporarilyUnavailableXml(input.runtimeMenu);
  }

  const actionUrl = buildPlivoActionUrl(
    input.requestUrl,
    PLIVO_URGENT_STATUS_WEBHOOK_PATH,
    { sourceNumber: providerNumber },
  );
  return buildUrgentTransferXml({
    actionUrl,
    callerId: providerNumber,
    destination: urgentNumber,
    runtimeMenu: input.runtimeMenu,
  });
}

export function buildUrgentDialOutcomeXml(
  status: unknown,
  runtimeMenu?: ClinicIvrRuntimeMenu,
): string {
  if (status === "completed") return buildUrgentTransferCompletedXml();

  // Every documented non-completed value and any future/unknown value uses
  // the same privacy-preserving failure response.
  return buildUrgentTransferFailureXml(runtimeMenu);
}

export function isDocumentedDialStatus(
  status: unknown,
): status is DocumentedDialStatus {
  return (
    typeof status === "string" &&
    (DOCUMENTED_DIAL_STATUSES as readonly string[]).includes(status)
  );
}
