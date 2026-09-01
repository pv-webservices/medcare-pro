import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  isCanonicalIndianPhoneNumber,
  normalizePlivoDestinationNumber,
} from "@/lib/telephony/phoneNumber";
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
): string {
  return buildUrgentAssistanceMenuXml({
    actionUrl: buildPlivoActionUrl(
      requestUrl,
      PLIVO_URGENT_CONFIRM_WEBHOOK_PATH,
    ),
    invalidSelection,
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
    return buildUrgentMenuForClinic(input.requestUrl, true);
  }

  if (input.clinic.urgentPhoneNumber === null) {
    return buildUrgentTransferNotConfiguredXml();
  }

  const providerNumber = canonicalNumber(input.providerNumber);
  const urgentNumber = canonicalNumber(input.clinic.urgentPhoneNumber);
  if (
    providerNumber === null ||
    urgentNumber === null ||
    !isCanonicalIndianPhoneNumber(providerNumber) ||
    !isCanonicalIndianPhoneNumber(urgentNumber)
  ) {
    return buildUrgentTransferTemporarilyUnavailableXml();
  }

  const publicNumber = canonicalNumber(input.clinic.publicPhoneNumber);
  if (
    urgentNumber === providerNumber ||
    (publicNumber !== null && urgentNumber === publicNumber)
  ) {
    return buildUrgentTransferTemporarilyUnavailableXml();
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
  });
}

export function buildUrgentDialOutcomeXml(status: unknown): string {
  if (status === "completed") return buildUrgentTransferCompletedXml();

  // Every documented non-completed value and any future/unknown value uses
  // the same privacy-preserving failure response.
  return buildUrgentTransferFailureXml();
}

export function isDocumentedDialStatus(
  status: unknown,
): status is DocumentedDialStatus {
  return (
    typeof status === "string" &&
    (DOCUMENTED_DIAL_STATUSES as readonly string[]).includes(status)
  );
}
