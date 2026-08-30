import { Response as createPlivoResponse } from "plivo";
import {
  buildMainMenuPrompt,
  getStage2Acknowledgement,
  STAGE_2_INVALID_SELECTION_MESSAGE,
  STAGE_2_NO_INPUT_MESSAGE,
} from "@/lib/telephony/ivr";
import type { MainMenuAction } from "@/lib/telephony/routing";

export const PLIVO_INPUT_WEBHOOK_PATH = "/api/webhooks/plivo/input";

type PlivoResponse = ReturnType<typeof createPlivoResponse>;
type PlivoGetInputElement = {
  addSpeak: (body: string, attributes: Record<string, never>) => object;
};

export function buildPlivoInputActionUrl(requestUrl: string): string {
  const requestedUrl = new URL(requestUrl);
  if (!["http:", "https:"].includes(requestedUrl.protocol)) {
    throw new Error("Plivo webhook URLs must use HTTP or HTTPS.");
  }

  return new URL(PLIVO_INPUT_WEBHOOK_PATH, requestedUrl.origin).toString();
}

function addMainMenu(
  response: PlivoResponse,
  actionUrl: string,
  clinicName: string,
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

  getInput.addSpeak(buildMainMenuPrompt(clinicName), {});
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
