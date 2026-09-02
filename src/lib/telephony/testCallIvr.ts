import { Response as createPlivoResponse } from "plivo";
import {
  buildEffectiveClinicMainMenuXml,
  buildPlivoActionUrl,
} from "@/lib/telephony/plivo";
import {
  IVR_REVISION_QUERY_PARAM,
  type ClinicIvrRuntimeMenu,
  type IvrBusinessAction,
} from "@/lib/telephony/ivrRuntime";

export const PLIVO_TEST_CALL_ANSWER_WEBHOOK_PATH =
  "/api/webhooks/plivo/test-call/answer";
export const PLIVO_TEST_CALL_INPUT_WEBHOOK_PATH =
  "/api/webhooks/plivo/test-call/input";
export const PLIVO_TEST_CALL_STATUS_WEBHOOK_PATH =
  "/api/webhooks/plivo/test-call/status";
export const TELEPHONY_TEST_CALL_PREFIX =
  "This is a MEDCARE PRO phone menu test.";

const TEST_ACTION_MESSAGES: Readonly<Record<IvrBusinessAction, string>> = {
  "tomorrow-slots":
    "Test successful. This option is mapped to tomorrow's availability.",
  "appointment-booking":
    "Test successful. This option is mapped to appointment booking.",
  "urgent-assistance":
    "Test successful. This option is mapped to urgent assistance.",
  "clinic-information":
    "Test successful. This option is mapped to clinic information.",
};

export function telephonyTestActionMessage(
  action: IvrBusinessAction,
): string {
  return TEST_ACTION_MESSAGES[action];
}

export function buildTelephonyTestCallCallbackUrl(input: {
  requestUrl: string;
  path: string;
  testCallId: string;
}): string {
  return buildPlivoActionUrl(input.requestUrl, input.path, {
    testCallId: input.testCallId,
  });
}

function testInputActionUrl(input: {
  requestUrl: string;
  testCallId: string;
  runtimeMenu: ClinicIvrRuntimeMenu;
}): string {
  const url = new URL(
    buildTelephonyTestCallCallbackUrl({
      requestUrl: input.requestUrl,
      path: PLIVO_TEST_CALL_INPUT_WEBHOOK_PATH,
      testCallId: input.testCallId,
    }),
  );
  if (input.runtimeMenu.source === "custom") {
    url.searchParams.set(IVR_REVISION_QUERY_PARAM, input.runtimeMenu.revision);
  }
  return url.toString();
}

export function buildTelephonyTestMenuXml(input: {
  requestUrl: string;
  testCallId: string;
  clinicName: string;
  runtimeMenu: ClinicIvrRuntimeMenu;
  message?: string;
  invalidSelection?: boolean;
}): string {
  return buildEffectiveClinicMainMenuXml({
    inputActionUrl: testInputActionUrl(input),
    clinicName: input.clinicName,
    runtimeMenu: input.runtimeMenu,
    message: input.message,
    invalidSelection: input.invalidSelection,
  });
}

export function buildTelephonyTestMainMenuXml(input: {
  requestUrl: string;
  testCallId: string;
  clinicName: string;
  runtimeMenu: ClinicIvrRuntimeMenu;
  message?: string;
  includePrefix?: boolean;
  invalidSelection?: boolean;
}): string {
  const messages = [
    input.includePrefix === true ? TELEPHONY_TEST_CALL_PREFIX : null,
    input.message ?? null,
  ].filter((message): message is string => message !== null);
  return buildEffectiveClinicMainMenuXml({
    inputActionUrl: testInputActionUrl(input),
    clinicName: input.clinicName,
    runtimeMenu: input.runtimeMenu,
    message: messages.length > 0 ? messages.join(" ") : undefined,
    invalidSelection: input.invalidSelection,
  });
}

export function testActionAcknowledgement(
  action: IvrBusinessAction,
): string {
  return TEST_ACTION_MESSAGES[action];
}

export function buildCompletedTelephonyTestCallXml(): string {
  return createPlivoResponse().toXML();
}
