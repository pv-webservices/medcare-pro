import type { ClinicTelephonyRoutingMode } from "@prisma/client";
import {
  resolveEffectiveTelephonyRoute,
  type EffectiveTelephonyRoute,
} from "@/lib/telephony/routing";

export const DASHBOARD_CALL_HANDLING_OPTIONS = [
  { label: "Automatic", routingMode: "AUTO" },
  { label: "Reception", routingMode: "OPEN" },
  { label: "Phone menu", routingMode: "AFTER_HOURS" },
] as const satisfies readonly {
  label: string;
  routingMode: ClinicTelephonyRoutingMode;
}[];

export const CALL_HANDLING_SUCCESS_MESSAGES: Record<
  ClinicTelephonyRoutingMode,
  string
> = {
  AUTO: "Call handling set to Automatic.",
  OPEN: "Calls will now go to Reception.",
  AFTER_HOURS: "Phone menu override is now active.",
};

export interface CallHandlingEffectiveStateInput {
  enabled: boolean;
  routingMode: ClinicTelephonyRoutingMode;
  isOpen: boolean;
  hasRegularHours: boolean;
  receptionAvailable: boolean;
}

export interface CallHandlingEffectiveState {
  effectiveRoute: EffectiveTelephonyRoute | null;
  status: string;
  supportingText: string | null;
  tone: "ok" | "warn" | "alert" | "info" | "neutral";
}

/**
 * One product-level interpretation of telephony state for both the initial
 * server render and the client view immediately after a confirmed mutation.
 */
export function resolveCallHandlingEffectiveState(
  input: CallHandlingEffectiveStateInput,
): CallHandlingEffectiveState {
  if (!input.enabled) {
    return {
      effectiveRoute: null,
      status: "Disabled",
      supportingText: "Call automation is disabled for this clinic.",
      tone: "neutral",
    };
  }

  const requestedRoute = resolveEffectiveTelephonyRoute({
    routingMode: input.routingMode,
    businessState: { isOpen: input.isOpen },
  });

  if (requestedRoute === "RECEPTION" && !input.receptionAvailable) {
    return {
      effectiveRoute: "IVR",
      status: "Reception unavailable · Phone menu active",
      supportingText:
        "Configure a safe reception destination before sending calls to reception.",
      tone: "warn",
    };
  }

  if (input.routingMode === "OPEN") {
    return {
      effectiveRoute: "RECEPTION",
      status: "Manual override · Reception",
      supportingText:
        "Calls are being sent to reception regardless of business hours.",
      tone: "info",
    };
  }

  if (input.routingMode === "AFTER_HOURS") {
    return {
      effectiveRoute: "IVR",
      status: "Manual override · Phone menu",
      supportingText: "Phone menu is handling calls regardless of business hours.",
      tone: "info",
    };
  }

  if (!input.hasRegularHours) {
    return {
      effectiveRoute: "IVR",
      status: "Business hours not configured · Phone menu active",
      supportingText: null,
      tone: "warn",
    };
  }

  if (input.isOpen) {
    return {
      effectiveRoute: "RECEPTION",
      status: "Open · Calls going to reception",
      supportingText: null,
      tone: "ok",
    };
  }

  return {
    effectiveRoute: "IVR",
    status: "Closed · Phone menu active",
    supportingText: null,
    tone: "neutral",
  };
}
