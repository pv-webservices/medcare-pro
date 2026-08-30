import { Response as createPlivoResponse } from "plivo";
import {
  buildStage2MainMenuPrompt,
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

function addStage2MainMenu(
  response: PlivoResponse,
  actionUrl: string,
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

  getInput.addSpeak(buildStage2MainMenuPrompt(), {});
}

function buildMainMenuXml(actionUrl: string, invalidSelection: boolean): string {
  const response = createPlivoResponse();

  if (invalidSelection) {
    response.addSpeak(STAGE_2_INVALID_SELECTION_MESSAGE, {});
  }

  addStage2MainMenu(response, actionUrl);
  response.addSpeak(STAGE_2_NO_INPUT_MESSAGE, {});
  return response.toXML();
}

export function buildStage2MainMenuXml(actionUrl: string): string {
  return buildMainMenuXml(actionUrl, false);
}

export function buildStage2SelectionXml(
  action: MainMenuAction,
  inputActionUrl: string,
): string {
  if (action === "repeat-menu") {
    return buildMainMenuXml(inputActionUrl, false);
  }

  if (action === "invalid-input") {
    return buildMainMenuXml(inputActionUrl, true);
  }

  const response = createPlivoResponse();
  response.addSpeak(getStage2Acknowledgement(action), {});
  return response.toXML();
}
