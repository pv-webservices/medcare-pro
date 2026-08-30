import {
  MAIN_MENU_ROUTES,
  type MainMenuAction,
} from "@/lib/telephony/routing";

export const STAGE_2_PLATFORM_NAME = "MedCare Pro";
export const STAGE_2_INVALID_SELECTION_MESSAGE =
  "That selection was not recognized.";
export const STAGE_2_NO_INPUT_MESSAGE = "We did not receive any input.";
export const IVR_LIST_PAGE_SIZE = 7;
export const IVR_SLOT_PAGE_SIZE = 6;

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

export interface IvrNamedOption {
  id: string;
  name: string;
}

export interface IvrPage<T> {
  items: readonly T[];
  page: number;
  hasNext: boolean;
}

export function paginateIvrItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): IvrPage<T> {
  const safePage = Number.isSafeInteger(page) && page >= 0 ? page : 0;
  const start = safePage * pageSize;
  if (start >= items.length && safePage !== 0) {
    return paginateIvrItems(items, 0, pageSize);
  }
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    hasNext: start + pageSize < items.length,
  };
}

export function buildDoctorMenuPrompt(
  doctors: readonly IvrNamedOption[],
  hasNext: boolean,
): string {
  const options = doctors.map(
    (doctor, index) => `Press ${index + 1} for ${doctor.name.trim()}.`,
  );
  if (hasNext) options.push("Press 8 for more doctors.");
  options.push("Press 9 for the main menu.");
  return ["Select a doctor.", ...options].join(" ");
}

export function buildAppointmentTypeMenuPrompt(
  appointmentTypes: readonly IvrNamedOption[],
  hasNext: boolean,
): string {
  const options = appointmentTypes.map(
    (type, index) => `Press ${index + 1} for ${type.name.trim()}.`,
  );
  if (hasNext) options.push("Press 8 for more appointment types.");
  options.push("Press 9 for the main menu.");
  return ["Select an appointment type.", ...options].join(" ");
}

export function formatClockTimeForSpeech(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error("A valid HH:mm clock time is required.");
  }
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}${minute === "00" ? "" : `:${minute}`} ${suffix}`;
}

export function buildSlotPagePrompt(
  doctorName: string,
  appointmentTypeName: string,
  slotTimes: readonly string[],
  hasNext: boolean,
): string {
  const spokenTimes = slotTimes.map(formatClockTimeForSpeech).join(", ");
  const controls = hasNext
    ? "Press 8 to hear more available times. Press 9 for the main menu."
    : "Press 9 for the main menu.";
  return `Available times tomorrow for ${doctorName.trim()} for ${appointmentTypeName.trim()} are ${spokenTimes}. ${controls}`;
}

export function buildPatientConfirmationPrompt(): string {
  return [
    "We found one patient record for this caller number.",
    "Press 1 to continue without speaking patient details.",
    "Press 2 to request a callback from the clinic.",
    "Press 9 for the main menu.",
  ].join(" ");
}

export function buildBookingSlotPagePrompt(
  doctorName: string,
  appointmentTypeName: string,
  slotTimes: readonly string[],
  hasNext: boolean,
): string {
  const options = slotTimes.map(
    (time, index) => `Press ${index + 1} for ${formatClockTimeForSpeech(time)}.`,
  );
  if (hasNext) options.push("Press 8 for more available times.");
  options.push("Press 9 for the main menu.");
  return [
    `Choose a time tomorrow with ${doctorName.trim()} for ${appointmentTypeName.trim()}.`,
    ...options,
  ].join(" ");
}

export function buildFinalBookingConfirmationPrompt(input: {
  doctorName: string;
  appointmentTypeName: string;
  startTime: string;
}): string {
  return [
    `Confirm the appointment tomorrow at ${formatClockTimeForSpeech(input.startTime)} with ${input.doctorName.trim()} for ${input.appointmentTypeName.trim()}.`,
    "Press 1 to book this appointment.",
    "Press 2 to choose another time.",
    "Press 3 to request a callback from the clinic.",
    "Press 9 for the main menu.",
  ].join(" ");
}
