import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlivoWebhookRequest,
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  getRuntime: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/telephony/testCall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/testCall")>();
  return {
    ...actual,
    bindAndTransitionTelephonyTestCallCallback: mocks.bind,
  };
});
vi.mock("@/lib/telephony/ivrRuntime", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/telephony/ivrRuntime")
  >();
  return {
    ...actual,
    getClinicIvrRuntimeMenuForTrustedClinic: mocks.getRuntime,
  };
});

import { POST as answerPOST } from "@/app/api/webhooks/plivo/test-call/answer/route";
import { POST as inputPOST } from "@/app/api/webhooks/plivo/test-call/input/route";
import { POST as statusPOST } from "@/app/api/webhooks/plivo/test-call/status/route";
import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";

const originalToken = process.env.PLIVO_AUTH_TOKEN;
const originalOrigin = process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
const BASE_CONTEXT = {
  testCallId: "test-call-a",
  clinicId: "clinic-a",
  clinicName: "Sharma Clinic",
  status: "ANSWERED",
  terminal: false,
} as const;
const CALLBACK_PARAMS = {
  CallUUID: "call-uuid-a",
  RequestUUID: "request-uuid-a",
  From: "919000000001",
  To: "14155550123",
  Direction: "outbound",
  CallStatus: "in-progress",
  Event: "StartApp",
} as const;

function url(kind: "answer" | "input" | "status", query = "") {
  return `https://app.example/api/webhooks/plivo/test-call/${kind}?testCallId=test-call-a${query}`;
}

function signed(kind: "answer" | "input" | "status", input: {
  query?: string;
  params?: Record<string, string>;
  signatureUrl?: string;
} = {}) {
  const requestUrl = url(kind, input.query);
  return buildSignedPlivoWebhookRequest({
    url: requestUrl,
    signatureUrl: input.signatureUrl ?? requestUrl,
    authToken: TEST_PLIVO_AUTH_TOKEN,
    params: { ...CALLBACK_PARAMS, ...input.params },
  });
}

describe("dedicated Plivo test-call callback security", () => {
  beforeEach(() => {
    mocks.bind.mockReset();
    mocks.getRuntime.mockReset();
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    mocks.bind.mockResolvedValue(BASE_CONTEXT);
    mocks.getRuntime.mockResolvedValue(defaultClinicIvrRuntimeMenu("Sharma Clinic"));
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalToken;
    if (originalOrigin === undefined) delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    else process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = originalOrigin;
  });

  it.each([
    ["answer", answerPOST],
    ["input", inputPOST],
    ["status", statusPOST],
  ] as const)("rejects missing V3 on the %s callback before attempt lookup", async (kind, handler) => {
    const response = await handler(
      buildPlivoWebhookRequest({ url: url(kind), params: CALLBACK_PARAMS }),
    );
    expect(response.status).toBe(403);
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("rejects an invalid V3 signature", async () => {
    const response = await answerPOST(
      buildPlivoWebhookRequest({
        url: url("answer"),
        params: CALLBACK_PARAMS,
        headers: {
          "X-Plivo-Signature-V3": "invalid",
          "X-Plivo-Signature-V3-Nonce": "nonce",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("fails closed when webhook validation is not configured", async () => {
    delete process.env.PLIVO_AUTH_TOKEN;
    const response = await answerPOST(
      buildPlivoWebhookRequest({ url: url("answer"), params: CALLBACK_PARAMS }),
    );
    expect(response.status).toBe(503);
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("rejects a testCallId tampered after signing", async () => {
    const response = await answerPOST(
      signed("answer", {
        signatureUrl: url("answer").replace("test-call-a", "test-call-b"),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("uses only the signed opaque attempt id and provider correlation fields", async () => {
    const response = await answerPOST(
      signed("answer", { query: "&clinicId=clinic-attacker&tenantId=tenant-attacker" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.bind).toHaveBeenCalledWith({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      requestUuid: "request-uuid-a",
      transition: { kind: "answered" },
    });
    expect(JSON.stringify(mocks.bind.mock.calls[0][0])).not.toMatch(
      /clinic-attacker|tenant-attacker|14155550123|919000000001/,
    );
  });

  it("processes a valid signed status callback through the closed mapper", async () => {
    const response = await statusPOST(
      signed("status", { params: { Event: "Ring", CallStatus: "ringing" } }),
    );
    expect(response.status).toBe(200);
    expect(mocks.bind).toHaveBeenCalledWith({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      requestUuid: "request-uuid-a",
      transition: { kind: "ringing" },
    });
  });
});

describe("controlled IVR test answer and DTMF flow", () => {
  beforeEach(() => {
    mocks.bind.mockReset();
    mocks.getRuntime.mockReset();
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    mocks.bind.mockResolvedValue(BASE_CONTEXT);
    mocks.getRuntime.mockResolvedValue(defaultClinicIvrRuntimeMenu("Sharma Clinic"));
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalToken;
    if (originalOrigin === undefined) delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    else process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = originalOrigin;
  });

  it("speaks the test prefix and current default menu with dedicated GetInput", async () => {
    const response = await answerPOST(signed("answer"));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("This is a MEDCARE PRO phone menu test.");
    expect(xml).toContain("Welcome to Sharma Clinic.");
    expect(xml).toContain("Press 1 for tomorrow slots.");
    expect(xml).toContain(
      "/api/webhooks/plivo/test-call/input?testCallId=test-call-a",
    );
    expect(xml).not.toContain("<Dial");
  });

  it.each([
    ["1", "tomorrow's availability"],
    ["2", "appointment booking"],
    ["3", "urgent assistance"],
    ["4", "clinic information"],
  ])("dry-runs default digit %s without dispatching business work", async (digit, message) => {
    const response = await inputPOST(
      signed("input", { params: { Digits: digit } }),
    );
    const xml = await response.text();
    expect(xml).toContain("Test successful.");
    expect(xml).toContain(message);
    expect(xml).not.toContain("<Dial");
  });

  it("keeps 9 as repeat and 8 unavailable", async () => {
    const repeat = await inputPOST(
      signed("input", { params: { Digits: "9" } }),
    );
    const invalid = await inputPOST(
      signed("input", { params: { Digits: "8" } }),
    );
    expect(await repeat.text()).toContain("Press 9 to repeat these options.");
    expect(await invalid.text()).toContain("That selection was not recognized.");
  });

  it("uses custom greeting, language, voice, enabled order, and remapped digits", async () => {
    const menu = compileCustomClinicIvrRuntimeMenu("Sharma Clinic", {
      greetingTemplate: "Thank you for calling {clinicName}.",
      language: "en-IN",
      voice: "WOMAN",
      items: [
        {
          digit: 5,
          label: "clinic details",
          action: "CLINIC_INFORMATION",
          position: 0,
          enabled: true,
        },
        {
          digit: 2,
          label: "appointments",
          action: "APPOINTMENT_BOOKING",
          position: 1,
          enabled: false,
        },
      ],
    });
    mocks.getRuntime.mockResolvedValue(menu);
    const answer = await answerPOST(signed("answer"));
    const answerXml = await answer.text();
    expect(answerXml).toContain("Thank you for calling Sharma Clinic.");
    expect(answerXml).toContain('language="en-IN"');
    expect(answerXml).toContain('voice="WOMAN"');
    expect(answerXml).toContain("Press 5 for clinic details.");
    expect(answerXml).not.toContain("Press 2 for appointments.");
    expect(answerXml).toContain(`ivrRev=${menu.revision}`);

    const input = await inputPOST(
      signed("input", {
        query: `&ivrRev=${menu.revision}`,
        params: { Digits: "5" },
      }),
    );
    expect(await input.text()).toContain("mapped to clinic information");
  });

  it("does not interpret a stale mapping and replays the current revision", async () => {
    const current = compileCustomClinicIvrRuntimeMenu("Sharma Clinic", {
      greetingTemplate: "Current menu for {clinicName}.",
      language: "en-US",
      voice: "WOMAN",
      items: [
        {
          digit: 6,
          label: "urgent help",
          action: "URGENT_ASSISTANCE",
          position: 0,
          enabled: true,
        },
      ],
    });
    mocks.getRuntime.mockResolvedValue(current);
    const response = await inputPOST(
      signed("input", {
        query: "&ivrRev=stale-revision",
        params: { Digits: "6" },
      }),
    );
    const xml = await response.text();
    expect(xml).toContain("Our phone menu has just changed.");
    expect(xml).toContain("Current menu for Sharma Clinic.");
    expect(xml).not.toContain("Test successful.");
    expect(xml).toContain(`ivrRev=${current.revision}`);
  });

  it("keeps the test routes free of live business-action dependencies", () => {
    const sources = [
      "answer",
      "input",
      "status",
    ].map((route) =>
      readFileSync(
        resolve(`src/app/api/webhooks/plivo/test-call/${route}/route.ts`),
        "utf8",
      ),
    ).join("\n");
    expect(sources).not.toMatch(
      /telephony\/(booking|availability|urgent|reception|clinicInformation)/,
    );
    expect(sources).not.toMatch(/TelephonyBookingRequest|DoctorScheduleLock|addDial|sendWhatsapp/);
  });
});
