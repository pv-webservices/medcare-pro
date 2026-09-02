import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  Client: vi.fn(),
}));

vi.mock("plivo", () => ({
  Client: mocks.Client,
}));

import {
  createTelephonyTestCallProvider,
  TELEPHONY_TEST_CALL_RING_LIMIT_SECONDS,
  TELEPHONY_TEST_CALL_TIME_LIMIT_SECONDS,
} from "@/lib/telephony/plivoClient";
import {
  resolveTelephonyTestCallEnvironment,
  resolveTelephonyTestDestinationLabel,
} from "@/lib/telephony/testCallEnvironment";

describe("controlled test-call deployment configuration", () => {
  it("fails closed for missing credentials, missing destination, and invalid destination", () => {
    expect(resolveTelephonyTestCallEnvironment({})).toBeNull();
    expect(
      resolveTelephonyTestCallEnvironment({
        PLIVO_AUTH_ID: "auth-id",
        PLIVO_AUTH_TOKEN: "token",
      }),
    ).toBeNull();
    expect(
      resolveTelephonyTestCallEnvironment({
        PLIVO_AUTH_ID: "auth-id",
        PLIVO_AUTH_TOKEN: "token",
        PLIVO_TEST_CALL_DESTINATION: "not-a-number",
      }),
    ).toBeNull();
  });

  it("returns only a masked label through the display helper", () => {
    const environment = {
      PLIVO_AUTH_ID: "synthetic-auth-id",
      PLIVO_AUTH_TOKEN: "synthetic-token",
      PLIVO_TEST_CALL_DESTINATION: "+14155550123",
    };
    expect(resolveTelephonyTestDestinationLabel(environment)).toBe(
      "Test number ending in 0123",
    );
    const resolved = resolveTelephonyTestCallEnvironment(environment)!;
    expect(resolved.destination).toBe("+14155550123");
    expect(resolved.destinationLabel).toBe("Test number ending in 0123");
  });
});

describe("server-only Plivo test-call adapter", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.Client.mockReset();
    mocks.Client.mockImplementation(() => ({ calls: { create: mocks.create } }));
  });

  it("uses exact bounded outbound arguments and returns one request UUID", async () => {
    mocks.create.mockResolvedValue({ requestUuid: "request-uuid" });
    const provider = createTelephonyTestCallProvider({
      authId: "synthetic-auth-id",
      authToken: "synthetic-token",
    });
    const result = await provider.createTestCall({
      from: "+919000000001",
      to: "+14155550123",
      answerUrl: "https://app.example/api/webhooks/plivo/test-call/answer?testCallId=attempt-a",
      ringUrl: "https://app.example/api/webhooks/plivo/test-call/status?testCallId=attempt-a",
      hangupUrl: "https://app.example/api/webhooks/plivo/test-call/status?testCallId=attempt-a",
      timeLimitSeconds: TELEPHONY_TEST_CALL_TIME_LIMIT_SECONDS,
      ringLimitSeconds: TELEPHONY_TEST_CALL_RING_LIMIT_SECONDS,
    });

    expect(mocks.Client).toHaveBeenCalledWith(
      "synthetic-auth-id",
      "synthetic-token",
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "+919000000001",
      "+14155550123",
      "https://app.example/api/webhooks/plivo/test-call/answer?testCallId=attempt-a",
      {
        answerMethod: "POST",
        ringUrl:
          "https://app.example/api/webhooks/plivo/test-call/status?testCallId=attempt-a",
        ringMethod: "POST",
        hangupUrl:
          "https://app.example/api/webhooks/plivo/test-call/status?testCallId=attempt-a",
        hangupMethod: "POST",
        timeLimit: 120,
        hangupOnRing: 30,
      },
    );
    expect(result).toEqual({ requestUuid: "request-uuid" });
  });

  it("rejects an empty or oversized provider request identifier", async () => {
    const provider = createTelephonyTestCallProvider({
      authId: "synthetic-auth-id",
      authToken: "synthetic-token",
    });
    mocks.create.mockResolvedValueOnce({ requestUuid: "" });
    await expect(
      provider.createTestCall({
        from: "+919000000001",
        to: "+14155550123",
        answerUrl: "https://app.example/answer",
        ringUrl: "https://app.example/status",
        hangupUrl: "https://app.example/status",
        timeLimitSeconds: 120,
        ringLimitSeconds: 30,
      }),
    ).rejects.toThrow("valid request identifier");
  });
});
