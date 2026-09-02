import { Response as createPlivoResponse } from "plivo";
import {
  buildAppointmentTypeMenuPrompt,
  buildDoctorMenuPrompt,
  buildMainMenuPrompt,
  buildSlotPagePrompt,
  buildBookingSlotPagePrompt,
  buildFinalBookingConfirmationPrompt,
  buildPatientConfirmationPrompt,
  buildUrgentAssistancePrompt,
  getStage2Acknowledgement,
  type IvrNamedOption,
  STAGE_2_INVALID_SELECTION_MESSAGE,
  STAGE_2_NO_INPUT_MESSAGE,
} from "@/lib/telephony/ivr";
import type { MainMenuAction } from "@/lib/telephony/routing";
import {
  IVR_REVISION_QUERY_PARAM,
  type ClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";
import { resolvePlivoPublicWebhookUrl } from "@/lib/telephony/publicUrl";

export const PLIVO_INPUT_WEBHOOK_PATH = "/api/webhooks/plivo/input";
export const PLIVO_DOCTOR_WEBHOOK_PATH =
  "/api/webhooks/plivo/availability/doctor";
export const PLIVO_TYPE_WEBHOOK_PATH =
  "/api/webhooks/plivo/availability/type";
export const PLIVO_SLOTS_WEBHOOK_PATH =
  "/api/webhooks/plivo/availability/slots";
export const PLIVO_BOOKING_IDENTITY_WEBHOOK_PATH =
  "/api/webhooks/plivo/booking/identity";
export const PLIVO_BOOKING_DOCTOR_WEBHOOK_PATH =
  "/api/webhooks/plivo/booking/doctor";
export const PLIVO_BOOKING_TYPE_WEBHOOK_PATH =
  "/api/webhooks/plivo/booking/type";
export const PLIVO_BOOKING_SLOTS_WEBHOOK_PATH =
  "/api/webhooks/plivo/booking/slots";
export const PLIVO_BOOKING_CONFIRM_WEBHOOK_PATH =
  "/api/webhooks/plivo/booking/confirm";
export const PLIVO_URGENT_CONFIRM_WEBHOOK_PATH =
  "/api/webhooks/plivo/urgent/confirm";
export const PLIVO_URGENT_STATUS_WEBHOOK_PATH =
  "/api/webhooks/plivo/urgent/status";
export const PLIVO_RECEPTION_STATUS_WEBHOOK_PATH =
  "/api/webhooks/plivo/reception/status";
export const PLIVO_INFORMATION_WEBHOOK_PATH =
  "/api/webhooks/plivo/information";
export const PLIVO_HANGUP_WEBHOOK_PATH = "/api/webhooks/plivo/hangup";
export const URGENT_DIAL_TIMEOUT_SECONDS = 25;
export const RECEPTION_DIAL_TIMEOUT_SECONDS = URGENT_DIAL_TIMEOUT_SECONDS;

type PlivoResponse = ReturnType<typeof createPlivoResponse>;
type PlivoGetInputElement = {
  addSpeak: (body: string, attributes: Readonly<Record<string, string>>) => object;
};
type PlivoDialElement = {
  addNumber: (body: string) => object;
};
type AddDial = (
  attributes: Readonly<Record<string, string | number | boolean>>,
) => object;

export function buildPlivoInputActionUrl(requestUrl: string): string {
  return new URL(
    PLIVO_INPUT_WEBHOOK_PATH,
    resolvePlivoPublicWebhookUrl(requestUrl),
  ).toString();
}

export function buildPlivoActionUrl(
  requestUrl: string,
  path: string,
  state: Readonly<Record<string, string | number>> = {},
): string {
  const actionUrl = new URL(path, resolvePlivoPublicWebhookUrl(requestUrl));
  for (const [key, value] of Object.entries(state)) {
    actionUrl.searchParams.set(key, String(value));
  }
  return actionUrl.toString();
}

function addDtmfMenu(
  response: PlivoResponse,
  actionUrl: string,
  prompt: string,
  speakAttributes: Readonly<Record<string, string>> = {},
): void {
  const getInput = response.addGetInput({
    action: actionUrl,
    method: "POST",
    inputType: "dtmf",
    numDigits: 1,
    digitEndTimeout: 5,
    executionTimeout: 10,
    redirect: true,
  }) as PlivoGetInputElement;
  getInput.addSpeak(prompt, speakAttributes);
}

function addMainMenu(
  response: PlivoResponse,
  actionUrl: string,
  clinicName: string,
): void {
  addDtmfMenu(response, actionUrl, buildMainMenuPrompt(clinicName));
}

function buildMainMenuXml(
  actionUrl: string,
  clinicName: string,
  invalidSelection: boolean,
): string {
  const response = createPlivoResponse();

  if (invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }

  addMainMenu(response, actionUrl, clinicName);
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildClinicMainMenuXml(
  actionUrl: string,
  clinicName: string,
): string {
  return buildMainMenuXml(actionUrl, clinicName, false);
}

export function buildClinicSelectionXml(
  action: MainMenuAction,
  inputActionUrl: string,
  clinicName: string,
): string {
  if (action === "repeat-menu") {
    return buildMainMenuXml(inputActionUrl, clinicName, false);
  }

  if (action === "invalid-input") {
    return buildMainMenuXml(inputActionUrl, clinicName, true);
  }

  const response = createPlivoResponse();
  response.addSpeak(getStage2Acknowledgement(action), {});
  return response.toXML();
}

export function buildTelephonyUnavailableXml(): string {
  const response = createPlivoResponse();
  response.addSpeak(
    "Telephone assistance is not configured for this number.",
    {},
  );
  return response.toXML();
}

export function buildMessageThenMainMenuXml(
  message: string,
  inputActionUrl: string,
  clinicName: string,
): string {
  const response = createPlivoResponse();
  response.addSpeak(message, {});
  addMainMenu(response, inputActionUrl, clinicName);
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

function inputActionUrlForRuntime(
  inputActionUrl: string,
  runtimeMenu: ClinicIvrRuntimeMenu,
): string {
  if (runtimeMenu.source === "default") return inputActionUrl;
  const actionUrl = new URL(inputActionUrl);
  actionUrl.searchParams.set(IVR_REVISION_QUERY_PARAM, runtimeMenu.revision);
  return actionUrl.toString();
}

/**
 * Uses the byte-stable legacy builders for the default menu and a narrow
 * dynamic builder only for a validated custom runtime menu.
 */
export function buildEffectiveClinicMainMenuXml(input: {
  inputActionUrl: string;
  clinicName: string;
  runtimeMenu?: ClinicIvrRuntimeMenu;
  message?: string;
  invalidSelection?: boolean;
}): string {
  if (!input.runtimeMenu || input.runtimeMenu.source === "default") {
    if (input.message) {
      return buildMessageThenMainMenuXml(
        input.message,
        input.inputActionUrl,
        input.clinicName,
      );
    }
    return input.invalidSelection
      ? buildClinicSelectionXml(
          "invalid-input",
          input.inputActionUrl,
          input.clinicName,
        )
      : buildClinicMainMenuXml(input.inputActionUrl, input.clinicName);
  }

  const response = createPlivoResponse();
  if (input.message) response.addSpeak(input.message, {});
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(
    response,
    inputActionUrlForRuntime(input.inputActionUrl, input.runtimeMenu),
    input.runtimeMenu.prompt,
    {
      language: input.runtimeMenu.language,
      voice: input.runtimeMenu.voice,
    },
  );
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildUrgentAssistanceMenuXml(input: {
  actionUrl: string;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(response, input.actionUrl, buildUrgentAssistancePrompt());
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildUrgentTransferXml(input: {
  actionUrl: string;
  callerId: string;
  destination: string;
}): string {
  const response = createPlivoResponse();
  response.addSpeak("Connecting you to urgent clinic assistance.", {});
  // Plivo 4.75.1's declaration misspells this documented XML attribute as
  // callerID. The runtime builder and current XML docs both require callerId.
  const addDial = response.addDial as unknown as AddDial;
  const dial = addDial.call(response, {
    action: input.actionUrl,
    method: "POST",
    timeout: URGENT_DIAL_TIMEOUT_SECONDS,
    callerId: input.callerId,
    redirect: true,
  }) as PlivoDialElement;
  dial.addNumber(input.destination);
  return response.toXML();
}

export function buildUrgentTransferNotConfiguredXml(): string {
  const response = createPlivoResponse();
  response.addSpeak(
    "Urgent telephone transfer is not currently configured for this clinic. If this is a life-threatening emergency, call 112.",
    {},
  );
  return response.toXML();
}

export function buildUrgentTransferTemporarilyUnavailableXml(): string {
  const response = createPlivoResponse();
  response.addSpeak(
    "Urgent telephone transfer is temporarily unavailable.",
    {},
  );
  return response.toXML();
}

export function buildUrgentTransferFailureXml(): string {
  const response = createPlivoResponse();
  response.addSpeak(
    "We could not connect you to urgent clinic assistance. If this is a life-threatening emergency, call 112.",
    {},
  );
  return response.toXML();
}

export function buildUrgentTransferCompletedXml(): string {
  return createPlivoResponse().toXML();
}

export function buildReceptionTransferXml(input: {
  actionUrl: string;
  callerId: string;
  destination: string;
}): string {
  const response = createPlivoResponse();
  response.addSpeak("Please hold while we connect you to the clinic.", {});
  const addDial = response.addDial as unknown as AddDial;
  const dial = addDial.call(response, {
    action: input.actionUrl,
    method: "POST",
    timeout: RECEPTION_DIAL_TIMEOUT_SECONDS,
    callerId: input.callerId,
    redirect: true,
  }) as PlivoDialElement;
  dial.addNumber(input.destination);
  return response.toXML();
}

export function buildReceptionTransferCompletedXml(): string {
  return createPlivoResponse().toXML();
}

export function buildReceptionFailureThenMainMenuXml(
  inputActionUrl: string,
  clinicName: string,
): string {
  return buildMessageThenMainMenuXml(
    "We could not connect you to reception. You can continue using our automated telephone service.",
    inputActionUrl,
    clinicName,
  );
}

export function buildClinicInformationMenuXml(input: {
  actionUrl: string;
  prompt: string;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(response, input.actionUrl, input.prompt);
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildDoctorSelectionXml(input: {
  actionUrl: string;
  doctors: readonly IvrNamedOption[];
  hasNext: boolean;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(
    response,
    input.actionUrl,
    buildDoctorMenuPrompt(input.doctors, input.hasNext),
  );
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildAppointmentTypeSelectionXml(input: {
  actionUrl: string;
  appointmentTypes: readonly IvrNamedOption[];
  hasNext: boolean;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(
    response,
    input.actionUrl,
    buildAppointmentTypeMenuPrompt(
      input.appointmentTypes,
      input.hasNext,
    ),
  );
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildSlotSelectionXml(input: {
  actionUrl: string;
  doctorName: string;
  appointmentTypeName: string;
  slotTimes: readonly string[];
  hasNext: boolean;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(
    response,
    input.actionUrl,
    buildSlotPagePrompt(
      input.doctorName,
      input.appointmentTypeName,
      input.slotTimes,
      input.hasNext,
    ),
  );
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildPatientConfirmationXml(input: {
  actionUrl: string;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(response, input.actionUrl, buildPatientConfirmationPrompt());
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildBookingSlotSelectionXml(input: {
  actionUrl: string;
  doctorName: string;
  appointmentTypeName: string;
  slotTimes: readonly string[];
  hasNext: boolean;
  invalidSelection?: boolean;
  leadingMessage?: string;
}): string {
  const response = createPlivoResponse();
  if (input.leadingMessage) {
    response.addSpeak(input.leadingMessage, {});
  }
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(
    response,
    input.actionUrl,
    buildBookingSlotPagePrompt(
      input.doctorName,
      input.appointmentTypeName,
      input.slotTimes,
      input.hasNext,
    ),
  );
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildFinalBookingConfirmationXml(input: {
  actionUrl: string;
  doctorName: string;
  appointmentTypeName: string;
  startTime: string;
  invalidSelection?: boolean;
}): string {
  const response = createPlivoResponse();
  if (input.invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }
  addDtmfMenu(response, input.actionUrl, buildFinalBookingConfirmationPrompt(input));
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}
