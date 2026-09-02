import { Client } from "plivo";

export const TELEPHONY_TEST_CALL_TIME_LIMIT_SECONDS = 120;
export const TELEPHONY_TEST_CALL_RING_LIMIT_SECONDS = 30;

export interface CreateProviderTestCallCommand {
  readonly from: string;
  readonly to: string;
  readonly answerUrl: string;
  readonly ringUrl: string;
  readonly hangupUrl: string;
  readonly timeLimitSeconds: number;
  readonly ringLimitSeconds: number;
}

export interface ProviderTestCallResult {
  readonly requestUuid: string;
}

export interface TelephonyTestCallProvider {
  createTestCall(
    command: CreateProviderTestCallCommand,
  ): Promise<ProviderTestCallResult>;
}

function oneRequestUuid(value: string | string[]): string {
  const requestUuid = Array.isArray(value) ? value[0] : value;
  if (
    typeof requestUuid !== "string" ||
    requestUuid.trim() === "" ||
    requestUuid.length > 128
  ) {
    throw new Error("Plivo did not return a valid request identifier.");
  }
  return requestUuid;
}

/** Narrow server-side adapter. Credentials are captured, never exported. */
export function createTelephonyTestCallProvider(input: {
  authId: string;
  authToken: string;
}): TelephonyTestCallProvider {
  const client = new Client(input.authId, input.authToken);
  return Object.freeze({
    async createTestCall(command: CreateProviderTestCallCommand) {
      const response = await client.calls.create(
        command.from,
        command.to,
        command.answerUrl,
        {
          answerMethod: "POST",
          ringUrl: command.ringUrl,
          ringMethod: "POST",
          hangupUrl: command.hangupUrl,
          hangupMethod: "POST",
          timeLimit: command.timeLimitSeconds,
          hangupOnRing: command.ringLimitSeconds,
        },
      );
      return Object.freeze({
        requestUuid: oneRequestUuid(response.requestUuid),
      });
    },
  });
}
