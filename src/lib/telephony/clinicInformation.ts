import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  getClinicBusinessHoursForTrustedClinic,
  resolveClinicBusinessState,
  type ClinicBusinessState,
} from "@/lib/telephony/businessHours";
import { formatClockTimeForSpeech } from "@/lib/telephony/ivr";
import {
  buildClinicInformationMenuXml,
  buildPlivoActionUrl,
  PLIVO_INFORMATION_WEBHOOK_PATH,
} from "@/lib/telephony/plivo";
import type { ClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" ? null : normalized;
}

function addressSpeech(clinic: InboundClinicContext): string {
  const address = clean(clinic.clinicAddress);
  const city = clean(clinic.clinicCity);
  if (address && city) {
    return `${clinic.clinicName} is located at ${address}, ${city}.`;
  }
  if (address) return `${clinic.clinicName} is located at ${address}.`;
  if (city) return `${clinic.clinicName} is located in ${city}.`;
  return "Address information is not currently available by telephone.";
}

function nextOpeningSpeech(state: ClinicBusinessState): string | null {
  if (!state.nextOpening) return null;
  const time = formatClockTimeForSpeech(state.nextOpening.openTime);
  if (state.nextOpening.dayOffset === 0) {
    return `Our next regular opening is today at ${time}.`;
  }
  if (state.nextOpening.dayOffset === 1) {
    return `Our next regular opening is tomorrow at ${time}.`;
  }
  const weekday =
    state.nextOpening.dayOfWeek.charAt(0) +
    state.nextOpening.dayOfWeek.slice(1).toLowerCase();
  return `Our next regular opening is ${weekday} at ${time}.`;
}

function hoursSpeech(state: ClinicBusinessState): string {
  if (!state.hasRegularHours) {
    return "Regular clinic opening hours are not currently available by telephone.";
  }
  if (state.isOpen && state.todayHours.closeTime !== null) {
    return `We are open today until ${formatClockTimeForSpeech(state.todayHours.closeTime)}.`;
  }
  if (
    !state.todayHours.isClosed &&
    state.todayHours.openTime !== null &&
    state.localTime < state.todayHours.openTime
  ) {
    return `We open today at ${formatClockTimeForSpeech(state.todayHours.openTime)}.`;
  }

  const closed = state.todayHours.isClosed
    ? "We are closed today."
    : "We are currently closed.";
  const next = nextOpeningSpeech(state);
  return next ? `${closed} ${next}` : closed;
}

export function buildClinicInformationPrompt(input: {
  clinic: InboundClinicContext;
  state: ClinicBusinessState;
}): string {
  return [
    addressSpeech(input.clinic),
    hoursSpeech(input.state),
    "Press 9 for the main menu.",
  ].join(" ");
}

export async function buildClinicInformationForClinic(input: {
  requestUrl: string;
  clinic: InboundClinicContext;
  now?: Date;
  invalidSelection?: boolean;
  runtimeMenu?: ClinicIvrRuntimeMenu;
}): Promise<string> {
  const hours = await getClinicBusinessHoursForTrustedClinic(
    input.clinic.clinicId,
  );
  const state = resolveClinicBusinessState({
    now: input.now ?? new Date(),
    timezone: input.clinic.timezone,
    hours,
  });
  return buildClinicInformationMenuXml({
    actionUrl: buildPlivoActionUrl(
      input.requestUrl,
      PLIVO_INFORMATION_WEBHOOK_PATH,
    ),
    prompt: buildClinicInformationPrompt({ clinic: input.clinic, state }),
    invalidSelection: input.invalidSelection,
    runtimeMenu: input.runtimeMenu,
  });
}
