import {
  resolveClinicBusinessState,
  type ClinicBusinessHoursDay,
} from "@/lib/telephony/businessHoursContract";
import {
  type ClinicPhoneReadiness,
  type ClinicPhoneRoutingMode,
  type PhoneReadinessCheck,
  type PhoneServiceStatus,
} from "@/lib/telephony/clinicPhoneSettingsContract";
import { resolveCallHandlingEffectiveState } from "@/lib/telephony/dashboardCallHandlingState";
import { isCallTransferDestinationAvailable } from "@/lib/telephony/destinationSafety";

export interface PhoneReadinessInput {
  enabled: boolean;
  providerNumber: string | null;
  routingMode: ClinicPhoneRoutingMode;
  publicPhoneNumber: string | null;
  receptionPhoneNumber: string | null;
  urgentPhoneNumber: string | null;
  timezone: string;
  hours: readonly ClinicBusinessHoursDay[];
  phoneMenuSource: "default" | "custom";
  urgentActionEnabled: boolean;
  now: Date;
}

export interface DerivedPhoneReadiness {
  serviceStatus: PhoneServiceStatus;
  effectiveRoute: "RECEPTION" | "IVR" | null;
  readiness: ClinicPhoneReadiness;
}

function phoneServiceCheck(
  enabled: boolean,
  providerNumber: string | null,
): { serviceStatus: PhoneServiceStatus; check: PhoneReadinessCheck } {
  if (providerNumber === null) {
    return {
      serviceStatus: "not-provisioned",
      check: {
        status: "inactive",
        label: "Phone service not provisioned",
        detail: "Contact MEDCARE PRO support to activate phone service for this clinic.",
      },
    };
  }
  if (!enabled) {
    return {
      serviceStatus: "disabled",
      check: {
        status: "inactive",
        label: "Phone service inactive",
        detail: "Phone service has been disabled by MEDCARE PRO.",
      },
    };
  }
  return {
    serviceStatus: "active",
    check: {
      status: "ready",
      label: "Phone service active",
      detail: "Incoming call handling is active for this clinic.",
    },
  };
}

export function deriveClinicPhoneReadiness(
  input: PhoneReadinessInput,
): DerivedPhoneReadiness {
  const business = resolveClinicBusinessState({
    now: input.now,
    timezone: input.timezone,
    hours: input.hours,
  });
  const service = phoneServiceCheck(input.enabled, input.providerNumber);
  const receptionRelevant = input.routingMode !== "AFTER_HOURS";
  const receptionAvailable = isCallTransferDestinationAvailable({
    providerNumber: input.providerNumber,
    publicPhoneNumber: input.publicPhoneNumber,
    destinationPhoneNumber: input.receptionPhoneNumber,
  });
  const urgentAvailable = isCallTransferDestinationAvailable({
    providerNumber: input.providerNumber,
    publicPhoneNumber: input.publicPhoneNumber,
    destinationPhoneNumber: input.urgentPhoneNumber,
  });

  const automaticHours: PhoneReadinessCheck =
    input.routingMode === "AUTO" && !business.hasRegularHours
      ? {
          status: "attention",
          label: "Automatic hours need attention",
          detail: "Automatic routing has no regular business hours configured.",
        }
      : {
          status: "ready",
          label:
            input.routingMode === "AUTO"
              ? "Automatic hours configured"
              : "Business hours available",
          detail:
            input.routingMode === "AUTO"
              ? "Automatic call routing is using this regular weekly schedule."
              : "The schedule is saved and ready whenever Automatic routing is selected.",
        };

  const reception: PhoneReadinessCheck = receptionRelevant
    ? receptionAvailable
      ? {
          status: "ready",
          label: "Reception ready",
          detail: "Reception destination is configured.",
        }
      : {
          status: "attention",
          label: "Reception needs attention",
          detail:
            "Reception calls will fall back to the phone menu because no safe reception destination is configured.",
        }
    : {
        status: "ready",
        label: "Reception not currently selected",
        detail: "The current call-handling mode sends callers to the phone menu.",
      };

  const urgentTransfer: PhoneReadinessCheck = input.urgentActionEnabled
    ? urgentAvailable
      ? {
          status: "ready",
          label: "Urgent transfer ready",
          detail: "Confirmed urgent-assistance calls have a safe destination.",
        }
      : {
          status: "attention",
          label: "Urgent transfer needs attention",
          detail:
            "Urgent assistance is available in the phone menu, but telephone transfer is not configured.",
        }
    : {
        status: "ready",
        label: "Urgent transfer not required",
        detail: "Urgent assistance is not enabled in the current phone menu.",
      };

  const phoneMenu: PhoneReadinessCheck = {
    status: "ready",
    label:
      input.phoneMenuSource === "custom"
        ? "Custom phone menu"
        : "Default phone menu",
    detail:
      input.phoneMenuSource === "custom"
        ? "This clinic uses a customized phone menu whenever calls enter IVR."
        : "This clinic uses the MEDCARE PRO default phone menu whenever calls enter IVR.",
  };

  const effective = resolveCallHandlingEffectiveState({
    enabled: input.enabled,
    routingMode: input.routingMode,
    isOpen: business.isOpen,
    hasRegularHours: business.hasRegularHours,
    receptionAvailable,
  });
  const checks = [automaticHours, reception, urgentTransfer, phoneMenu];
  const status =
    service.serviceStatus !== "active"
      ? "inactive"
      : checks.some((check) => check.status === "attention")
        ? "attention"
        : "ready";

  return {
    serviceStatus: service.serviceStatus,
    effectiveRoute: effective.effectiveRoute,
    readiness: {
      status,
      phoneService: service.check,
      automaticHours,
      reception,
      urgentTransfer,
      phoneMenu,
    },
  };
}

