import {
  MAIN_MENU_ROUTES,
  type MainMenuAction,
} from "@/lib/telephony/routing";

export const STAGE_2_PLATFORM_NAME = "MedCare Pro";
export const STAGE_2_INVALID_SELECTION_MESSAGE =
  "That selection was not recognized.";
export const STAGE_2_NO_INPUT_MESSAGE = "We did not receive any input.";

type Stage2AcknowledgementAction = Exclude<
  MainMenuAction,
  "repeat-menu" | "invalid-input"
>;

const STAGE_2_ACKNOWLEDGEMENTS: Readonly<
  Record<Stage2AcknowledgementAction, string>
> = Object.freeze({
  "tomorrow-slots": "You selected tomorrow appointment availability.",
  "appointment-booking": "You selected appointment booking.",
  "urgent-assistance": "You selected urgent assistance.",
  "clinic-information": "You selected clinic information.",
});

function normalizeClinicName(clinicName: string): string {
  const normalized = clinicName.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    throw new Error("A clinic name is required for the IVR prompt.");
  }
  return normalized;
}

/** Builds spoken menu text only; it does not generate or expose Plivo XML. */
export function buildMainMenuPrompt(clinicName: string): string {
  const greeting = `Welcome to ${normalizeClinicName(clinicName)}.`;
  const options = Object.entries(MAIN_MENU_ROUTES).map(
    ([digit, route]) => `Press ${digit} ${route.instruction}.`,
  );

  return [greeting, ...options].join(" ");
}

export function buildStage2MainMenuPrompt(): string {
  return buildMainMenuPrompt(STAGE_2_PLATFORM_NAME);
}

export function getStage2Acknowledgement(
  action: Stage2AcknowledgementAction,
): string {
  return STAGE_2_ACKNOWLEDGEMENTS[action];
}
