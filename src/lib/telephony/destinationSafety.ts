import {
  isCanonicalIndianPhoneNumber,
  normalizePlivoDestinationNumber,
} from "@/lib/telephony/phoneNumber";

export type CallTransferDestinationIssue =
  | "provider-unavailable"
  | "destination-unavailable"
  | "provider-loop"
  | "public-number-loop";

export interface CallTransferDestinationSafety {
  readonly available: boolean;
  readonly issue: CallTransferDestinationIssue | null;
}

function canonicalNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizePlivoDestinationNumber(value);
  } catch {
    return null;
  }
}

/**
 * Canonical server/runtime safety rule for outbound telephone transfers.
 * Callers receive only the semantic issue; hidden provider values never leave
 * the server boundary.
 */
export function resolveCallTransferDestinationSafety(input: {
  providerNumber: unknown;
  publicPhoneNumber: unknown;
  destinationPhoneNumber: unknown;
}): CallTransferDestinationSafety {
  const providerNumber = canonicalNumber(input.providerNumber);
  if (
    providerNumber === null ||
    !isCanonicalIndianPhoneNumber(providerNumber)
  ) {
    return { available: false, issue: "provider-unavailable" };
  }

  const destinationNumber = canonicalNumber(input.destinationPhoneNumber);
  if (
    destinationNumber === null ||
    !isCanonicalIndianPhoneNumber(destinationNumber)
  ) {
    return { available: false, issue: "destination-unavailable" };
  }

  if (destinationNumber === providerNumber) {
    return { available: false, issue: "provider-loop" };
  }

  const publicNumber = canonicalNumber(input.publicPhoneNumber);
  if (publicNumber !== null && destinationNumber === publicNumber) {
    return { available: false, issue: "public-number-loop" };
  }

  return { available: true, issue: null };
}

export function isCallTransferDestinationAvailable(input: {
  providerNumber: unknown;
  publicPhoneNumber: unknown;
  destinationPhoneNumber: unknown;
}): boolean {
  return resolveCallTransferDestinationSafety(input).available;
}

